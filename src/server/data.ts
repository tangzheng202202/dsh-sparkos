/**
 * 工作台数据装配：VAULT + 只读外部资产 → _embeddedDailyData。
 * 星火知识库与 timeline 数据一律只读；写回仅经 VAULT state/ 与 distill_queue/。
 * @module dsh-sparkos/src/server/data
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TIMELINE_DATA, VAULT_ROOT } from '../vault.ts'

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
  distillQueue: string[]
  decisions: Array<{ at: string; kind: string; id: string; action: 'adopt' | 'ignore'; note?: string }>
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

  return {
    generatedAt: new Date().toISOString(),
    vaultRoot: VAULT_ROOT,
    lines,
    timeline: { d0: timeline.d0, days: timeline.days, cards: timeline.cards ?? [] },
    events,
    drafts: listFiles(path.join(VAULT_ROOT, 'drafts')),
    distillQueue: listFiles(path.join(VAULT_ROOT, 'distill_queue')),
    decisions,
  }
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
