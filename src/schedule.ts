/**
 * 定时任务（M0/M1 接线）：默认关闭。
 * - SPARKOS_SCHEDULE=1：每日节奏提醒（P2 原样保留）
 * - SPARKOS_INTEL_SCHEDULE=1：每小时 intel tick（快照 ingest + 健康计算 + run 留痕）
 *   并默认在每天 09:30（本地）自动做一次 fusion（可设 SPARKOS_FUSION_SCHEDULE=0 关闭）。
 * - SPARKOS_EDITORIAL_SCHEDULE=1：周三/周六 20:00 生成编辑策划，等待人工审批。
 * 不自动外发；dispatch 仅手动触发。
 * @module dsh-sparkos/src/schedule
 */

import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VAULT_ROOT, initVault } from './vault.ts'
import { defaultIntelConfig, runIngest } from './intel/ingest.ts'
import { fromIngest, writeRun, pruneRuns } from './intel/runs.ts'
import { computeHealth } from './intel/health.ts'
import { initOpsIntel } from './intel/report.ts'
import { fuseDaily } from './intel/fusion.ts'
import { runEditorialPlanning } from './factory/service.ts'

export function editorialScheduleDue(now = new Date()): 'midweek' | 'weekly' | null {
  if (now.getHours() !== 20) return null
  return now.getDay() === 3 ? 'midweek' : now.getDay() === 6 ? 'weekly' : null
}

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

/** 融合完成 → 写内容循环待办（工作台据此显示「内容循环待跑」提醒）。 */
function writeDailyCycle(fusionDate: string, ok: boolean): void {
  try {
    const dir = join(VAULT_ROOT, 'system')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'daily_cycle.json'), JSON.stringify({
      fusionAt: new Date().toISOString(),
      fusionDate,
      status: ok ? 'due' : 'failed',
      note: ok ? '今日 09:30 融合已完成；可先跑情报簇分析（sparkos-intel-cluster-analysis skill，sparkos_run intel analyze/submitCluster），再触发 sparkos-daily 跑今日内容循环（sparkos_run brief / topics）' : '融合失败，内容循环提醒暂缓',
    }, null, 2) + '\n')
  } catch { /* 提醒写入失败不阻塞调度 */ }
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
          writeDailyCycle(f.date, true)
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
            writeDailyCycle(f.date, true)
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

  if (process.env.SPARKOS_EDITORIAL_SCHEDULE === '1') {
    let lastRunKey = ''
    const tick = () => {
      const now = new Date()
      const mode = editorialScheduleDue(now)
      if (!mode) return
      const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
      const key = mode + ':' + date
      if (key === lastRunKey) return
      lastRunKey = key
      mkdirSync(join(VAULT_ROOT, 'system'), { recursive: true })
      try {
        const result = runEditorialPlanning(mode, date)
        appendFileSync(
          join(VAULT_ROOT, 'system', 'schedule.log'),
          `[${now.toISOString()}] editorial ${mode} ok cards=${result.plan.cards.length} job=${result.jobId}${result.reused ? ' reused' : ''} waiting-approval\n`,
        )
      } catch (error) {
        appendFileSync(
          join(VAULT_ROOT, 'system', 'schedule.log'),
          `[${now.toISOString()}] editorial ${mode} FAIL ${error instanceof Error ? error.message : String(error)}\n`,
        )
      }
    }
    tick()
    const timer = setInterval(tick, 30 * 60 * 1000)
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer))
    ctx.logger('sparkos').info('editorial schedule enabled (Wednesday/Saturday 20:00 local, human approval required)')
  }
}
