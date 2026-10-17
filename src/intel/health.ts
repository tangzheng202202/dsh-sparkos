/**
 * M0 · intel 健康看板数据：每源 staleness（最新 published 距今小时）+ 连续失败次数。
 * 未配置、目录不存在、或还没有任何已发布稿件时为 pending，不标红。
 * 只有已有稿件过期，或接入后连续失败，才标红。只读。
 * @module dsh-sparkos/src/intel/health
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

/**
 * 单个文件的「最新已发布时间」+ 是否算发布。
 *
 * 两种源形态：
 *  - 常规（alpha/hermes-cn）：一文件一事件，看后缀或 body.status，时间取 published_at/created_at
 *  - 多条目馈送（hn）：一文件是数组，时间取条目里最大的 collected_at，全部计为已发布
 */
function latestOfFile(src: IntelSourceDef, file: string): { published: boolean; ts: number | null } {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path.join(src.dir as string, file), 'utf8'))
  } catch {
    return { published: false, ts: null }
  }
  if (src.explodeItems) {
    if (!Array.isArray(raw)) return { published: false, ts: null }
    let ts: number | null = null
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const at = Date.parse(String((entry as Record<string, unknown>).collected_at ?? ''))
      if (Number.isFinite(at) && (ts === null || at > ts)) ts = at
    }
    return { published: ts !== null, ts }
  }
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  // 只把「已发布」稿件计入健康新鲜度（blocked/rejected/unknown 不算发布）
  const published = /\.published\.json$/.test(file) || body.status === 'published'
  const publishedAt = typeof body.published_at === 'string' ? Date.parse(body.published_at) : NaN
  const createdAt = typeof body.created_at === 'string' ? Date.parse(body.created_at) : NaN
  const ts = Number.isFinite(publishedAt) ? publishedAt : Number.isFinite(createdAt) ? createdAt : null
  return { published, ts }
}

function latestPublished(src: IntelSourceDef, now: number): string | null {
  void now
  if (src.dir === null || !existsSync(src.dir)) return null
  let best: { iso: string; ts: number } | null = null
  for (const f of readdirSync(src.dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    if (src.pattern === 'published-only' && !/\.published\.json$/.test(f)) continue
    if (src.filePrefix !== undefined && !f.startsWith(src.filePrefix)) continue
    const { published, ts } = latestOfFile(src, f)
    if (!published || ts === null) continue
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
        maxStalenessHours: src.maxStalenessHours, failStreak: 0, note: '未配置',
      }
    }
    if (!existsSync(src.dir)) {
      return {
        id: src.id, status: 'pending', latestPublishedAt: null, stalenessHours: null,
        maxStalenessHours: src.maxStalenessHours, failStreak: 0,
        note: '目录不存在，未标红。请检查路径，或留空表示不接入',
      }
    }
    const latest = latestPublished(src, now.getTime())
    const staleness = latest !== null ? Math.max(0, Math.round((now.getTime() - Date.parse(latest)) / 3600000)) : null
    const streak = failStreak(cfg.runsDir, src.id)
    let status: HealthStatus
    let note: string | undefined
    if (latest === null && streak === 0) {
      status = 'pending'
      note = '暂无已发布稿件'
    } else if (staleness === null || staleness > src.maxStalenessHours || streak > 0) {
      status = 'red'
    } else {
      status = 'green'
    }
    return {
      id: src.id, status, latestPublishedAt: latest, stalenessHours: staleness,
      maxStalenessHours: src.maxStalenessHours, failStreak: streak, note,
    }
  })
  // overall 只反映真实接入源：pending-source（待接入）不计入，避免健康灯永远 pending 失去信号意义。
  const real = sources.filter((s) => s.status !== 'pending')
  const overall: HealthStatus = real.some((s) => s.status === 'red')
    ? 'red'
    : real.length === 0 ? 'pending' : 'green'
  return { at: now.toISOString(), sources, overall }
}