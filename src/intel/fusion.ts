/**
 * M1 · 日频判断融合：输入当天 ingest 快照（ops-intel/ingest/，时间已归一），
 * 输出 ops-intel/fusion/fusion-YYYYMMDD.md + .json。每条判断必须回链 ≥1 个 eventKey。
 *
 * 数据源用 ingest 快照而非源 archive 的原因：
 * 1) 源文件名时区不统一，按文件名前缀归类会错天；
 *    快照 observedAt 是 ISO，统一转本地日期归类。
 * 2) 源落盘有延迟，只要当天被 ingest 就能进当日融合；
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
import type { IntelConfig, IntelSourceDef } from './ingest.ts'

export interface FusionItem {
  eventKey: string
  source: string
  status: string
  title: string
  observedAt: string
  /** 关键证据 URL（来自快照 raw.source_hint.url / raw.url / raw.link）。 */
  evidenceUrl: string
  /**
   * 归一化到 0-100 的**源注意力信号**；null = 该源不提供（如 alpha-signal）。
   * 这是「真实热度」的唯一来源——此前 cluster.heat 只由「合并了几条」合成，
   * 导致 heat 恒为 low、跨源升级规则从未触发。
   */
  heat: number | null
  /** 源标注的突发标记（hermes 顶层 breaking / alpha source_hint.breaking）。 */
  breaking: boolean
  /** 源给出的主题标签（hermes watch_hits.topics）；供补卡与主线匹配使用。 */
  topics: string[]
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
  const item = raw.item as Record<string, unknown> | undefined
  const draft = raw.draft as Record<string, unknown> | undefined
  // 结构化字段优先：item.url 是快照里最干净的绝对地址，必须排在正文兜底之前。
  const direct = sh?.url ?? raw.url ?? raw.link ?? item?.url
  if (typeof direct === 'string' && direct !== '') return direct
  // 兜底：正文快照的 URL 在 channel_text/text「▎来源：… https://…」里。
  // 引号/尖括号必须进排除集，否则 <a href="…">阅读原文</a> 会把 HTML 尾巴带进 URL。
  for (const t of [raw.channel_text, raw.text, item?.text, draft?.text]) {
    if (typeof t === 'string') {
      const m = /https?:\/\/[^\s"'<>()]+/.exec(t)
      if (m) return m[0]
    }
  }
  return ''
}

function titleOf(raw: Record<string, unknown>): string {
  const draft = raw.draft as Record<string, unknown> | undefined
  const item = raw.item as Record<string, unknown> | undefined
  const t = draft?.title ?? item?.title ?? raw.title
  return typeof t === 'string' && t !== '' ? t : '(无标题)'
}

/** HN points 对数映射的参考上限（实测 14 天 max 1431）；把长尾压进 0-100。 */
const HN_POINTS_REF = 1201

/**
 * GitHub trending 的 score 是**累计 star**（实测 35k ~ 1,079,623），不是今日热度：
 * 直接当热度会让所有 GitHub 条目顶格，且老牌仓库永远赢。只作为「登上 trending」
 * 的中等信号，不参与热度排序的高分段。
 */
const GITHUB_TRENDING_HEAT = 55

/**
 * 源注意力信号 → 0-100。null 表示该源不提供热度（不要用 0 冒充「没热度」）。
 *
 * 三源实测（2026-09-10）：
 *  - hn：score 就是 HN points（1~1431，中位 105）→ 对数映射（1→10, 112→67, 544→89, 1162→100）
 *  - hn 里的 github 条目：score 是累计 star → 固定中等信号
 *  - hermes-cn：**不用 item.heat**。实测它与人工审核标记不相关
 *    （heat=100 的 48 条里仅 2 条 strong，而 strong 集中在 85/90）→ 改用 breaking/strong
 *  - alpha-signal：无任何热度字段 → null
 */
export function sourceHeatOf(raw: Record<string, unknown>): number | null {
  const score = raw.score
  if (typeof score === 'number' && Number.isFinite(score)) {
    if (raw.source === 'github') return GITHUB_TRENDING_HEAT
    const mapped = (100 * Math.log10(score + 1)) / Math.log10(HN_POINTS_REF)
    return Math.max(0, Math.min(100, Math.round(mapped)))
  }
  // hermes 类快照（正文解析在 raw.item）：用人工审核标记，而不是那个不相关的 item.heat
  const item = raw.item as Record<string, unknown> | undefined
  if (item !== undefined && item !== null && typeof item === 'object') {
    if (raw.strong === true && raw.breaking === true) return 70
    if (raw.strong === true) return 60
    if (raw.breaking === true) return 45
    return 25
  }
  return null
}

/** 源标注的突发标记：hermes 顶层 breaking / alpha source_hint.breaking。 */
export function breakingOf(raw: Record<string, unknown>): boolean {
  const sh = raw.source_hint as Record<string, unknown> | undefined
  const item = raw.item as Record<string, unknown> | undefined
  return raw.breaking === true || sh?.breaking === true || item?.breaking === true
}

/** 源给出的主题标签（hermes watch_hits.topics）。 */
export function topicsOf(raw: Record<string, unknown>): string[] {
  const wh = raw.watch_hits as Record<string, unknown> | undefined
  const t = wh?.topics
  if (!Array.isArray(t)) return []
  return t.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

// ---- 重复主题聚类（无依赖，Jaccard 字符 bigram） ----

/** 标题归一化：去标点空白，保字母数字中文。 */
function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * 特征集合：中日韩字符按**单字**入集，拉丁/数字连续串按**双字符 bigram** 入集。
 *
 * 为什么必须分开：单字符集合对英文完全失效——任何两条英文标题都共享大量字母，
 * 实测「Larger Pacific Striped Octopus」vs「What do Visa and Mastercard do?」得 0.62、
 * 「Shopify acquires Tailwind」vs「What algorithm did Windows XP use」得 0.83，
 * 全部越过 0.5 阈值。混合特征下同样的对子降到 0.21 / 0.18，而同主题的
 * 「苹果发布 Apple Watch Series 12…」vs「Apple Watch Series 12」反而升到 0.71。
 * 纯中文标题行为与旧实现逐位一致（中文侧仍是单字集合）。
 */
function grams(s: string): Set<string> {
  const out = new Set<string>()
  const token = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+/gu
  for (const m of s.matchAll(token)) {
    const tok = m[0]
    if (tok.length === 1) { out.add(tok); continue }
    for (let i = 0; i < tok.length - 1; i++) out.add(tok.slice(i, i + 2))
  }
  return out
}

/** Sørensen–Dice：2*inter/(|A|+|B|)。实测（混合特征）：伊朗制裁 a/b=0.58（聚）；a/驾校乱象=0.06（不聚）。 */
export function titleSimilarity(a: string, b: string): number {
  const A = grams(titleKey(a))
  const B = grams(titleKey(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  const sum = A.size + B.size
  return sum === 0 ? 0 : (2 * inter) / sum
}

/**
 * 疑似同主题聚类：相似度 ≥ threshold 的标题归并，返回长度 >1 的组（eventKey 列表）。
 *
 * 用**领头聚类（leader clustering）**而不是并查集单链：
 * 单链会把 A~B、B~C 但 A≁C 的条目串成一个大组。实测接入 HN 后，
 * 英文标题的字符重合度高，单链把 19 条毫不相关的新闻（Apple Watch / Stockfish /
 * 章鱼 / Visa 卡组织）串成一个巨组，建簇时凭空造出一个「high 热度」簇排到第一。
 * 领头聚类只与组代表标题比较，杜绝链式传递；调用方按 eventKey 排序传入 → 结果确定。
 */
export function clusterDuplicates(items: FusionItem[], threshold = 0.5): string[][] {
  const groups: Array<{ rep: string; keys: string[] }> = []
  for (const it of items) {
    const hit = groups.find((g) => titleSimilarity(g.rep, it.title) >= threshold)
    if (hit) hit.keys.push(it.eventKey)
    else groups.push({ rep: it.title, keys: [it.eventKey] })
  }
  return groups.filter((g) => g.keys.length > 1).map((g) => g.keys)
}

/** 快照分类：正文稿在 raw.item.category，线索稿在 raw.source_hint.category。 */
function categoryOf(raw: Record<string, unknown>): string {
  const item = raw.item as Record<string, unknown> | undefined
  const sh = raw.source_hint as Record<string, unknown> | undefined
  const c = item?.category ?? sh?.category
  return typeof c === 'string' ? c.trim() : ''
}

/**
 * 源级闸门：`categories`（分类）与 `topicsAllow`（主题）是**「或」关系**，任一命中即放行；
 * 两者都未配置 = 全收。
 *
 * 为什么需要「或」：纯分类门会误杀落在非白名单版块的主线相关稿件。实测 hermes-cn
 * 14 天里时政要闻 4 条 + 国际动态 1 条命中 AI/科技主题却被分类门挡在外面。
 */
function passesSourceGate(def: IntelSourceDef | undefined, raw: Record<string, unknown>): boolean {
  const cats = def?.categories
  const tops = def?.topicsAllow
  const hasCat = Array.isArray(cats) && cats.length > 0
  const hasTop = Array.isArray(tops) && tops.length > 0
  if (!hasCat && !hasTop) return true
  if (hasCat && cats.includes(categoryOf(raw))) return true
  if (hasTop && topicsOf(raw).some((t) => tops.includes(t))) return true
  return false
}

/** 当日（本地时区）被 ingest 的快照清单（只读；observedAt 转本地日期归类）。 */
export function collectDailyItems(cfg: IntelConfig, date: Date, stats?: { filtered: Record<string, number> }): FusionItem[] {
  const day = localDate(date)
  const items: FusionItem[] = []
  if (!existsSync(cfg.outDir)) return items
  for (const source of readdirSync(cfg.outDir)) {
    const sub = path.join(cfg.outDir, source)
    try { if (!statSync(sub).isDirectory()) continue } catch { continue }
    // 源级闸门：分类白名单与主题白名单是「或」关系，都未配则全收（快照仍全量保留在 vault）。
    const gate = cfg.sources.find((s) => s.id === source)
    for (const f of readdirSync(sub)) {
      if (!f.endsWith('.snapshot.json')) continue
      let snap: Record<string, unknown>
      try { snap = JSON.parse(readFileSync(path.join(sub, f), 'utf8')) as Record<string, unknown> } catch { continue }
      const observedAt = typeof snap.observedAt === 'string' ? snap.observedAt : ''
      if (observedAt === '' || localDateOf(observedAt) !== day) continue
      const raw = (snap.raw ?? {}) as Record<string, unknown>
      if (!passesSourceGate(gate, raw)) {
        if (stats) stats.filtered[source] = (stats.filtered[source] ?? 0) + 1
        continue
      }
      items.push({
        eventKey: String(snap.eventKey ?? f.slice(0, -'.snapshot.json'.length)),
        source: String(snap.source ?? source),
        status: String(snap.status ?? 'unknown'),
        title: titleOf(raw),
        observedAt,
        evidenceUrl: evidenceUrlOf(raw),
        heat: sourceHeatOf(raw),
        breaking: breakingOf(raw),
        topics: topicsOf(raw),
      })
    }
  }
  return items.sort((a, b) => a.eventKey.localeCompare(b.eventKey))
}

export function fuseDaily(cfg: IntelConfig, date = new Date()): FusionOutput & { files: string[] } {
  const fusionDir = path.join(path.dirname(cfg.outDir), 'fusion')
  mkdirSync(fusionDir, { recursive: true })
  const stamp = localDate(date)
  const filtered: Record<string, number> = {}
  const items = collectDailyItems(cfg, date, { filtered })
  const dupGroups = clusterDuplicates(items)
  const filteredTotal = Object.values(filtered).reduce((a, b) => a + b, 0)
  const notes = [
    '机械装配清单：每条带 eventKey 回链；判断与措辞由 agent 完成（intel 蓝图：不自动外发）。',
    '参照：星火知识库只读（SPARKOS_KNOWLEDGE_ROOT），本融合不写入星火库。',
    '数据源：当日 ingest 快照（observedAt 本地日期归类；晚落盘可重跑融合补齐）。',
    items.length === 0 ? '当日无新稿。' : '当日新稿 ' + items.length + ' 条，覆盖源 ' + new Set(items.map((i) => i.source)).size + ' 个。',
    ...(filteredTotal > 0
      ? ['源闸门（分类/主题）过滤 ' + filteredTotal + ' 条（' + Object.entries(filtered).map(([s, n]) => s + ' ' + n).join('、') + '）；快照仍全量保留，可调白名单重跑。']
      : []),
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
          '| eventKey | 源 | 状态 | 热度 | 标题 |',
          '| --- | --- | --- | --- | --- |',
          ...items.map((i) => '| ' + i.eventKey + ' | ' + i.source + ' | ' + i.status + ' | '
            + (i.heat === null ? '—' : String(i.heat)) + ' | ' + i.title.replace(/\|/g, '\\|') + ' |'),
        ]),
    dupSection,
  ].join('\n')
  writeFileSync(mdFile, md)
  out.files = [jsonFile, mdFile]
  return out
}