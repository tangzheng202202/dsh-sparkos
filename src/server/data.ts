/**
 * 工作台数据装配：VAULT + 只读外部资产 → _embeddedDailyData。
 * 星火知识库与 timeline 数据一律只读；写回仅经 VAULT state/ 与 distill_queue/。
 * @module dsh-sparkos/src/server/data
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TIMELINE_DATA, VAULT_ROOT } from '../vault.ts'
import { buildIntelReport } from '../intel/report.ts'
import type { IntelReport } from '../intel/report.ts'

function readJsonIf<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.'))
  } catch {
    return []
  }
}

export interface WorkbenchData {
  generatedAt: string
  vaultRoot: string
  lines: Array<{ id: string; name: string }>
  timeline: { d0?: string; days?: number; cards: unknown[] }
  events: number
  drafts: string[]
  distillQueue: Array<{ file: string; summary: string; targets: string[] }>
  distillReviewed: { approved: string[]; rejected: string[] }
  decisions: Array<{ at: string; kind: string; id: string; action: 'adopt' | 'ignore'; note?: string }>
  /** 第 9 tab「情报指挥所」数据（M0/M1）。 */
  intel: IntelReport
}

/** 蒸馏队列条目：distill_queue/*.md，头部 YAML 摘要（title/lines）。 */
interface DistillEntry {
  file: string
  summary: string
  targets: string[]
}

function loadDistillQueue(): DistillEntry[] {
  const dir = path.join(VAULT_ROOT, 'distill_queue')
  return listFiles(dir).filter((f) => f.endsWith('.md')).map((file) => {
    let raw = ''
    try { raw = readFileSync(path.join(dir, file), 'utf8') } catch { /* 忽略 */ }
    const title = /^title:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? file
    const targets = [...raw.matchAll(/^lines?:\s*\[(.+)\]$/gm), ...raw.matchAll(/^line:\s*(.+)$/gm)]
      .flatMap((m) => m[1].split(',')).map((s) => s.trim()).filter((s) => s !== '')
    const body = raw.split(/^---\s*$/m)[2]?.trim() ?? raw.trim()
    return { file, summary: `${title}${body !== '' ? ` — ${body.slice(0, 120)}` : ''}`, targets }
  })
}

/** 四条红线（intel 蓝图 §8，蒸馏采纳前硬检查）。 */
const RED_LINE_PATTERNS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'A', label: '不得要求写情报管道 state/ 或动 token/钥匙串/launchd', pattern: /(华夏舆参|百草堂|管道).{0,20}(state\/|token|钥匙串|launchd)|(state\/|token|钥匙串|launchd).{0,20}(华夏舆参|百草堂|管道)/ },
  { id: 'B', label: 'ownership 必须保持 pending（不允许一刀切接管）', pattern: /ownership.{0,20}(takeover|接管生效|owner\s*[:=]\s*dsch?)/i },
  { id: 'D', label: '不得自动定夺发布（最终裁决归人工）', pattern: /自动发布|自动定夺|无需人工|跳过审核/ },
]

export function redLineCheck(content: string): string[] {
  return RED_LINE_PATTERNS.filter((r) => r.pattern.test(content)).map((r) => `红线${r.id}：${r.label}`)
}

export function buildWorkbenchData(): WorkbenchData {
  const lineNames = readJsonIf<Record<string, string>>(
    path.join(VAULT_ROOT, 'config', 'line_names.json'), {},
  )
  const narrativeDoc = readJsonIf<{ lines?: Array<{ id?: string; line_id?: string; name?: string; title?: string }> } | Array<{ id?: string; line_id?: string; name?: string; title?: string }>>(
    path.join(VAULT_ROOT, 'config', 'narrative_lines.json'), {},
  )
  const narrative = Array.isArray(narrativeDoc) ? narrativeDoc : (narrativeDoc.lines ?? [])
  const lines = narrative.map((l, i) => ({
    id: String(l.id ?? l.line_id ?? `line-${String(i + 1).padStart(3, '0')}`),
    name: String(l.name ?? l.title ?? lineNames[String(l.id ?? '')] ?? `主线${i + 1}`),
  }))

  // 优先用 VAULT 内含主线归属的 timeline_cards.json（自 spark-timeline.html 抽取）；
  // 缺失时回退原始 timeline_data.json（无 line 字段，仅作降级）。
  const timeline = readJsonIf<WorkbenchData['timeline'] & { cards?: unknown[] }>(
    path.join(VAULT_ROOT, 'config', 'timeline_cards.json'),
    readJsonIf<WorkbenchData['timeline']>(TIMELINE_DATA, { cards: [] }),
  )

  let events = 0
  try {
    events = readFileSync(path.join(VAULT_ROOT, 'archive', 'events.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim() !== '').length
  } catch { /* 尚无账本 */ }

  const decisions = readJsonIf<WorkbenchData['decisions']>(
    path.join(VAULT_ROOT, 'state', 'decisions.json'), [],
  )
  const reviewed = readJsonIf<WorkbenchData['distillReviewed']>(
    path.join(VAULT_ROOT, 'state', 'distill_reviewed.json'), { approved: [], rejected: [] },
  )

  return {
    generatedAt: new Date().toISOString(),
    vaultRoot: VAULT_ROOT,
    lines,
    timeline: { d0: timeline.d0, days: timeline.days, cards: timeline.cards ?? [] },
    events,
    drafts: listFiles(path.join(VAULT_ROOT, 'drafts')),
    distillQueue: loadDistillQueue().filter((e) => !reviewed.approved.includes(e.file) && !reviewed.rejected.includes(e.file)),
    distillReviewed: reviewed,
    decisions,
    intel: buildIntelReport(),
  }
}

/** 蒸馏条目决策：采纳前跑四红线；条目移入 approved（待人工写回星火库）/ rejected（不再出现）。 */
export function reviewDistill(file: string, action: 'adopt' | 'ignore'): { entry: WorkbenchData['decisions'][number]; violations: string[] } {
  const queueDir = path.join(VAULT_ROOT, 'distill_queue')
  let content = ''
  let exists = false
  try { content = readFileSync(path.join(queueDir, file), 'utf8'); exists = true } catch { /* 条目可能已处理 */ }
  if (action === 'adopt' && !exists) {
    // 静默降级防护：条目不存在时拒绝无内容采纳（intel 蓝图：失败必须显式化）
    throw new Error(`蒸馏条目不存在或不可读：${file}，拒绝无内容采纳`)
  }
  const violations = action === 'adopt' ? redLineCheck(content) : []
  if (violations.length > 0) {
    throw new Error(`红线检查未过：${violations.join('；')}`)
  }
  const stateDir = path.join(VAULT_ROOT, 'state')
  const reviewedFile = path.join(stateDir, 'distill_reviewed.json')
  const reviewed = readJsonIf<WorkbenchData['distillReviewed']>(reviewedFile, { approved: [], rejected: [] })
  const list = action === 'adopt' ? reviewed.approved : reviewed.rejected
  if (!list.includes(file)) list.push(file)
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(reviewedFile, `${JSON.stringify(reviewed, null, 2)}\n`)
  const entry = recordDecision('distill', file, action)
  return { entry, violations }
}

export function recordDecision(kind: string, id: string, action: 'adopt' | 'ignore', note?: string): WorkbenchData['decisions'][number] {
  const stateDir = path.join(VAULT_ROOT, 'state')
  const file = path.join(stateDir, 'decisions.json')
  const all = readJsonIf<WorkbenchData['decisions']>(file, [])
  const entry = { at: new Date().toISOString(), kind, id, action, note }
  all.push(entry)
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`)
  return entry
}
