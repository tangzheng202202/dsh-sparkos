/**
 * 定时任务（P2）：默认关闭的每日节奏检查。
 *
 * 只做一件事：到点时在 VAULT/system/schedule.log 追加一行提醒，
 * 不自动生成简报、不自动写星火库、不联网——所有实际动作仍由
 * agent/人工经 sparkos_run（过五守卫）执行。
 *
 * @module dsh-sparkos/src/schedule
 */

import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { VAULT_ROOT, initVault } from './vault.ts'

export function registerSchedule(ctx: Context): void {
  const enabled = process.env.SPARKOS_SCHEDULE === '1'
  if (!enabled) return

  initVault()
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
