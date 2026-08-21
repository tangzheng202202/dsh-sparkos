/**
 * M1 · 日频判断融合：输入当天 ingest 快照（ops-intel/ingest/，时间已归一），
 * 输出 ops-intel/fusion/fusion-YYYYMMDD.md + .json。每条判断必须回链 ≥1 个 eventKey。
 *
 * 数据源用 ingest 快照而非源 archive 的原因：
 * 1) 源文件名时区不统一（alpha=UTC / hermes=本地），按文件名前缀归类会错天；
 *    快照 observedAt 是 ISO，统一转本地日期归类。
 * 2) 源落盘有延迟（alpha 稿件可能上午才写入 archive），只要当天被 ingest 就能进当日融合；
 *    晚落盘稿件可手动重跑融合（同名覆盖）补齐。
 *
 * 重复主题提示：机械装配后按标题相似度聚类（Jaccard 字符 bigram），疑似同主题组
 * 输出到 dupGroups 与 md 底部「⚠️ 疑似重复」段——仅供 agent 判断，不自动合并。
 *
 * 融合由 agent 经 sparkos_run intel --payload.fusion 手动/半自动触发，不自动外发任何内容。
 * 本插件不调用 LLM——融合产物是「机械装配的事实清单」，判断与措辞由 agent 人工完成。
 * @module dsh-sparkos/src/intel/fusion
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { IntelConfig } from './ingest.ts'

export interface FusionItem {
  eventKey: string
  source: string
  status: string
  title: string
  observedAt: string
  /** 关键证据 URL（来自快照 raw.source_hint.url / raw.url / raw.link）。 */
  evidenceUrl: string
}

export interface FusionOutput {
  date: string
  generatedAt: string
  items: FusionItem[]
  notes: string[]
  /** 疑似同主题组（eventKey 数组），供 agent 判断去重。 */
  dupGroups: string[][]
}

function localDate(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0')
  return y + m + day
}

/** ISO 字符串 → 本地 YYYYMMDD（与 localDate 对齐）；无法解析返回空串。 */
function localDateOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return localDate(d)
}

function evidenceUrlOf(raw: Record<string, unknown>): string {
  const sh = raw.source_hint as Record<string, unknown> | undefined
  const u = sh?.url ?? raw.url ?? raw.link
  return typeof u === 'string' && u !== '' ? u : ''
}

function titleOf(raw: Record<string, unknown>): string {
  const draft = raw.draft as Record<string, unknown> | undefined
  const item = raw.item as Record<string, unknown> | undefined
  const t = draft?.title ?? item?.title ?? raw.title
  return typeof t === 'string' && t !== '' ? t : '(无标题)'
}

// ---- 重复主题聚类（无依赖，Jaccard 字符 bigram） ----

/** 标题归一化：去标点空白，保字母数字中文。 */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** 字符集合（unigram；中文短标题下 Dice 比 bigram Jaccard 更稳）。 */
function grams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length; i++) out.add(s[i])
  return out
}

/** Sørensen–Dice：2*inter/(|A|+|B|)。实测：伊朗制裁三条中 a/b=0.56（聚）、a/c=0.24（不聚）。 */
export function titleSimilarity(a: string, b: string): number {
  const A = grams(titleKey(a))
  const B = grams(titleKey(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  const sum = A.size + B.size
  return sum === 0 ? 0 : (2 * inter) / sum
}

/** 贪心聚类：相似度 ≥ threshold 的标题归并（并查集），返回长度 >1 的组（eventKey 列表）。 */
export function clusterDuplicates(items: FusionItem[], threshold = 0.5): string[][] {
  const n = items.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (titleSimilarity(items[i].title, items[j].title) >= threshold) {
        const ri = find(i); const rj = find(j)
        if (ri !== rj) parent[ri] = rj
      }
    }
  }
  const groups = new Map<number, string[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const list = groups.get(r) ?? []
    list.push(items[i].eventKey)
    groups.set(r, list)
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

/** 当日（本地时区）被 ingest 的快照清单（只读；observedAt 转本地日期归类）。 */
export function collectDailyItems(cfg: IntelConfig, date: Date): FusionItem[] {
  const day = localDate(date)
  const items: FusionItem[] = []
  if (!existsSync(cfg.outDir)) return items
  for (const source of readdirSync(cfg.outDir)) {
    const sub = path.join(cfg.outDir, source)
    try { if (!statSync(sub).isDirectory()) continue } catch { continue }
    for (const f of readdirSync(sub)) {
      if (!f.endsWith('.snapshot.json')) continue
      let snap: Record<string, unknown>
      try { snap = JSON.parse(readFileSync(path.join(sub, f), 'utf8')) as Record<string, unknown> } catch { continue }
      const observedAt = typeof snap.observedAt === 'string' ? snap.observedAt : ''
      if (observedAt === '' || localDateOf(observedAt) !== day) continue
      const raw = (snap.raw ?? {}) as Record<string, unknown>
      items.push({
        eventKey: String(snap.eventKey ?? f.slice(0, -'.snapshot.json'.length)),
        source: String(snap.source ?? source),
        status: String(snap.status ?? 'unknown'),
        title: titleOf(raw),
        observedAt,
        evidenceUrl: evidenceUrlOf(raw),
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
  const dupGroups = clusterDuplicates(items)
  const notes = [
    '机械装配清单：每条带 eventKey 回链；判断与措辞由 agent 完成（intel 蓝图：不自动外发）。',
    '参照：星火知识库只读（SPARKOS_KNOWLEDGE_ROOT），本融合不写入星火库。',
    '数据源：当日 ingest 快照（observedAt 本地日期归类；晚落盘可重跑融合补齐）。',
    items.length === 0 ? '当日无新稿。' : '当日新稿 ' + items.length + ' 条，覆盖源 ' + new Set(items.map((i) => i.source)).size + ' 个。',
    dupGroups.length > 0 ? '疑似重复主题 ' + dupGroups.length + ' 组（见文末，仅供判断）。' : '无疑似重复主题。',
  ]
  const out: FusionOutput & { files: string[] } = {
    date: stamp,
    generatedAt: new Date().toISOString(),
    items,
    notes,
    dupGroups,
    files: [],
  }
  const jsonFile = path.join(fusionDir, 'fusion-' + stamp + '.json')
  const mdFile = path.join(fusionDir, 'fusion-' + stamp + '.md')
  writeFileSync(jsonFile, JSON.stringify({ date: out.date, generatedAt: out.generatedAt, items, notes, dupGroups }, null, 2) + '\n')
  const byKey = new Map(items.map((i) => [i.eventKey, i]))
  const dupSection = dupGroups.length > 0
    ? ['', '## ⚠️ 疑似重复主题（机械聚类提示，供判断，不自动合并）', '',
        ...dupGroups.map((g) => '- ' + g.map((k) => (byKey.get(k)?.title ?? k)).join('  ~  ')), ''].join('\n')
    : ''
  const md = [
    '# 情报融合 ' + stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8),
    '',
    ...notes.map((n) => '> ' + n),
    '',
    ...(items.length === 0
      ? ['（当日无新稿）']
      : [
          '| eventKey | 源 | 状态 | 标题 |',
          '| --- | --- | --- | --- |',
          ...items.map((i) => '| ' + i.eventKey + ' | ' + i.source + ' | ' + i.status + ' | ' + i.title.replace(/\|/g, '\\|') + ' |'),
        ]),
    dupSection,
  ].join('\n')
  writeFileSync(mdFile, md)
  out.files = [jsonFile, mdFile]
  return out
}