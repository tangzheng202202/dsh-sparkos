/**
 * M2 · 选题建议下发（手动触发，零侵入）。
 *
 * 只生成 ops-intel/dispatch/preferences.json（统筹层自己的目录），
 * 三管道默认不消费；发布权/稿件质量判定永远归原 Owner 与用户（红线 C/D）。
 * @module dsh-sparkos/src/intel/dispatch
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { IntelConfig } from './ingest.ts'
import { defaultIntelConfig } from './ingest.ts'

export interface DispatchItem {
  source: string
  title: string
  eventKey: string
}

export interface DispatchPreferences {
  generatedAt: string
  mode: 'manual-optional'
  ownerNote: string
  redLine: string
  items: DispatchItem[]
  suggestion: string
}

/** 读取最近一份 fusion JSON 的 items；没有则返回空。 */
export function latestFusionItems(cfg: IntelConfig): DispatchItem[] {
  const dir = path.join(path.dirname(cfg.outDir), 'fusion')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('fusion-') && f.endsWith('.json'))
    .sort().reverse()
  if (files.length === 0) return []
  try {
    const data = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8')) as {
      items?: Array<{ eventKey?: string; source?: string; title?: string }>
    }
    return (data.items ?? [])
      .filter((i) => i.eventKey && i.source && i.title)
      .map((i) => ({ source: String(i.source), title: String(i.title), eventKey: String(i.eventKey) }))
  } catch {
    return []
  }
}

/** 生成 preferences.json（幂等覆盖当天建议；只写 dispatch/，不碰源目录）。 */
/** 读取最近一次生成的 preferences.json，无则 null。 */
export function latestDispatch(): DispatchPreferences | null {
  const dir = path.join(path.dirname(defaultIntelConfig().outDir), 'dispatch')
  try {
    return JSON.parse(readFileSync(path.join(dir, 'preferences.json'), 'utf8')) as DispatchPreferences
  } catch { return null }
}

export function generateDispatch(cfg: IntelConfig, now = new Date()): DispatchPreferences {
  const items = latestFusionItems(cfg)
  const out: DispatchPreferences = {
    generatedAt: now.toISOString(),
    mode: 'manual-optional',
    ownerNote: '本文件仅作选题方向参考，三管道默认不消费；发布权与最终裁决归原 Owner 与用户。',
    redLine: '红线A/C/D：不写管道 state/、不碰 token/launchd、不自动定夺发布。',
    items,
    suggestion: items.length > 0
      ? `最近融合 ${items.length} 条，建议优先关注来源：${[...new Set(items.map((i) => i.source))].join('、')}。`
      : '暂无融合产物：先执行 sparkos_run intel payload.fusion=true 生成今日事实清单。',
  }
  const dir = path.join(path.dirname(cfg.outDir), 'dispatch')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'preferences.json'), `${JSON.stringify(out, null, 2)}\n`)
  return out
}