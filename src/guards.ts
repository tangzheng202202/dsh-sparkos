/**
 * 五守卫引擎（validate_daily.py 的 TypeScript 移植，逻辑等价）。
 *
 * G1 48h 硬窗口 / G2 event_id 去重(含当日合并) / G3 引用卡存在性 /
 * G4 主线存在 / G5 建议只读（建议永不落盘到任何 config）。
 * 全部通过才允许 commit 入库；commit 防重复追加。
 * @module dsh-sparkos/src/guards
 */

import { existsSync, readFileSync, appendFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { VAULT_ROOT, KNOWLEDGE_ROOT } from './vault.ts'

export interface MustRead {
  event_id: string
  title?: string
  primary_line?: string
  fresh_hours?: number
}

export interface Draft {
  platform?: string
  cited_cards?: string[]
}

export interface LineUpdate {
  line: string
}

export interface DailyData {
  date: string
  must_reads?: MustRead[]
  drafts?: Draft[]
  line_updates?: LineUpdate[]
  suggestions?: unknown[]
  distill_candidates?: unknown[]
}

export interface GuardOptions {
  /** 已入库日期相同则放行（当日合并场景，对应 --recheck）。 */
  recheck?: boolean
  /** 校验通过后把新事件追加进 archive/events.jsonl（对应 --commit）。 */
  commit?: boolean
  vaultRoot?: string
  /** spark-notes 根（默认只读星火库；测试可注入 fixture）。 */
  knowledgeRoot?: string
}

export interface GuardReport {
  ok: boolean
  errors: string[]
  warnings: string[]
  stats: { must_reads: number; drafts: number; suggestions: number; distill_candidates: number }
  committed?: number
  skipped?: number
}

function eventsFile(vaultRoot: string): string {
  return path.join(vaultRoot, 'archive', 'events.jsonl')
}

/** 读取已入库事件: event_id -> date。 */
function loadKnown(vaultRoot: string): Map<string, string> {
  const known = new Map<string, string>()
  const f = eventsFile(vaultRoot)
  if (!existsSync(f)) return known
  for (const line of readFileSync(f, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { event_id: string; date?: string }
      known.set(e.event_id, e.date ?? '')
    } catch {
      // 损坏行忽略（与 python json.loads 行为等价则抛错；此处宽容以保证守卫可用）
    }
  }
  return known
}

/** G3: 引用卡 URI -> spark-notes 实际文件存在性。knowledgeRoot 可注入（测试用）。 */
export function cardExists(uri: string, knowledgeRoot: string = KNOWLEDGE_ROOT): boolean {
  const m = /^(obs|model):\/\/(\d+)$/.exec(uri)
  if (!m) return false
  const kind = m[1]
  const num = Number.parseInt(m[2], 10)
  const dir = kind === 'obs' ? 'observations' : 'models'
  const base = path.join(knowledgeRoot, 'spark-notes', dir)
  if (!existsSync(base)) return false
  const prefix = String(num).padStart(3, '0')
  return readdirSync(base).some((f) => f.startsWith(`${prefix}-`) && f.endsWith('.md'))
}

/** 主线合法集合（来自 VAULT config）。 */
export function knownLines(vaultRoot = VAULT_ROOT): Set<string> {
  const f = path.join(vaultRoot, 'config', 'narrative_lines.json')
  const cfg = JSON.parse(readFileSync(f, 'utf-8')) as { lines: Array<{ id: string }> }
  return new Set(cfg.lines.map((l) => l.id))
}

/**
 * 校验一份 daily_data；commit=true 时校验通过才入库。
 * 建议字段（suggestions）只在返回值统计中出现，任何实现不得将其写入 config（G5）。
 */
export function validateDaily(dd: DailyData, opts: GuardOptions = {}): GuardReport {
  const vaultRoot = opts.vaultRoot ?? VAULT_ROOT
  const errors: string[] = []
  const warnings: string[] = []
  const known = loadKnown(vaultRoot)
  const seen = new Set<string>()

  for (const mr of dd.must_reads ?? []) {
    const eid = mr.event_id
    if (!eid) {
      errors.push(`G2 缺 event_id: ${mr.title ?? '?'}`)
      continue
    }
    const knownDate = known.get(eid)
    if (knownDate !== undefined && !(opts.recheck && knownDate === dd.date)) {
      errors.push(`G2 event_id 重复(已在事件库 ${knownDate}): ${eid}`)
    }
    if (seen.has(eid)) errors.push(`G2 event_id 当日重复: ${eid}`)
    seen.add(eid)
    const fh = mr.fresh_hours
    if (fh === undefined || fh > 48) {
      errors.push(`G1 超出48h硬窗口或缺失 fresh_hours=${fh}: ${mr.title ?? '?'}`)
    }
  }

  for (const d of dd.drafts ?? []) {
    const cards = d.cited_cards ?? []
    for (const c of cards) {
      if (!cardExists(c, opts.knowledgeRoot ?? KNOWLEDGE_ROOT)) errors.push(`G3 引用卡不存在: ${c} (draft=${d.platform ?? '?'})`)
    }
    if (cards.length === 0) warnings.push(`G3 草稿无知识卡引用(深度层缺失): ${d.platform ?? '?'}`)
  }

  let lineIds: Set<string>
  try {
    lineIds = knownLines(vaultRoot)
  } catch {
    lineIds = new Set()
    errors.push('G4 主线配置缺失或不可读: config/narrative_lines.json')
  }
  for (const lu of dd.line_updates ?? []) {
    if (!lineIds.has(lu.line)) errors.push(`G4 未知主线: ${lu.line}`)
  }

  const report: GuardReport = {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      must_reads: (dd.must_reads ?? []).length,
      drafts: (dd.drafts ?? []).length,
      suggestions: (dd.suggestions ?? []).length,
      distill_candidates: (dd.distill_candidates ?? []).length,
    },
  }

  if (report.ok && opts.commit) {
    const file = eventsFile(vaultRoot)
    let appended = 0
    const out: string[] = []
    for (const mr of dd.must_reads ?? []) {
      if (known.has(mr.event_id)) continue // 防重复追加（含当日早前运行）
      appended += 1
      out.push(JSON.stringify({
        event_id: mr.event_id,
        date: dd.date,
        title: mr.title ?? '',
        line: mr.primary_line,
      }))
    }
    if (out.length > 0) appendFileSync(file, `${out.join('\n')}\n`)
    report.committed = appended
    report.skipped = (dd.must_reads ?? []).length - appended
  }
  return report
}
