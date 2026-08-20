/**
 * 一轮 intel tick（调度与手动触发共用）：ingest → health → run 留痕。
 * @module dsh-sparkos/src/intel/tick
 */

import { defaultIntelConfig, runIngest } from './ingest.ts'
import type { IngestResult } from './ingest.ts'
import { fromIngest, writeRun, pruneRuns } from './runs.ts'
import { computeHealth } from './health.ts'
import { initOpsIntel, buildIntelReport } from './report.ts'

export interface TickResult {
  ingest: IngestResult
  overall: string
  report: ReturnType<typeof buildIntelReport>
}

export function runIntelTick(): TickResult {
  const cfg = defaultIntelConfig()
  initOpsIntel()
  const ingest = runIngest(cfg)
  const run = fromIngest(ingest)
  const health = computeHealth(cfg)
  run.ok = run.ok && health.overall !== 'red'
  if (health.overall === 'red') run.error = 'health-red'
  writeRun(cfg.runsDir, run)
  pruneRuns(cfg.runsDir)
  return { ingest, overall: health.overall, report: buildIntelReport(cfg) }
}
