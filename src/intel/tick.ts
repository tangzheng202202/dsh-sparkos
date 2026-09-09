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
  // 先落本轮留痕再算 health：failStreak 依赖 runs/ 的最新记录。
  // 若反过来，本轮成功要等下一轮才被计入，run 会自相矛盾地记 health-red（滞后一轮）。
  writeRun(cfg.runsDir, run)
  const health = computeHealth(cfg)
  run.ok = run.ok && health.overall !== 'red'
  if (health.overall === 'red') run.error = 'health-red'
  else delete run.error
  writeRun(cfg.runsDir, run) // 同一 at 覆盖为最终 ok/error
  pruneRuns(cfg.runsDir)
  return { ingest, overall: health.overall, report: buildIntelReport(cfg) }
}
