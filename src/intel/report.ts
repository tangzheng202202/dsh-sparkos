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
import type { IntelRun } from './runs.ts'

export interface IntelArchiveCount {
  source: string
  published: number
  blocked: number
  rejected: number
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
    const base: IntelArchiveCount = { source: src.id, published: 0, blocked: 0, rejected: 0, total: 0 }
    if (src.dir === null || !existsSync(src.dir)) return base
    for (const f of readdirSync(src.dir)) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue
      if (src.pattern === 'published-only' && !/\.published\.json$/.test(f)) continue
      base.total++
      let raw: Record<string, unknown> = {}
      try { raw = JSON.parse(readFileSync(path.join(src.dir, f), 'utf8')) as Record<string, unknown> } catch { /* unknown */ }
      const status = /\.published\.json$/.test(f)
        ? 'published'
        : /\.unsent-scope-blocked\.json$/.test(f) ? 'blocked'
          : /\.rejected\.json$/.test(f) ? 'rejected'
            : raw.status === 'published' ? 'published'
              : raw.status === 'rejected' ? 'rejected' : 'unknown'
      if (status === 'published') base.published++
      else if (status === 'blocked') base.blocked++
      else if (status === 'rejected') base.rejected++
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
      '红线：源管道 state/ 只读；ownership 保持 migration pending。',
      '',
    ].join('\n'))
    created.push('README.md')
  }
  const ownership = path.join(ops, 'ownership.yml')
  if (!existsSync(ownership)) {
    writeFileSync(ownership, [
      '# intel 指挥所所有权登记（intel 蓝图 §1）',
      'migration: pending   # 不允许一刀切接管；变更须经用户确认关卡',
      'sources:',
      '  alpha-signal: read-only',
      '  hermes-cn: read-only',
      '  baicaotang: pending-source',
      '',
    ].join('\n'))
    created.push('ownership.yml')
  }
  return { created }
}
