/**
 * M0 · intel 快照接入：只读扫描两条管道的 state/archive，
 * 输出增量快照到 VAULT/ops-intel/ingest/。幂等（同 eventKey 零新增），
 * 快照保留 14 天滚动。绝不写入源目录（只读红线）。
 * @module dsh-sparkos/src/intel/ingest
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { KNOWLEDGE_ROOT, VAULT_ROOT, envPath } from '../vault.ts'

export type SnapshotStatus = 'ok' | 'blocked' | 'rejected' | 'expired' | 'unknown'

export interface IntelSourceDef {
  id: string
  /** 只读源 archive 目录；null 表示待接入源（pending-source）。 */
  dir: string | null
  /** 健康阈值（小时）：最新 published 距今超过即标红。 */
  maxStalenessHours: number
  /** 文件名 glob 简化形式：alpha 全量 *.json；hermes-cn 仅 *.published.json。 */
  pattern: 'all' | 'published-only'
  /**
   * 分类白名单（缺省或空数组 = 不过滤）：命中快照 raw.item.category 或
   * raw.source_hint.category 才进入当日融合。用于把综合新闻管道里与内容主线
   * 无关的版块挡在情报层之外；快照仍全量保留，调白名单可重跑融合。
   */
  categories?: string[]
  /**
   * 主题白名单（与 categories 是**「或」关系**）：命中快照 `raw.watch_hits.topics` 即放行。
   *
   * 用途：救回「落在非白名单版块、但确实与内容主线相关」的稿件。纯分类门会误杀——
   * 实测 14 天里时政要闻 4 条 + 国际动态 1 条命中 AI/科技主题却被挡，
   * 例如「中国官方将启动教师人工智能素养全覆盖培训」（topics=['人工智能']）。
   */
  topicsAllow?: string[]
  /**
   * 文件名前缀过滤（缺省 = 不限）。用于在混合目录里只取本源的快照，
   * 例如 FeedFuse 快照目录 `knowledge/sources/raw/` 里只取 `tech-ai-`。
   */
  filePrefix?: string
  /**
   * 多条目馈送：该源的一个文件是**一个 JSON 数组**，每个元素是一条独立事件
   * （如 FeedFuse/HN 快照 tech-ai-*.json）。开启后按条目展开为独立 eventKey。
   *
   * eventKey 由条目 URL 内容哈希生成 → **同一新闻跨天/跨波次重放自动去重**。
   * 这正是综合新闻管道「同批重放多日」问题的根治点（按文件名去重无法解决）。
   */
  explodeItems?: boolean
}

export interface IntelConfig {
  sources: IntelSourceDef[]
  outDir: string
  runsDir: string
  keepDays: number
}

/** 默认源（hermes-cn 已收紧白名单；hn 为按条目展开的 FeedFuse 快照）。 */
export function defaultIntelConfig(): IntelConfig {
  return {
    sources: [
      {
        id: 'alpha-signal',
        dir: envPath('SPARKOS_ALPHA_ARCHIVE', path.join(homedir(), '.openclaw', 'telegram-newsroom', 'state', 'archive')),
        maxStalenessHours: 48,
        pattern: 'all',
      },
      {
        id: 'hn',
        // FeedFuse/HN 每日快照（08:01 与 20:00 两波），一文件约 40 条（HN 20 + GitHub 20）。
        // 条目自带真实热度（score/heat，如 856），是情报层唯一的真实热度来源。
        dir: envPath('SPARKOS_HN_ARCHIVE', path.join(KNOWLEDGE_ROOT, 'sources', 'raw')),
        maxStalenessHours: 30,
        pattern: 'all',
        filePrefix: 'tech-ai-',
        explodeItems: true,
      },
      {
        id: 'hermes-cn',
        // 2026-09-01 newsroom-cn 从 ~/.hermes/newsroom-cn 迁出，现位于 ~/newsroom-cn。
        // 仍可用 SPARKOS_HERMES_ARCHIVE 覆盖；旧路径的兼容 symlink 仅作双保险。
        dir: envPath('SPARKOS_HERMES_ARCHIVE', path.join(homedir(), 'newsroom-cn', 'state', 'archive')),
        maxStalenessHours: 24,
        pattern: 'published-only',
        // 综合新闻管道噪声高：只保留与内容主线相关的版块。
        // 2026-09-10 收紧：去掉「国际动态」——14 天实测该版块 63 条里仅 1 条与 AI/科技相关
        // （其余为台风/航母调动/俄美通话等），却占白名单通过量的 39%。去掉后信噪比 20.6%→33.0%。
        categories: ['科技创新', '财经经济'],
        // P0+ 主题门（与分类是「或」关系）：救回落在时政要闻/国际动态里的主线相关稿件。
        // 实测 14 天可救回 5 条，其中「教师人工智能素养全覆盖培训」是条真 AI 政策新闻。
        topicsAllow: ['人工智能', 'AI', '科技', '机器人', '算力', '量子', '芯片', '大模型'],
      },
      { id: 'baicaotang', dir: envPath('SPARKOS_BAICAOTANG_ARCHIVE', '' ) || null, maxStalenessHours: 24, pattern: 'all' },
    ],
    outDir: path.join(VAULT_ROOT, 'ops-intel', 'ingest'),
    runsDir: path.join(VAULT_ROOT, 'ops-intel', 'runs'),
    keepDays: 14,
  }
}

/** eventKey = 文件名第一个点号前的 id 段。 */
export function eventKeyOf(filename: string): string {
  return filename.split('.')[0] ?? filename
}

/**
 * 多条目馈送的条目级 eventKey：对 URL（缺失时退回 title）做内容哈希。
 * 稳定且跨文件去重——同一新闻在 09-10 与 09-11 的快照里得到同一个 key。
 */
export function itemEventKey(sourceId: string, item: Record<string, unknown>): string {
  const seed = typeof item.url === 'string' && item.url !== ''
    ? item.url
    : (typeof item.title === 'string' && item.title !== '' ? item.title : JSON.stringify(item))
  return sourceId + '-' + createHash('sha256').update(seed).digest('hex').slice(0, 16)
}

/** 观察时间：优先源记录的创建/采集时间，退回本轮 ingest 时间（本地日归类依赖它）。 */
export function observedAtOf(raw: Record<string, unknown>, now: Date): string {
  for (const k of ['created_at', 'collected_at', 'published_at'] as const) {
    const v = raw[k]
    if (typeof v === 'string' && v !== '') return v
  }
  return now.toISOString()
}

/** 状态映射：后缀优先，回退 body.status。 */
export function statusOf(filename: string, body: Record<string, unknown>): SnapshotStatus {
  if (/\.published\.json$/.test(filename)) return 'ok'
  if (/\.unsent-scope-blocked\.json$/.test(filename)) return 'blocked'
  if (/\.rejected\.json$/.test(filename)) return 'rejected'
  if (/\.expired\.json$/.test(filename)) return 'expired'
  const s = body.status
  if (s === 'published') return 'ok'
  if (s === 'rejected') return 'rejected'
  if (s === 'expired') return 'expired'
  return 'unknown'
}

export interface IngestSourceResult {
  source: string
  ok: boolean
  error?: string
  scanned: number
  added: number
  skipped: number
}

export interface IngestResult {
  stage: 'ingest'
  at: string
  sources: IngestSourceResult[]
  ok: boolean
}

function listSnapshottedKeys(outDir: string, source: string): Set<string> {
  const keys = new Set<string>()
  const sub = path.join(outDir, source)
  if (!existsSync(sub)) return keys
  for (const f of readdirSync(sub)) {
    if (f.endsWith('.snapshot.json')) keys.add(f.slice(0, -'.snapshot.json'.length))
  }
  return keys
}

/** 14 天滚动清理（按 mtime）。 */
function pruneSnapshots(outDir: string, keepDays: number, now = Date.now()): number {
  let removed = 0
  if (!existsSync(outDir)) return 0
  for (const source of readdirSync(outDir)) {
    const sub = path.join(outDir, source)
    try {
      if (!statSync(sub).isDirectory()) continue
    } catch { continue }
    for (const f of readdirSync(sub)) {
      const p = path.join(sub, f)
      try {
        if (now - statSync(p).mtimeMs > keepDays * 24 * 3600 * 1000) {
          rmSync(p); removed++
        }
      } catch { /* 忽略 */ }
    }
  }
  return removed
}

/** 一轮 ingest：扫描 → 增量落快照。源目录缺失必须显式 fail: source-missing（不静默）。 */
export function runIngest(cfg: IntelConfig, now = new Date()): IngestResult {
  mkdirSync(cfg.outDir, { recursive: true })
  const sources: IngestSourceResult[] = []
  for (const src of cfg.sources) {
    if (src.dir === null) {
      sources.push({ source: src.id, ok: true, scanned: 0, added: 0, skipped: 0, error: 'pending-source' })
      continue
    }
    if (!existsSync(src.dir)) {
      sources.push({ source: src.id, ok: false, error: 'source-missing', scanned: 0, added: 0, skipped: 0 })
      continue
    }
    const files = readdirSync(src.dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .filter((f) => src.pattern === 'all' || /\.published\.json$/.test(f))
      .filter((f) => src.filePrefix === undefined || f.startsWith(src.filePrefix))
      .sort()
    const known = listSnapshottedKeys(cfg.outDir, src.id)
    const sub = path.join(cfg.outDir, src.id)
    mkdirSync(sub, { recursive: true })
    let scanned = 0
    let added = 0
    let skipped = 0
    const emit = (eventKey: string, raw: Record<string, unknown>, rawFile: string, status: SnapshotStatus): void => {
      const snapshot = {
        eventKey,
        source: src.id,
        status,
        observedAt: observedAtOf(raw, now),
        ingestedAt: now.toISOString(),
        rawFile,
        raw,
      }
      writeFileSync(path.join(sub, `${eventKey}.snapshot.json`), `${JSON.stringify(snapshot, null, 2)}\n`)
      known.add(eventKey) // 同轮循环内防同 key 多状态文件互相覆盖（写后即记）
      added++
    }

    for (const f of files) {
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(path.join(src.dir, f), 'utf8'))
      } catch {
        // 原文件不可解析：仍落快照（raw 为空），状态 unknown，不静默丢事件
        parsed = undefined
      }

      // 多条目馈送：数组文件按条目展开，条目级内容哈希去重
      if (src.explodeItems) {
        if (!Array.isArray(parsed)) continue
        scanned += parsed.length
        for (const entry of parsed) {
          if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
          const item = entry as Record<string, unknown>
          const eventKey = itemEventKey(src.id, item)
          if (known.has(eventKey)) { skipped++; continue }
          emit(eventKey, item, f, 'ok')
        }
        continue
      }

      // 常规：一文件一事件
      scanned++
      const eventKey = eventKeyOf(f)
      if (known.has(eventKey)) { skipped++; continue }
      const raw = (parsed ?? {}) as Record<string, unknown>
      emit(eventKey, raw, f, statusOf(f, raw))
    }
    sources.push({ source: src.id, ok: true, scanned, added, skipped })
  }
  pruneSnapshots(cfg.outDir, cfg.keepDays)
  return { stage: 'ingest', at: now.toISOString(), sources, ok: sources.every((s) => s.ok) }
}