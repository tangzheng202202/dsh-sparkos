/**
 * 定时任务（M0/M1 接线）：默认关闭。
 * - SPARKOS_SCHEDULE=1：每日节奏提醒（P2 原样保留）
 * - SPARKOS_INTEL_SCHEDULE=1：每小时 intel tick（快照 ingest + 健康计算 + run 留痕）
 *   并默认在每天 09:30（本地）自动做一次 fusion（可设 SPARKOS_FUSION_SCHEDULE=0 关闭）。
 * 不自动外发；dispatch 仅手动触发。
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
import { fuseDaily } from './intel/fusion.ts'

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

    // S2：默认每天 09:30 本地自动融合（机械装配，不自动外发）
    if (process.env.SPARKOS_FUSION_SCHEDULE !== '0') {
      const HOUR = 9, MINUTE = 30
      const now = new Date()
      const next = new Date(now)
      next.setHours(HOUR, MINUTE, 0, 0)
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
      const delay = next.getTime() - now.getTime()
      const fusionTimer = setTimeout(() => {
        try {
          const f = fuseDaily(defaultIntelConfig())
          mkdirSync(join(VAULT_ROOT, 'system'), { recursive: true })
          appendFileSync(
            join(VAULT_ROOT, 'system', 'schedule.log'),
            `[${new Date().toISOString()}] daily fusion ok items=${f.items.length} files=${f.files.join(',')}\n`,
          )
        } catch (error) {
          mkdirSync(join(VAULT_ROOT, 'system'), { recursive: true })
          appendFileSync(
            join(VAULT_ROOT, 'system', 'schedule.log'),
            `[${new Date().toISOString()}] daily fusion FAIL ${error instanceof Error ? error.message : String(error)}\n`,
          )
        }
        // 每日循环
        const loop = setInterval(() => {
          try {
            const f = fuseDaily(defaultIntelConfig())
            appendFileSync(
              join(VAULT_ROOT, 'system', 'schedule.log'),
              `[${new Date().toISOString()}] daily fusion ok items=${f.items.length} files=${f.files.join(',')}\n`,
            )
          } catch (error) {
            appendFileSync(
              join(VAULT_ROOT, 'system', 'schedule.log'),
              `[${new Date().toISOString()}] daily fusion FAIL ${error instanceof Error ? error.message : String(error)}\n`,
            )
          }
        }, 24 * 60 * 60 * 1000)
        loop.unref?.()
        ctx.effect(() => () => clearInterval(loop))
      }, delay)
      fusionTimer.unref?.()
      ctx.effect(() => () => clearTimeout(fusionTimer))
      ctx.logger('sparkos').info(`daily fusion schedule enabled (next ${next.toISOString()})`)
    }
  }
}
