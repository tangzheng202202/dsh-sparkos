/**
 * 工作台数据装配：VAULT + 只读运行时资产（contentos-x 每日产物）→ _embeddedDailyData。
 * 星火知识库、timeline、daily_brief、perf 一律只读；写回仅经 VAULT state/ 与待写回清单。
 * @module dsh-sparkos/src/server/data
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TIMELINE_DATA, VAULT_ROOT } from '../vault.ts'
import { buildIntelReport, latestFusion } from '../intel/report.ts'
import type { IntelReport } from '../intel/report.ts'
import { latestDispatch } from '../intel/dispatch.ts'
import type { DispatchPreferences } from '../intel/dispatch.ts'
import type { FusionOutput } from '../intel/fusion.ts'
import {
  findDistillEntry,
  infoSources,
  latestBriefing,
  latestDailyData,
  listDistillQueue,
  listPerf,
  listRuntimeDrafts,
  listVaultDrafts,
  runtimeEventsCount,
} from '../daily.ts'
import type { DailyData, DistillEntry, DraftFile, InfoSources, PerfSummary } from '../daily.ts'

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
  distillQueue: Array<{ file: string; dir: 'runtime' | 'vault'; summary: string; targets: string[] }>
  distillReviewed: { approved: string[]; rejected: string[] }
  writebackQueue: Array<{ file: string; at: string; dir: string; target: string; content: string }>
  decisions: Array<{ at: string; kind: string; id: string; action: 'adopt' | 'ignore'; note?: string }>
  /** 第 9 tab「情报指挥所」数据（M0/M1）。 */
  intel: IntelReport
  /** 每日工作流真实产物（sparkos-daily skill 产出，只读）。 */
  daily: {
    date: string | null
    briefingDate: string | null
    briefing: string | null
    data: DailyData | null
  }
  runtimeDrafts: Array<{ file: string; path: string; platform?: string; preview: string; bytes: number }>
  perf: PerfSummary
  infoSources: InfoSources | null
  fusion: FusionOutput | null
  dispatch: DispatchPreferences | null
}

/** 蒸馏条目（合并队列）。 */
interface DistillView extends DistillEntry { reviewed?: 'approved' | 'rejected' }

export function loadWritebackQueue(): WorkbenchData['writebackQueue'] {
  return readJsonIf<WorkbenchData['writebackQueue']>(path.join(VAULT_ROOT, 'state', 'writeback_queue.json'), [])
}

function appendWriteback(entry: WorkbenchData['writebackQueue'][number]): void {
  const file = path.join(VAULT_ROOT, 'state', 'writeback_queue.json')
  const all = loadWritebackQueue().filter((e) => e.file !== entry.file)
  all.push(entry)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n')
}

/** 采纳后建议写回星火库的目标目录（按 front-matter kind 提示）。 */
function suggestTarget(content: string): string {
  const kind = /^kind:\s*(.+)$/m.exec(content)?.[1]?.trim().toLowerCase() ?? ''
  const sub = kind === 'model' ? 'models' : kind === 'cruise' ? 'cruises' : 'observations'
  return 'spark-notes/' + sub + '/（人工核对后粘贴写入，插件不自动写星火库）'
}

export function redLineCheck(content: string): string[] {
  return RED_LINE_PATTERNS.filter((r) => r.pattern.test(content)).map((r) => '红线' + r.id + '：' + r.label)
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
    id: String(l.id ?? l.line_id ?? 'line-' + String(i + 1).padStart(3, '0')),
    name: String(l.name ?? l.title ?? lineNames[String(l.id ?? '')] ?? '主线' + (i + 1)),
  }))

  const timeline = readJsonIf<WorkbenchData['timeline'] & { cards?: unknown[] }>(
    path.join(VAULT_ROOT, 'config', 'timeline_cards.json'),
    readJsonIf<WorkbenchData['timeline']>(TIMELINE_DATA, { cards: [] }),
  )

  const decisions = readJsonIf<WorkbenchData['decisions']>(
    path.join(VAULT_ROOT, 'state', 'decisions.json'), [],
  )
  const reviewed = readJsonIf<WorkbenchData['distillReviewed']>(
    path.join(VAULT_ROOT, 'state', 'distill_reviewed.json'), { approved: [], rejected: [] },
  )

  // 每日产物（只读）
  const dailyData = latestDailyData()
  const briefing = latestBriefing()
  const distillAll: DistillView[] = listDistillQueue().map((e) => ({
    ...e,
    reviewed: reviewed.approved.includes(e.file) ? 'approved' : reviewed.rejected.includes(e.file) ? 'rejected' : undefined,
  }))
  const runtimeDrafts: DraftFile[] = [...listRuntimeDrafts(), ...listVaultDrafts()]
    .filter((d, i, arr) => arr.findIndex((x) => x.file === d.file) === i)
    .sort((a, b) => b.mtime - a.mtime)

  return {
    generatedAt: new Date().toISOString(),
    vaultRoot: VAULT_ROOT,
    lines,
    timeline: { d0: timeline.d0, days: timeline.days, cards: timeline.cards ?? [] },
    events: runtimeEventsCount(),
    drafts: listFiles(path.join(VAULT_ROOT, 'drafts')),
    distillQueue: distillAll.filter((e) => !e.reviewed).map(({ file, dir, summary, targets }) => ({ file, dir, summary, targets })),
    distillReviewed: reviewed,
    writebackQueue: loadWritebackQueue(),
    decisions,
    intel: buildIntelReport(),
    daily: {
      date: dailyData?.date ?? null,
      briefingDate: briefing?.date ?? null,
      briefing: briefing?.text ?? null,
      data: dailyData,
    },
    runtimeDrafts: runtimeDrafts.map(({ file, path, platform, preview, bytes }) => ({ file, path, platform, preview, bytes })),
    perf: listPerf(),
    infoSources: infoSources(),
    fusion: latestFusion(),
    dispatch: latestDispatch(),
  }
}

/** 蒸馏条目决策：采纳前跑四红线；条目移入 approved（写回经待写回清单）+ rejected。 */
export function reviewDistill(file: string, action: 'adopt' | 'ignore'): { entry: WorkbenchData['decisions'][number]; violations: string[] } {
  const entry = findDistillEntry(file)
  if (action === 'adopt' && !entry) {
    // 静默降级防护：条目不存在时拒绝无内容采纳（intel 蓝图：失败必须显式化）
    throw new Error('蒸馏条目不存在或不可读：' + file + '，拒绝无内容采纳')
  }
  const content = entry?.content ?? ''
  const violations = action === 'adopt' ? redLineCheck(content) : []
  if (violations.length > 0) {
    throw new Error('红线检查未过：' + violations.join('；'))
  }
  const stateDir = path.join(VAULT_ROOT, 'state')
  const reviewedFile = path.join(stateDir, 'distill_reviewed.json')
  const reviewed = readJsonIf<WorkbenchData['distillReviewed']>(reviewedFile, { approved: [], rejected: [] })
  const list = action === 'adopt' ? reviewed.approved : reviewed.rejected
  if (!list.includes(file)) list.push(file)
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(reviewedFile, JSON.stringify(reviewed, null, 2) + '\n')
  if (action === 'adopt' && entry) {
    appendWriteback({
      file,
      at: new Date().toISOString(),
      dir: entry.dir,
      target: suggestTarget(content),
      content,
    })
  }
  return { entry: recordDecision('distill', file, action), violations }
}

export function recordDecision(kind: string, id: string, action: 'adopt' | 'ignore', note?: string): WorkbenchData['decisions'][number] {
  const stateDir = path.join(VAULT_ROOT, 'state')
  const file = path.join(stateDir, 'decisions.json')
  const all = readJsonIf<WorkbenchData['decisions']>(file, [])
  const entry = { at: new Date().toISOString(), kind, id, action, note }
  all.push(entry)
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n')
  return entry
}

const RED_LINE_PATTERNS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'A', label: '不得要求写情报管道 state/ 或动 token/钥匙串/launchd', pattern: /(华夏舆参|百草堂|管道).{0,20}(state\/|token|钥匙串|launchd)|(state\/|token|钥匙串|launchd).{0,20}(华夏舆参|百草堂|管道)/ },
  { id: 'B', label: 'ownership 必须保持 pending（不允许一刀切接管）', pattern: /ownership.{0,20}(takeover|接管生效|owner\s*[:=]\s*dsch?)/i },
  { id: 'D', label: '不得自动定夺发布（最终裁决归人工）', pattern: /自动发布|自动定夺|无需人工|跳过审核/ },
]
