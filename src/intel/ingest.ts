/**
 * M0 · intel 快照接入：只读扫描两条管道的 state/archive，
 * 输出增量快照到 VAULT/ops-intel/ingest/。幂等（同 eventKey 零新增），
 * 快照保留 14 天滚动。绝不写入源目录（只读红线）。
 * @module dsh-sparkos/src/intel/ingest
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { VAULT_ROOT } from '../vault.ts'

export type SnapshotStatus = 'ok' | 'blocked' | 'rejected' | 'unknown'

export interface IntelSourceDef {
  id: string
  /** 只读源 archive 目录；null 表示待接入源（pending-source）。 */
  dir: string | null
  /** 健康阈值（小时）：最新 published 距今超过即标红。 */
  maxStalenessHours: number
  /** 文件名 glob 简化形式：alpha 全量 *.json；hermes-cn 仅 *.published.json。 */
  pattern: 'all' | 'published-only'
}

export interface IntelConfig {
  sources: IntelSourceDef[]
  outDir: string
  runsDir: string
  keepDays: number
}

/** 默认源（决策1：单源 hermes-cn；百草堂 pending-source）。 */
export function defaultIntelConfig(): IntelConfig {
  return {
    sources: [
      {
        id: 'alpha-signal',
        dir: path.join(homedir(), '.openclaw', 'telegram-newsroom', 'state', 'archive'),
        maxStalenessHours: 48,
        pattern: 'all',
      },
      {
        id: 'hermes-cn',
        dir: path.join(homedir(), '.hermes', 'newsroom-cn', 'state', 'archive'),
        maxStalenessHours: 24,
        pattern: 'published-only',
      },
      { id: 'baicaotang', dir: null, maxStalenessHours: 24, pattern: 'all' },
    ],
    outDir: path.join(VAULT_ROOT, 'ops-intel', 'ingest'),
    runsDir: path.join(VAULT_ROOT, 'ops-intel', 'runs'),
    keepDays: 14,
  }
}

/** eventKey = 文件名第一个点号前的 id 段。 */
export function eventKeyOf(filename: string): string {
  return filename.split('.')[0] ?? filename
}

/** 状态映射：后缀优先，回退 body.status。 */
export function statusOf(filename: string, body: Record<string, unknown>): SnapshotStatus {
  if (/\.published\.json$/.test(filename)) return 'ok'
  if (/\.unsent-scope-blocked\.json$/.test(filename)) return 'blocked'
  if (/\.rejected\.json$/.test(filename)) return 'rejected'
  const s = body.status
  if (s === 'published') return 'ok'
  if (s === 'rejected') return 'rejected'
  return 'unknown'
}

export interface IngestSourceResult {
  source: string
  ok: boolean
  error?: string
  scanned: number
  added: number
  skipped: number
}

export interface IngestResult {
  stage: 'ingest'
  at: string
  sources: IngestSourceResult[]
  ok: boolean
}

function listSnapshottedKeys(outDir: string, source: string): Set<string> {
  const keys = new Set<string>()
  const sub = path.join(outDir, source)
  if (!existsSync(sub)) return keys
  for (const f of readdirSync(sub)) {
    if (f.endsWith('.snapshot.json')) keys.add(f.slice(0, -'.snapshot.json'.length))
  }
  return keys
}

/** 14 天滚动清理（按 mtime）。 */
function pruneSnapshots(outDir: string, keepDays: number, now = Date.now()): number {
  let removed = 0
  if (!existsSync(outDir)) return 0
  for (const source of readdirSync(outDir)) {
    const sub = path.join(outDir, source)
    try {
      if (!statSync(sub).isDirectory()) continue
    } catch { continue }
    for (const f of readdirSync(sub)) {
      const p = path.join(sub, f)
      try {
        if (now - statSync(p).mtimeMs > keepDays * 24 * 3600 * 1000) {
          rmSync(p); removed++
        }
      } catch { /* 忽略 */ }
    }
  }
  return removed
}

/** 一轮 ingest：扫描 → 增量落快照。源目录缺失必须显式 fail: source-missing（不静默）。 */
export function runIngest(cfg: IntelConfig, now = new Date()): IngestResult {
  mkdirSync(cfg.outDir, { recursive: true })
  const sources: IngestSourceResult[] = []
  for (const src of cfg.sources) {
    if (src.dir === null) {
      sources.push({ source: src.id, ok: true, scanned: 0, added: 0, skipped: 0, error: 'pending-source' })
      continue
    }
    if (!existsSync(src.dir)) {
      sources.push({ source: src.id, ok: false, error: 'source-missing', scanned: 0, added: 0, skipped: 0 })
      continue
    }
    const files = readdirSync(src.dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .filter((f) => src.pattern === 'all' || /\.published\.json$/.test(f))
      .sort()
    const known = listSnapshottedKeys(cfg.outDir, src.id)
    let added = 0
    let skipped = 0
    for (const f of files) {
      const eventKey = eventKeyOf(f)
      if (known.has(eventKey)) { skipped++; continue }
      let raw: Record<string, unknown> = {}
      try {
        raw = JSON.parse(readFileSync(path.join(src.dir, f), 'utf8')) as Record<string, unknown>
      } catch {
        // 原文件不可解析：仍落快照（raw 为空），状态 unknown，不静默丢事件
      }
      const snapshot = {
        eventKey,
        source: src.id,
        status: statusOf(f, raw),
        observedAt: typeof raw.created_at === 'string' ? raw.created_at : now.toISOString(),
        ingestedAt: now.toISOString(),
        rawFile: f,
        raw,
      }
      const sub = path.join(cfg.outDir, src.id)
      mkdirSync(sub, { recursive: true })
      writeFileSync(path.join(sub, `${eventKey}.snapshot.json`), `${JSON.stringify(snapshot, null, 2)}\n`)
      added++
    }
    sources.push({ source: src.id, ok: true, scanned: files.length, added, skipped })
  }
  pruneSnapshots(cfg.outDir, cfg.keepDays)
  return { stage: 'ingest', at: now.toISOString(), sources, ok: sources.every((s) => s.ok) }
}
