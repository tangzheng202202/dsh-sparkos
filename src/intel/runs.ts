/**
 * M0 · run 留痕：每轮调度写 ops-intel/runs/run-<ts>.json {stage, sources[], ok/fail, error}。
 * @module dsh-sparkos/src/intel/runs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { IngestResult } from './ingest.ts'

export interface IntelRun {
  stage: string
  at: string
  sources: Array<{ source: string; ok: boolean; error?: string }>
  ok: boolean
  error?: string
}

export function writeRun(runsDir: string, run: IntelRun): string {
  mkdirSync(runsDir, { recursive: true })
  const file = path.join(runsDir, `run-${run.at.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`)
  return file
}

export function fromIngest(ingest: IngestResult): IntelRun {
  return {
    stage: ingest.stage,
    at: ingest.at,
    sources: ingest.sources.map((s) => ({ source: s.source, ok: s.ok, error: s.error })),
    ok: ingest.ok,
  }
}

/** 最近 n 条 run（旧→新）。 */
export function listRuns(runsDir: string, n = 1): IntelRun[] {
  if (!existsSync(runsDir)) return []
  const files = readdirSync(runsDir).filter((f) => f.startsWith('run-') && f.endsWith('.json')).sort().slice(-n)
  return files.flatMap((f) => {
    try { return [JSON.parse(readFileSync(path.join(runsDir, f), 'utf8')) as IntelRun] } catch { return [] }
  })
}

/** run 留痕滚动（保留最近 max 条）。 */
export function pruneRuns(runsDir: string, max = 200): void {
  if (!existsSync(runsDir)) return
  const files = readdirSync(runsDir).filter((f) => f.startsWith('run-')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - max))) {
    try { rmSync(path.join(runsDir, f)) } catch { /* 忽略 */ }
  }
}
