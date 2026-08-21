/**
 * 每日工作流运行时产物读取（工作台/工具共用的只读数据层）。
 *
 * sparkos-daily skill 的真实产出区在运行时根（默认 contentos-x）：
 *   daily_brief/daily_data_YYYY-MM-DD.json、daily_briefing_*.md、drafts/
 *   obsidian-bridge/distill_queue/（蒸馏候选）
 *   perf/*.json（发布表现）
 * 本模块对以上全部只读；写侧只有 VAULT state/（决策、蒸馏审核、待写回清单）。
 * 路径均可用 SPARKOS_* env 覆盖（见 vault.ts）。
 * @module dsh-sparkos/src/daily
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  VAULT_ROOT,
  CONTENTOS_ROOT,
  DAILY_BRIEF_DIR,
  PERF_DIR,
  RUNTIME_DISTILL_QUEUE,
  RUNTIME_EVENTS,
} from './vault.ts'

// ---- 类型（对齐 DESIGN.md §3.3 与实测 daily_data_*.json） ----

export interface DailyMustRead {
  event_id: string
  title?: string
  fresh_hours?: number
  supporting?: Array<{ source?: string; angle?: string }>
  primary_line?: string
}

export interface DailyLineUpdate {
  line?: string
  status?: string
  evidence_event_ids?: string[]
  last_peak?: string
}

export interface DailyDraft {
  platform?: string
  hook?: string
  cited_cards?: string[]
  path?: string
}

export interface DailySuggestion {
  type?: string
  note?: string
}

export interface DailyDistillCandidate {
  kind?: string
  title?: string
  path?: string
}

export interface DailyData {
  date: string
  must_reads?: DailyMustRead[]
  line_updates?: DailyLineUpdate[]
  citations?: Array<{ draft?: string; cards?: string[] }>
  drafts?: DailyDraft[]
  suggestions?: DailySuggestion[]
  distill_candidates?: DailyDistillCandidate[]
}

export interface DailyBriefing {
  date: string
  text: string
  path: string
}

export interface DistillEntry {
  file: string
  /** runtime=skill 真实候选区（contentos-x）；vault=插件本地队列。 */
  dir: 'runtime' | 'vault'
  path: string
  summary: string
  targets: string[]
  content: string
}

export interface DraftFile {
  file: string
  path: string
  platform?: string
  preview: string
  bytes: number
  mtime: number
}

export interface PerfPost {
  title?: string
  published_at?: string
  read_count?: number
  like_count?: number
  share_count?: number
  comment_count?: number
  cited_cards?: string[]
  line?: string
}

export interface PerfFile {
  platform?: string
  exported_at?: string
  posts?: PerfPost[]
}

export interface PerfSummary {
  files: number
  totalPosts: number
  platforms: Array<{
    platform: string
    posts: number
    totalReads: number
    avgReads: number
    last: string
  }>
}

export interface InfoSources {
  rss?: Array<{ name?: string; url?: string; tags?: string[] }>
  x_lists?: Array<{ name?: string; accounts?: string[]; tags?: string[] }>
  local_knowledge?: Record<string, string>
}

// ---- 工具 ----

function listBy(dir: string, re: RegExp): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => re.test(f))
      .sort()
      .reverse()
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

function readIf(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function jsonIf<T>(file: string): T | null {
  const raw = readIf(file)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---- daily_data ----

export function listDailyDataFiles(): string[] {
  return listBy(DAILY_BRIEF_DIR, /^daily_data_\d{4}-\d{2}-\d{2}\.json$/)
}

export function latestDailyData(): DailyData | null {
  const files = listDailyDataFiles()
  if (files.length === 0) return null
  return jsonIf<DailyData>(files[0])
}

// ---- daily_briefing ----

export function listBriefings(): DailyBriefing[] {
  return listBy(DAILY_BRIEF_DIR, /^daily_briefing_.*\.md$/).flatMap((p) => {
    const text = readIf(p)
    if (text === null) return []
    const base = path.basename(p)
    const m = /^daily_briefing_(\d{4}-\d{2}-\d{2})/.exec(base)
    return [{ date: m?.[1] ?? base, text, path: p }]
  })
}

export function latestBriefing(): DailyBriefing | null {
  return listBriefings()[0] ?? null
}

// ---- drafts ----

function draftsOf(dir: string): DraftFile[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .map((f) => {
        const p = path.join(dir, f)
        const raw = readIf(p) ?? ''
        const st = (() => { try { return statSync(p) } catch { return null } })()
        return {
          file: f,
          path: p,
          platform: f.replace(/\.md$/, ''),
          preview: raw.split('\n').slice(0, 6).join('\n').slice(0, 400),
          bytes: raw.length,
          mtime: st?.mtimeMs ?? 0,
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

/** 运行时草稿（skill 产出：daily_brief/drafts/）。 */
export function listRuntimeDrafts(): DraftFile[] {
  return draftsOf(path.join(DAILY_BRIEF_DIR, 'drafts'))
}

/** 插件本地草稿（VAULT/drafts/）。 */
export function listVaultDrafts(): DraftFile[] {
  return draftsOf(path.join(VAULT_ROOT, 'drafts'))
}

export function readDraft(absPath: string): string | null {
  return readIf(absPath)
}

// ---- perf（发布表现） ----

export function listPerf(): PerfSummary {
  const files = listBy(PERF_DIR, /\.json$/)
  const byPlatform = new Map<string, { posts: number; totalReads: number; last: string }>()
  let totalPosts = 0
  for (const p of files) {
    const f = jsonIf<PerfFile>(p)
    if (!f) continue
    const posts = Array.isArray(f.posts) ? f.posts : []
    const platform = f.platform ?? path.basename(p, '.json')
    const acc = byPlatform.get(platform) ?? { posts: 0, totalReads: 0, last: '' }
    for (const post of posts) {
      acc.posts += 1
      totalPosts += 1
      acc.totalReads += Number(post.read_count) || 0
      if (typeof post.published_at === 'string' && post.published_at > acc.last) acc.last = post.published_at
    }
    byPlatform.set(platform, acc)
  }
  return {
    files: files.length,
    totalPosts,
    platforms: [...byPlatform.entries()]
      .map(([platform, acc]) => ({
        platform,
        posts: acc.posts,
        totalReads: acc.totalReads,
        avgReads: acc.posts > 0 ? Math.round(acc.totalReads / acc.posts) : 0,
        last: acc.last,
      }))
      .sort((a, b) => b.totalReads - a.totalReads),
  }
}

// ---- distill 队列（runtime + vault 合并，runtime 优先） ----

function parseDistillEntry(file: string, dir: 'runtime' | 'vault', p: string): DistillEntry {
  const raw = readIf(p) ?? ''
  const title = /^title:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? file
  const targets = [...raw.matchAll(/^lines?:\s*\[(.+)\]$/gm), ...raw.matchAll(/^line:\s*(.+)$/gm)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter((s) => s !== '')
  const body = raw.split(/^---\s*$/m)[2]?.trim() ?? raw.trim()
  return { file, dir, path: p, summary: title + (body !== '' ? ' — ' + body.slice(0, 120) : ''), targets, content: raw }
}

export function listDistillQueue(): DistillEntry[] {
  const merged = new Map<string, DistillEntry>()
  for (const p of listBy(RUNTIME_DISTILL_QUEUE, /\.md$/)) {
    const f = path.basename(p)
    merged.set(f, parseDistillEntry(f, 'runtime', p))
  }
  for (const p of listBy(path.join(VAULT_ROOT, 'distill_queue'), /\.md$/)) {
    const f = path.basename(p)
    if (!merged.has(f)) merged.set(f, parseDistillEntry(f, 'vault', p))
  }
  return [...merged.values()].sort((a, b) => a.file.localeCompare(b.file))
}

export function findDistillEntry(file: string): DistillEntry | null {
  // 防路径越界：只允许纯文件名（拒绝 / \\ .. 与空串）
  if (file === '' || file.includes('/') || file.includes('\\') || file.includes('..') || file.includes('\u0000')) return null
  const runtime = path.join(RUNTIME_DISTILL_QUEUE, file)
  if (existsSync(runtime)) return parseDistillEntry(file, 'runtime', runtime)
  const vault = path.join(VAULT_ROOT, 'distill_queue', file)
  if (existsSync(vault)) return parseDistillEntry(file, 'vault', vault)
  return null
}

// ---- 运行时事件账本（skill 提交处；缺失回退 VAULT 账本） ----

export function runtimeEventsCount(): number {
  const countLines = (p: string): number | null => {
    const raw = readIf(p)
    if (raw === null) return null
    return raw.split('\n').filter((l) => l.trim() !== '').length
  }
  return countLines(RUNTIME_EVENTS) ?? countLines(path.join(VAULT_ROOT, 'archive', 'events.jsonl')) ?? 0
}

// ---- 信息源注册表（只读） ----

export function infoSources(): InfoSources | null {
  return jsonIf<InfoSources>(path.join(CONTENTOS_ROOT, 'config', 'info_sources.json'))
}