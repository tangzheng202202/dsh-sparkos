/**
 * intel 工作台数据装配 + ops-intel/ 目录初始化（M0/M1）。
 * @module dsh-sparkos/src/intel/report
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { VAULT_ROOT } from '../vault.ts'
import { defaultIntelConfig } from './ingest.ts'
import type { IntelConfig } from './ingest.ts'
import { computeHealth } from './health.ts'
import type { HealthReport } from './health.ts'
import { listRuns } from './runs.ts'
import type { FusionOutput } from './fusion.ts'
import type { IntelRun } from './runs.ts'

export interface IntelArchiveCount {
  source: string
  published: number
  blocked: number
  rejected: number
  expired: number
  total: number
}

export interface IntelReport {
  at: string
  health: HealthReport
  lastRun: IntelRun | null
  archiveCounts: IntelArchiveCount[]
  snapshotCount: number
  fusionAvailable: string[]
}

function countArchive(cfg: IntelConfig): IntelArchiveCount[] {
  return cfg.sources.map((src) => {
    const base: IntelArchiveCount = { source: src.id, published: 0, blocked: 0, rejected: 0, expired: 0, total: 0 }
    if (src.dir === null || !existsSync(src.dir)) return base
    for (const f of readdirSync(src.dir)) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue
      if (src.pattern === 'published-only' && !/\.published\.json$/.test(f)) continue
      if (src.filePrefix !== undefined && !f.startsWith(src.filePrefix)) continue
      // 多条目馈送：一文件是一组条目，按条目计数并全部视为已发布内容
      if (src.explodeItems) {
        try {
          const arr = JSON.parse(readFileSync(path.join(src.dir, f), 'utf8')) as unknown
          if (Array.isArray(arr)) {
            const n = arr.filter((x) => typeof x === 'object' && x !== null).length
            base.total += n
            base.published += n
          }
        } catch { /* unknown */ }
        continue
      }
      base.total++
      let raw: Record<string, unknown> = {}
      try { raw = JSON.parse(readFileSync(path.join(src.dir, f), 'utf8')) as Record<string, unknown> } catch { /* unknown */ }
      const status = /\.published\.json$/.test(f)
        ? 'published'
        : /\.unsent-scope-blocked\.json$/.test(f) ? 'blocked'
          : /\.rejected\.json$/.test(f) ? 'rejected'
            : /\.expired\.json$/.test(f) ? 'expired'
              : raw.status === 'published' ? 'published'
                : raw.status === 'rejected' ? 'rejected'
                  : raw.status === 'expired' ? 'expired' : 'unknown'
      if (status === 'published') base.published++
      else if (status === 'blocked') base.blocked++
      else if (status === 'rejected') base.rejected++
      else if (status === 'expired') base.expired++
    }
    return base
  })
}



function listFusion(cfg: IntelConfig): string[] {
  const dir = path.join(path.dirname(cfg.outDir), 'fusion')
  try {
    return readdirSync(dir).filter((f) => f.startsWith('fusion-') && f.endsWith('.json')).sort().reverse().slice(0, 7)
  } catch { return [] }
}

/** 快照文件计数：ingest 各源子目录下 *.snapshot.json 总数。 */
function countSnapshots(outDir: string): number {
  try {
    return readdirSync(outDir).reduce((acc, sub) => {
      const p = path.join(outDir, sub)
      try {
        return acc + readdirSync(p).filter((f) => f.endsWith('.snapshot.json')).length
      } catch { return acc }
    }, 0)
  } catch { return 0 }
}

/** 最新一份 fusion JSON 产物（FusionOutput），无则 null。 */
export function latestFusion(cfg: IntelConfig = defaultIntelConfig()): FusionOutput | null {
  const dir = path.join(path.dirname(cfg.outDir), 'fusion')
  const files = listFusion(cfg)
  if (files.length === 0) return null
  try {
    return JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8')) as FusionOutput
  } catch { return null }
}

export function buildIntelReport(cfg: IntelConfig = defaultIntelConfig()): IntelReport {
  return {
    at: new Date().toISOString(),
    health: computeHealth(cfg),
    lastRun: listRuns(cfg.runsDir, 1)[0] ?? null,
    archiveCounts: countArchive(cfg),
    snapshotCount: countSnapshots(cfg.outDir),
    fusionAvailable: listFusion(cfg),
  }
}

/** ops-intel/ 目录初始化（幂等）：ingest/fusion/runs/dispatch + README + ownership.yml（migration pending）。 */
export function initOpsIntel(root = VAULT_ROOT): { created: string[] } {
  const ops = path.join(root, 'ops-intel')
  const created: string[] = []
  for (const dir of ['ingest', 'fusion', 'runs', 'dispatch']) {
    const p = path.join(ops, dir)
    if (!existsSync(p)) { mkdirSync(p, { recursive: true }); created.push(dir) }
  }
  const readme = path.join(ops, 'README.md')
  if (!existsSync(readme)) {
    writeFileSync(readme, [
      '# ops-intel — 情报指挥所数据区',
      '',
      '- ingest/：每轮调度增量快照（14 天滚动）',
      '- fusion/：日频融合产物 fusion-YYYYMMDD.md/.json（agent 手动触发）',
      '- runs/：每轮 run 留痕（source-missing 必须 fail，不静默）',
      '- dispatch/：预留（外发须经人工裁决，本插件不自动外发）',
      '',
      '红线：外部归档只读；未配置环境变量时不接入。',
      '',
    ].join('\n'))
    created.push('README.md')
  }
  const ownership = path.join(ops, 'ownership.yml')
  if (!existsSync(ownership)) {
    writeFileSync(ownership, [
      '# 情报数据区所有权',
      'migration: pending',
      'sources: []',
      '# 可选只读归档：SPARKOS_INTEL_ARCHIVE_ALL / SPARKOS_INTEL_ARCHIVE_PUBLISHED',
      '',
    ].join('\n'))
    created.push('ownership.yml')
  }
  return { created }
}