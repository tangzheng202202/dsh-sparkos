/**
 * M1 · 日频判断融合：输入当天三源 archive 新稿 + 星火知识库参照（只读），
 * 输出 ops-intel/fusion/fusion-YYYYMMDD.md + .json。每条判断必须回链 ≥1 个 eventKey。
 * 融合由 agent 经 sparkos_run intel --payload.fusion 手动/半自动触发，不自动外发任何内容。
 *
 * 说明：本插件不调用 LLM——融合产物是「机械装配的事实清单（全部带 eventKey 回链）」，
 * 判断与措辞由 agent 在此基础上人工完成，保持 intel 蓝图的只读+人工裁决红线。
 * @module dsh-sparkos/src/intel/fusion
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { IntelConfig } from './ingest.ts'
import { eventKeyOf, statusOf } from './ingest.ts'

export interface FusionItem {
  eventKey: string
  source: string
  status: string
  title: string
  observedAt: string
}

export interface FusionOutput {
  date: string
  generatedAt: string
  items: FusionItem[]
  notes: string[]
}

function localDate(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function titleOf(raw: Record<string, unknown>): string {
  const draft = raw.draft as Record<string, unknown> | undefined
  const item = raw.item as Record<string, unknown> | undefined
  const t = draft?.title ?? item?.title ?? raw.title
  return typeof t === 'string' && t !== '' ? t : '(无标题)'
}

/** 当天（本地时区）发布的 archive 新稿清单（只读扫描）。 */
export function collectDailyItems(cfg: IntelConfig, date: Date): FusionItem[] {
  const prefix = `d${localDate(date)}`
  const items: FusionItem[] = []
  for (const src of cfg.sources) {
    if (src.dir === null || !existsSync(src.dir)) continue
    for (const f of readdirSync(src.dir)) {
      if (!f.endsWith('.json') || f.startsWith('.') || !f.startsWith(prefix)) continue
      if (src.pattern === 'published-only' && !/\.published\.json$/.test(f)) continue
      let raw: Record<string, unknown> = {}
      try { raw = JSON.parse(readFileSync(path.join(src.dir, f), 'utf8')) as Record<string, unknown> } catch { continue }
      items.push({
        eventKey: eventKeyOf(f),
        source: src.id,
        status: statusOf(f, raw),
        title: titleOf(raw),
        observedAt: typeof raw.created_at === 'string' ? raw.created_at : '',
      })
    }
  }
  return items.sort((a, b) => a.eventKey.localeCompare(b.eventKey))
}

export function fuseDaily(cfg: IntelConfig, date = new Date()): FusionOutput & { files: string[] } {
  const fusionDir = path.join(path.dirname(cfg.outDir), 'fusion')
  mkdirSync(fusionDir, { recursive: true })
  const stamp = localDate(date)
  const items = collectDailyItems(cfg, date)
  const notes = [
    '机械装配清单：每条带 eventKey 回链；判断与措辞由 agent 完成（intel 蓝图：不自动外发）。',
    '参照：星火知识库只读（/Users/mac/cow/knowledge），本融合不写入星火库。',
    items.length === 0 ? '当日无新稿。' : `当日新稿 ${items.length} 条，覆盖源 ${new Set(items.map((i) => i.source)).size} 个。`,
  ]
  const out: FusionOutput & { files: string[] } = {
    date: stamp,
    generatedAt: new Date().toISOString(),
    items,
    notes,
    files: [],
  }
  const jsonFile = path.join(fusionDir, `fusion-${stamp}.json`)
  const mdFile = path.join(fusionDir, `fusion-${stamp}.md`)
  writeFileSync(jsonFile, `${JSON.stringify({ date: out.date, generatedAt: out.generatedAt, items, notes }, null, 2)}\n`)
  const md = [
    `# 情报融合 ${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
    '',
    ...notes.map((n) => `> ${n}`),
    '',
    ...(items.length === 0
      ? ['（当日无新稿）']
      : [
          '| eventKey | 源 | 状态 | 标题 |',
          '| --- | --- | --- | --- |',
          ...items.map((i) => `| ${i.eventKey} | ${i.source} | ${i.status} | ${i.title.replace(/\|/g, '\\|')} |`),
        ]),
    '',
  ].join('\n')
  writeFileSync(mdFile, md)
  out.files = [jsonFile, mdFile]
  return out
}
