/**
 * media-os（编辑侧内容 OS）**只读**读取器。
 *
 * 为什么需要它：SparkOS 引擎侧（CONTENTOS_ROOT）产出的是情报与每日循环，
 * 而用户真正排期、落库、复盘的地方是 media-os。简报台要回答「今天该发什么」，
 * 必须读编辑侧的排期表与数据主表。
 *
 * 边界：本模块**只有 readFileSync / statSync**，没有任何写路径。
 * media-os 对插件永久只读——选题入池由人工复制粘贴完成。
 * @module dsh-sparkos/src/server/mediaos
 */

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { MEDIA_OS_ROOT } from '../vault.ts'

/** media-os 里简报台需要的三个文件（相对 root 派生，便于注入测试）。 */
export interface MediaOsPaths {
  root: string
  /** 30 天排期表：回答「今天该发什么」。 */
  schedule: string
  /** 全平台数据主表：回答「数据回流了没有」。 */
  metrics: string
  /** 选题池：只读存量参考（入池由人工复制粘贴）。 */
  topicPool: string
}

export function mediaOsPaths(root: string): MediaOsPaths {
  return {
    root,
    schedule: path.join(root, '01-content', '30天排期.md'),
    metrics: path.join(root, '04-data', 'metrics.csv'),
    topicPool: path.join(root, '01-content', '选题池.md'),
  }
}

/** 排期表里今天要做的一件事。 */
export interface ScheduleItem {
  /** 日期格原文，如「三 9/10 20:00」。 */
  label: string
  /** 该行动作原文。 */
  action: string
}

export interface MediaOsSnapshot {
  /**
   * 始终为空串。读取仍用调用方传入的 root，但响应不带回绝对路径，
   * 避免 /sparkos/data 把本机目录泄漏给页面。
   */
  root: string
  /** 是否设置了 SPARKOS_MEDIA_OS_ROOT（或调用方传入了 root）。不暴露路径本身。 */
  configured: boolean
  /** 排期表 / 数据主表 / 选题池 是否可读（缺失时页面降级，不报错）。 */
  available: boolean
  /** 今天（YYYY-MM-DD，取自每日产物的日期，保证与时区/宿主一致）。 */
  today: string
  schedule: {
    present: boolean
    /** 今天命中的排期行。 */
    items: ScheduleItem[]
    /** 表头声明的区间，如「2026-08-18 → 09-23」。 */
    range: string | null
    /** 今天是否落在排期区间内。 */
    inRange: boolean
    /** 排期表最后修改时间（ISO）。 */
    updatedAt: string | null
  }
  metrics: {
    present: boolean
    /** 数据行数（不含表头）。 */
    rows: number
    /** 最后一条记录的日期。 */
    lastDate: string | null
    updatedAt: string | null
  }
  topicPool: {
    present: boolean
    /** 已入库选题条数（`| MM-DD | 标题 | …` 格式的行）。 */
    entries: number
    updatedAt: string | null
  }
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function safeMtime(file: string): string | null {
  try {
    return statSync(file).mtime.toISOString()
  } catch {
    return null
  }
}

/** 从「YYYY-MM-DD → MM-DD」这类区间标题里取起止日期（缺年份时沿用起始年）。 */
function parseRange(text: string): { start: Date; end: Date } | null {
  const m = /(\d{4})-(\d{2})-(\d{2})\s*[→~-]\s*(?:(\d{4})-)?(\d{2})-(\d{2})/.exec(text)
  if (!m) return null
  const startYear = Number(m[1])
  const start = new Date(Date.UTC(startYear, Number(m[2]) - 1, Number(m[3])))
  let endYear = m[4] ? Number(m[4]) : startYear
  let end = new Date(Date.UTC(endYear, Number(m[5]) - 1, Number(m[6])))
  // 跨年区间：结束月早于起始月时补一年
  if (!m[4] && end.getTime() < start.getTime()) {
    endYear += 1
    end = new Date(Date.UTC(endYear, Number(m[5]) - 1, Number(m[6])))
  }
  return { start, end }
}

/**
 * 解析排期表里命中 `today` 的行。
 *
 * 排期表行有两种形态（同一文件内混用）：
 *   W1 表：`| 一 8/25 | X | 发第一条推文 |`   （日｜平台｜动作）
 *   W2+ 表：`| 三 9/10 20:00 | 公众号《一鱼多吃》；小红书拆条 |`（日｜动作）
 * 两者都只取首格做日期匹配，其余格合并为动作文本。
 */
function parseSchedule(text: string, today: string): { items: ScheduleItem[]; range: string | null; inRange: boolean } {
  const range = /\d{4}-\d{2}-\d{2}\s*[→~-]\s*(?:\d{4}-)?\d{2}-\d{2}/.exec(text)?.[0] ?? null
  const parsed = range ? parseRange(range) : null
  const [y, m, d] = today.split('-').map(Number)
  const inRange = parsed
    ? new Date(Date.UTC(y, m - 1, d)).getTime() >= parsed.start.getTime() &&
      new Date(Date.UTC(y, m - 1, d)).getTime() <= parsed.end.getTime()
    : false

  const items: ScheduleItem[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (cells.length < 2) continue
    const head = cells[0]
    const date = /^(?:周)?[一二三四五六日]\s*(\d{1,2})\/(\d{1,2})/.exec(head)
    if (!date) continue
    if (Number(date[1]) !== m || Number(date[2]) !== d) continue
    const action = cells.slice(1).filter((c) => c !== '').join(' · ')
    if (action === '') continue
    items.push({ label: head, action })
  }
  return { items, range, inRange }
}

/** 数据主表（metrics.csv）水位：行数 + 最后一条日期。 */
function parseMetrics(text: string): { rows: number; lastDate: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length <= 1) return { rows: 0, lastDate: null }
  const body = lines.slice(1)
  let lastDate: string | null = null
  for (const line of body) {
    const first = line.split(',')[0]?.trim()
    if (first && /^\d{4}-\d{2}-\d{2}$/.test(first)) lastDate = first
  }
  return { rows: body.length, lastDate }
}

/** 选题池已入库条数（`| MM-DD | 标题 | …`）。 */
function parseTopicPool(text: string): number {
  let n = 0
  for (const line of text.split('\n')) {
    if (/^\|\s*\d{2}-\d{2}\s*\|/.test(line)) n += 1
  }
  return n
}

function emptyMediaOs(today: string): MediaOsSnapshot {
  return {
    root: '',
    configured: false,
    available: false,
    today,
    schedule: { present: false, items: [], range: null, inRange: false, updatedAt: null },
    metrics: { present: false, rows: 0, lastDate: null, updatedAt: null },
    topicPool: { present: false, entries: 0, updatedAt: null },
  }
}

/**
 * 装配 media-os 只读快照。任何文件缺失都降级为空值，绝不抛错——
 * 简报台在干净环境下必须仍能渲染。未配置时不访问磁盘。
 * 返回值的 root 固定为空串，页面只看 configured / available。
 */
export function buildMediaOsSnapshot(today: string, root: string | null = MEDIA_OS_ROOT): MediaOsSnapshot {
  if (!root) return emptyMediaOs(today)
  const p = mediaOsPaths(root)
  const scheduleText = safeRead(p.schedule)
  const metricsText = safeRead(p.metrics)
  const poolText = safeRead(p.topicPool)

  const sched = scheduleText ? parseSchedule(scheduleText, today) : null
  const metrics = metricsText ? parseMetrics(metricsText) : null

  return {
    root: '',
    configured: true,
    available: scheduleText !== null || metricsText !== null || poolText !== null,
    today,
    schedule: {
      present: scheduleText !== null,
      items: sched?.items ?? [],
      range: sched?.range ?? null,
      inRange: sched?.inRange ?? false,
      updatedAt: safeMtime(p.schedule),
    },
    metrics: {
      present: metricsText !== null,
      rows: metrics?.rows ?? 0,
      lastDate: metrics?.lastDate ?? null,
      updatedAt: safeMtime(p.metrics),
    },
    topicPool: {
      present: poolText !== null,
      entries: poolText ? parseTopicPool(poolText) : 0,
      updatedAt: safeMtime(p.topicPool),
    },
  }
}

/** 供测试与调试：暴露内部解析器。 */
export const __internals = { parseRange, parseSchedule, parseMetrics, parseTopicPool }
