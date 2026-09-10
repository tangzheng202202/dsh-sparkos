/**
 * 每日晨会摘要（推送用）。
 *
 * 定位：**SparkOS 不靠页面交付结论，靠推送**。用户已经在 Telegram / DSH 会话里工作，
 * 这一条消息就是「今天该干什么」的完整答案——所以它必须在一屏内读完，
 * 且只给结论（发什么 / 有没有草稿 / 有什么备料 / 要动什么），不给原始材料。
 *
 * 反例（改造前的简报台）：把 8,213 字引擎日志与 3 段 300+ 字截断散文并排摆着，
 * 读到一半没有结论——这正是「不知道拿来干什么用」的根因。
 *
 * 纯函数：输入 WorkbenchData，输出文本与统计。投递（Telegram / 其它）由调用方负责。
 * @module dsh-sparkos/src/notify/digest
 */

import type { WorkbenchData } from '../server/data.ts'

export interface DigestOptions {
  /** 最多列几条备料。 */
  maxCandidates?: number
}

export interface MorningDigest {
  /** 可直接发送的纯文本（Telegram Markdown 安全：不使用会与 Markdown 冲突的字符）。 */
  text: string
  stats: {
    scheduleCount: number
    /** 系统里是否找到与今日排期匹配的草稿。 */
    scheduleHasDraft: boolean
    candidateCount: number
    draftCount: number
    cardRequestCount: number
    todoCount: number
  }
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 去掉标题里的机器尾巴，取一句话头条。
 *
 * 事件账本标题的形态是「主句——补充细节（快照 09-09 08:01 首采 HN 双热源 1162🔥…）」，
 * 主句本身还可能很长。所以取**最早出现**的分隔符切一刀，再兜底按字数截。
 */
export function headline(title: string, max = 48): string {
  let t = String(title ?? '').trim()
  const seps = ['——', '、', '，', '；', '（', '(']
  let cut = -1
  for (const sep of seps) {
    const i = t.indexOf(sep)
    // 太靠前说明是正文开头（如「OpenAI，…」），不切，避免切出无意义的短句
    if (i > 8 && (cut === -1 || i < cut)) cut = i
  }
  if (cut > 0) t = t.slice(0, cut).trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

/** 排期标签去掉重复的日期前缀（消息头已写日期，正文只要「20:00」这种时刻）。 */
export function scheduleLabel(label: string): string {
  const stripped = String(label ?? '').replace(/^(?:周)?[一二三四五六日]\s*\d{1,2}\/\d{1,2}\s*/, '').trim()
  return stripped === '' ? String(label ?? '').trim() : stripped
}

/** 以「、」或标点切出的可比较片段（CJK 2 字以上 / 拉丁 3 字以上）。 */
function tokens(s: string): string[] {
  return (s.match(/[\p{Script=Han}]{2,}|[A-Za-z0-9]{3,}/gu) ?? []).map((x) => x.toLowerCase())
}

/**
 * 今日排期要发的内容，系统里有没有对应草稿。
 *
 * 只做保守判断：排期文案与草稿标题有 token 交集才算「有」。
 * 没匹配上只能说「系统里没找到」，不能说「你没写」——草稿完全可能写在 media-os 里。
 */
export function scheduleHasDraft(scheduleText: string, candidateTexts: string[]): boolean {
  const want = tokens(scheduleText)
  if (want.length === 0) return true // 无从判断，不要误报
  const have = new Set(candidateTexts.flatMap(tokens))
  return want.some((w) => have.has(w))
}

export function buildMorningDigest(data: WorkbenchData, opts: DigestOptions = {}): MorningDigest {
  const maxCandidates = opts.maxCandidates ?? 5
  const date = data.daily?.date ?? data.mediaOs?.today ?? ''
  const scheduleItems = data.mediaOs?.schedule?.items ?? []
  const dailyDrafts = data.daily?.data?.drafts ?? []
  const mustReads = data.daily?.data?.must_reads ?? []
  const cardRequests = data.cardRequests ?? []
  const metrics = data.mediaOs?.metrics

  // 备料 = 今日判定事件（去重后取前 N）：比 drafts 更能代表「不同的事」，
  // 因为同一事件可能同时产出公众号与小红书两篇草稿。
  const candidateTexts = mustReads.map((m) => String(m.title ?? ''))
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const t of candidateTexts) {
    const h = headline(t)
    const key = h.slice(0, 12)
    if (h === '' || seen.has(key)) continue
    seen.add(key)
    candidates.push(h)
    if (candidates.length >= maxCandidates) break
  }

  const scheduleText = scheduleItems.map((s) => s.action).join(' ')
  const hasDraft = scheduleItems.length === 0
    ? true
    : scheduleHasDraft(scheduleText, [...dailyDrafts.map((d) => String(d.hook ?? '')), ...candidateTexts])

  const todos: string[] = []
  if (metrics?.present && metrics.rows === 0) todos.push('数据回流 0 条 —— 周报没原料（跑周报）')
  if (cardRequests.length > 0) todos.push('补卡 ' + cardRequests.length + ' 张 —— 够热但 0 张知识卡')
  // 注：情报簇空骨架不列进「要动手」——那由 launchd 定时任务自动处理（P4），
  // 列进来只会让人以为自己该干这件事。

  const dt = date ? new Date(date + 'T00:00:00') : null
  const dayLabel = dt && !Number.isNaN(dt.getTime()) ? date + ' 周' + WEEK[dt.getDay()] : (date || '今天')

  const lines: string[] = []
  lines.push('📋 SparkOS 晨会 · ' + dayLabel)
  lines.push('')

  lines.push('今天要发')
  if (scheduleItems.length === 0) {
    lines.push('· 排期表里今天没有安排')
  } else {
    for (const s of scheduleItems) {
      lines.push('· ' + scheduleLabel(s.label) + ' → ' + s.action)
    }
    lines.push(hasDraft
      ? '✓ 系统里找到对应草稿'
      : '⚠️ 系统里没找到对应草稿 —— 这篇要你自己写')
  }
  lines.push('')

  lines.push('雷达捡到 ' + candidates.length + ' 条备料')
  if (candidates.length === 0) lines.push('· （今日无必读事件）')
  else for (const c of candidates) lines.push('· ' + c)
  lines.push('')

  lines.push('要动手')
  if (todos.length === 0) lines.push('· 没有待办')
  else for (const t of todos) lines.push('· ' + t)

  return {
    text: lines.join('\n'),
    stats: {
      scheduleCount: scheduleItems.length,
      scheduleHasDraft: hasDraft,
      candidateCount: candidates.length,
      draftCount: dailyDrafts.length,
      cardRequestCount: cardRequests.length,
      todoCount: todos.length,
    },
  }
}
