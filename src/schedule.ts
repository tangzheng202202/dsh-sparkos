/**
 * 定时任务（M0 接线）：默认关闭。
 * - SPARKOS_SCHEDULE=1：每日节奏提醒（P2 原样保留）
 * - SPARKOS_INTEL_SCHEDULE=1：每小时 intel tick（快照 ingest + 健康计算 + run 留痕）
 * 不自动融合、不自动外发；fusion 由 agent 经 sparkos_run intel 手动触发。
 * @module dsh-sparkos/src/schedule
 */

import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { VAULT_ROOT, initVault } from './vault.ts'
import { defaultIntelConfig, runIngest } from './intel/ingest.ts'
import { fromIngest, writeRun, pruneRuns } from './intel/runs.ts'
import { computeHealth } from './intel/health.ts'
import { initOpsIntel } from './intel/report.ts'

function intelTick(): void {
  const cfg = defaultIntelConfig()
  initOpsIntel()
  const ingest = runIngest(cfg)
  const run = fromIngest(ingest)
  const health = computeHealth(cfg)
  run.ok = run.ok && health.overall !== 'red'
  if (health.overall === 'red') run.error = 'health-red'
  writeRun(cfg.runsDir, run)
  pruneRuns(cfg.runsDir)
  mkdirSync(join(VAULT_ROOT, 'system'), { recursive: true })
  appendFileSync(
    join(VAULT_ROOT, 'system', 'schedule.log'),
    `[${ingest.at}] intel tick ok=${run.ok} added=${ingest.sources.reduce((n, s) => n + s.added, 0)} health=${health.overall}\n`,
  )
}

export function registerSchedule(ctx: Context): void {
  initVault()

  if (process.env.SPARKOS_SCHEDULE === '1') {
    const DAY_MS = 24 * 60 * 60 * 1000
    const timer = setInterval(() => {
      const dir = join(VAULT_ROOT, 'system')
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'schedule.log'), `[${new Date().toISOString()}] daily brief due\n`)
    }, DAY_MS)
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer))
    ctx.logger('sparkos').info('schedule enabled (daily brief due reminder)')
  }

  if (process.env.SPARKOS_INTEL_SCHEDULE === '1') {
    const HOUR_MS = 60 * 60 * 1000
    intelTick() // 启动即跑一轮，避免空窗
    const timer = setInterval(intelTick, HOUR_MS)
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer))
    ctx.logger('sparkos').info('intel schedule enabled (hourly ingest + health + run report)')
  }
}
