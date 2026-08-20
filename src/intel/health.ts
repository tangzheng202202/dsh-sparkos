/**
 * M0 · intel 健康看板数据：每源 staleness（最新 published 距今小时）+ 连续失败次数。
 * 阈值：alpha-signal ≤48h / hermes-cn ≤24h（决策2）。只读。
 * @module dsh-sparkos/src/intel/health
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { IntelConfig, IntelSourceDef } from './ingest.ts'

export type HealthStatus = 'green' | 'red' | 'pending'

export interface SourceHealth {
  id: string
  status: HealthStatus
  latestPublishedAt: string | null
  stalenessHours: number | null
  maxStalenessHours: number
  failStreak: number
  note?: string
}

export interface HealthReport {
  at: string
  sources: SourceHealth[]
  overall: HealthStatus
}

function latestPublished(src: IntelSourceDef, now: number): string | null {
  if (src.dir === null || !existsSync(src.dir)) return null
  let best: { iso: string; ts: number } | null = null
  for (const f of readdirSync(src.dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const p = path.join(src.dir, f)
    let ts: number
    try { ts = statSync(p).mtimeMs } catch { continue }
    if (best === null || ts > best.ts) best = { iso: new Date(ts).toISOString(), ts }
  }
  return best?.iso ?? null
}

/** 从 runs/ 目录统计每源连续失败次数（最新的连续 fail 记录数）。 */
export function failStreak(runsDir: string, source: string): number {
  if (!existsSync(runsDir)) return 0
  const files = readdirSync(runsDir).filter((f) => f.startsWith('run-') && f.endsWith('.json')).sort().reverse()
  let streak = 0
  for (const f of files) {
    try {
      const run = JSON.parse(readFileSync(path.join(runsDir, f), 'utf8')) as {
        sources?: Array<{ source?: string; ok?: boolean }>
      }
      const s = run.sources?.find((x) => x.source === source)
      if (s && s.ok === false) streak++
      else break
    } catch { break }
  }
  return streak
}

export function computeHealth(cfg: IntelConfig, now = new Date()): HealthReport {
  const sources: SourceHealth[] = cfg.sources.map((src) => {
    if (src.dir === null) {
      return {
        id: src.id, status: 'pending', latestPublishedAt: null, stalenessHours: null,
        maxStalenessHours: src.maxStalenessHours, failStreak: 0, note: 'pending-source（有数据后再拆分接入）',
      }
    }
    const latest = latestPublished(src, now.getTime())
    const staleness = latest !== null ? Math.max(0, Math.round((now.getTime() - Date.parse(latest)) / 3600000)) : null
    const streak = failStreak(cfg.runsDir, src.id)
    let status: HealthStatus
    if (staleness === null || staleness > src.maxStalenessHours || streak > 0) status = 'red'
    else status = 'green'
    return {
      id: src.id, status, latestPublishedAt: latest, stalenessHours: staleness,
      maxStalenessHours: src.maxStalenessHours, failStreak: streak,
    }
  })
  const overall: HealthStatus = sources.some((s) => s.status === 'red')
    ? 'red'
    : sources.some((s) => s.status === 'pending') ? 'pending' : 'green'
  return { at: now.toISOString(), sources, overall }
}
