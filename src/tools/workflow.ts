/**
 * sparkos_run 子命令的真实实现（工作流引擎）。
 * brief/topics/draft/distill/sources/publish/advise 全部读取运行时每日产物
 * （daily_data / briefing / drafts / perf / 蒸馏队列 / 信息源），只读；
 * 写操作仅蒸馏审核经 reviewDistill（VAULT state/），建议永不落盘（G5）。
 * @module dsh-sparkos/src/tools/workflow
 */

import {
  findDistillEntry,
  infoSources,
  latestBriefing,
  latestDailyData,
  listBriefings,
  listDistillQueue,
  listPerf,
  listRuntimeDrafts,
  listVaultDrafts,
  readDraft,
  runtimeEventsCount,
} from '../daily.ts'
import { VAULT_ROOT } from '../vault.ts'
import { readFileSync } from 'node:fs'
import { buildIntelReport } from '../intel/report.ts'

function lineName(id: string | undefined): string {
  if (!id) return '—'
  try {
    const names = JSON.parse(readFileSync(VAULT_ROOT + '/config/line_names.json', 'utf8')) as Record<string, string>
    return names[id] ?? id
  } catch {
    return id
  }
}

function freshLabel(h: number | undefined): string {
  if (h === undefined) return 'fresh=?'
  return h <= 24 ? h + 'h 新鲜' : h <= 48 ? h + 'h 窗口内' : h + 'h 超窗!'
}

// ---- brief：最新每日简报 + 数据摘要（payload.daily 走守卫的路径在 run.ts） ----

export function cmdBrief(payload: Record<string, unknown>): string[] {
  const date = typeof payload.date === 'string' ? payload.date : undefined
  const briefings = listBriefings()
  const target = date ? briefings.find((b) => b.date === date) : briefings[0]
  const data = latestDailyData()
  const out: string[] = []
  if (target) {
    out.push('===== 每日简报 ' + target.date + ' =====')
    out.push(target.text.trim())
  } else {
    out.push('尚无每日简报（daily_briefing_*.md）。')
  }
  if (data) {
    out.push('')
    out.push('===== daily_data ' + data.date + ' =====')
    out.push('必读 ' + (data.must_reads?.length ?? 0) + ' 条 / 主线增量 ' + (data.line_updates?.length ?? 0) + ' 条 / 草稿 ' + (data.drafts?.length ?? 0) + ' 篇 / 建议 ' + (data.suggestions?.length ?? 0) + ' 条 / 蒸馏候选 ' + (data.distill_candidates?.length ?? 0) + ' 项')
  }
  return out
}

// ---- topics：当日必读选题（按 fresh_hours 升序） ----

export function cmdTopics(payload: Record<string, unknown>): string[] {
  const data = latestDailyData()
  if (!data || !data.must_reads?.length) return ['今日无必读选题（daily_data 为空或缺失）。']
  const out = ['===== 选题推荐 ' + data.date + '（' + data.must_reads.length + ' 条） =====']
  const sorted = [...data.must_reads].sort((a, b) => (a.fresh_hours ?? 99) - (b.fresh_hours ?? 99))
  for (const mr of sorted) {
    const line = lineName(mr.primary_line)
    const supporting = mr.supporting?.length ? ' · 补充角度 ' + mr.supporting.length + ' 个' : ''
    out.push('- [' + freshLabel(mr.fresh_hours) + '] ' + (mr.title ?? mr.event_id) + '（' + line + '）' + supporting)
  }
  if (payload.top !== undefined) {
    const n = Math.max(1, Number(payload.top) || 5)
    out.push('')
    out.push('Top ' + n + '：' + sorted.slice(0, n).map((m) => m.event_id).join(' / '))
  }
  return out
}

// ---- draft：列出草稿（runtime + vault），payload.get=<文件名> 读全文 ----

export function cmdDraft(payload: Record<string, unknown>): string[] {
  const get = typeof payload.get === 'string' ? payload.get : undefined
  if (get) {
    const candidates = [...listRuntimeDrafts(), ...listVaultDrafts()].filter((d) => d.file === get)
    if (candidates.length === 0) return ['草稿不存在：' + get]
    const content = readDraft(candidates[0].path)
    return ['===== 草稿 ' + get + '（' + candidates[0].path + '） =====', content ?? '(空文件)']
  }
  const drafts = [...listRuntimeDrafts(), ...listVaultDrafts()]
    .filter((d, i, arr) => arr.findIndex((x) => x.file === d.file) === i)
    .sort((a, b) => b.mtime - a.mtime)
  if (drafts.length === 0) return ['暂无草稿。']
  return [
    '===== 草稿列表（' + drafts.length + ' 篇，按修改时间倒序） =====',
    ...drafts.map((d) => '- ' + d.file + '（' + Math.round(d.bytes / 100) / 10 + 'KB · ' + new Date(d.mtime).toISOString().slice(0, 16) + '）'),
    '',
    '查看全文：payload.get="<文件名>"',
  ]
}

// ---- distill：蒸馏审核队列（runtime + vault）+ 审核状态 ----

export function cmdDistill(payload: Record<string, unknown>): string[] {
  const queue = listDistillQueue()
  if (queue.length === 0) return ['蒸馏队列为空。']
  let approved: string[] = []
  let rejected: string[] = []
  try {
    const rev = JSON.parse(readFileSync(VAULT_ROOT + '/state/distill_reviewed.json', 'utf8')) as { approved?: string[]; rejected?: string[] }
    approved = rev.approved ?? []
    rejected = rev.rejected ?? []
  } catch { /* 尚无审核记录 */ }
  const pending = queue.filter((e) => !approved.includes(e.file) && !rejected.includes(e.file))
  const out = ['===== 蒸馏审核队列 =====']
  if (pending.length === 0) out.push('（无待审条目）')
  for (const e of pending) {
    out.push('- [待审] ' + e.file + '（' + e.dir + '）' + (e.targets.length ? ' 主线 ' + e.targets.join(',') : ''))
    out.push('    ' + e.summary.slice(0, 100))
  }
  out.push('')
  out.push('已采纳 ' + approved.length + ' 项（待写回星火库）· 已驳回 ' + rejected.length + ' 项')
  out.push('采纳/驳回在工作台蒸馏 tab 操作（POST /sparkos/mutate，过四红线）。')
  return out
}

// ---- sources：信息源注册表（只读）+ intel 健康快照 ----

export function cmdSources(payload: Record<string, unknown>): string[] {
  const info = infoSources()
  const out = ['===== 信息源注册表（只读） =====']
  if (!info) {
    out.push('（config/info_sources.json 缺失或不可读）')
  } else {
    if (info.rss?.length) out.push('RSS：')
    for (const r of info.rss ?? []) out.push('  - ' + (r.name ?? '?') + ' <' + (r.url ?? '') + '> ' + (r.tags ?? []).join(','))
    if (info.x_lists?.length) out.push('X list：')
    for (const x of info.x_lists ?? []) out.push('  - ' + (x.name ?? '?') + ' → ' + (x.accounts ?? []).join(' '))
    if (info.local_knowledge) {
      out.push('本地知识：')
      for (const [k, v] of Object.entries(info.local_knowledge)) out.push('  - ' + k + ' = ' + v)
    }
  }
  const report = buildIntelReport()
  out.push('')
  out.push('===== intel 健康快照（overall=' + report.health.overall + '） =====')
  for (const s of report.health.sources) {
    out.push('- ' + s.id + '：' + s.status + ' · staleness ' + (s.stalenessHours ?? '—') + 'h/≤' + s.maxStalenessHours + 'h · 连败 ' + s.failStreak + (s.note ? ' · ' + s.note : ''))
  }
  return out
}

// ---- publish：发布表现（perf/*.json 汇总，缺失降级） ----

export function cmdPublish(payload: Record<string, unknown>): string[] {
  const perf = listPerf()
  if (perf.files === 0 || perf.totalPosts === 0) {
    return ['暂无发布表现数据（perf/*.json 缺失或为空）——不阻塞简报，P1 自动降级。', '格式参考：perf/example.json（platform/posts[].read_count 等）。']
  }
  const out = ['===== 发布表现（' + perf.files + ' 个数据文件 · ' + perf.totalPosts + ' 篇） =====']
  for (const p of perf.platforms) {
    out.push('- ' + p.platform + '：' + p.posts + ' 篇 · 总阅读 ' + p.totalReads + ' · 平均 ' + p.avgReads + ' · 最近 ' + (p.last || '—'))
  }
  return out
}

// ---- advise：系统建议（只读，G5） ----

export function cmdAdvise(payload: Record<string, unknown>): string[] {
  const data = latestDailyData()
  const out = ['===== 系统建议（只读 · 永不落盘到 config） =====']
  if (!data?.suggestions?.length) {
    out.push('（当日无建议）')
  } else {
    for (const s of data.suggestions) {
      out.push('- [' + (s.type ?? 'generic') + '] ' + (s.note ?? ''))
    }
  }
  try {
    const decisions = JSON.parse(readFileSync(VAULT_ROOT + '/state/decisions.json', 'utf8')) as Array<{ kind: string; id: string; action: string }>
    const advice = decisions.filter((d) => d.kind === 'advice')
    out.push('')
    out.push('已记录建议决策 ' + advice.length + ' 条（工作台 adopt/ignore 操作留痕）')
  } catch { /* 无决策记录 */ }
  return out
}