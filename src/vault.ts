/**
 * VAULT（数据区）路径解析与初始化迁移。
 *
 * 插件自己的数据在 ~/.dsh/sparkos（可用 SPARKOS_VAULT_ROOT 改）。
 * 知识库、每日产物、情报归档都是可选的只读目录，不设个人默认路径。
 * @module dsh-sparkos/src/vault
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function envPath(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : fallback
}

/** 未设置或空白时返回 null，不回落到任何本机目录。 */
export function envOrNull(name: string): string | null {
  const v = process.env[name]
  if (!v || v.trim() === '') return null
  return v.trim()
}

export const VAULT_ROOT = envPath('SPARKOS_VAULT_ROOT', path.join(homedir(), '.dsh', 'sparkos'))

/** 只读知识库。未配置时为空字符串，引用卡校验视为不存在，不会去读别人的目录。 */
export const KNOWLEDGE_ROOT = envOrNull('SPARKOS_KNOWLEDGE_ROOT') ?? ''

/** 可选的外部运行时根。未设置时，每日产物放在 VAULT 里并自动创建。 */
const CONTENTOS_OVERRIDE = envOrNull('SPARKOS_CONTENTOS_ROOT')
export const CONTENTOS_ROOT: string | null = CONTENTOS_OVERRIDE

function underExternalOrVault(envName: string, relative: string): string {
  const explicit = envOrNull(envName)
  if (explicit) return explicit
  if (CONTENTOS_OVERRIDE) return path.join(CONTENTOS_OVERRIDE, relative)
  return path.join(VAULT_ROOT, relative)
}

export const TIMELINE_DATA = envPath('SPARKOS_TIMELINE_DATA', path.join(VAULT_ROOT, 'config', 'timeline_cards.json'))
export const DAILY_BRIEF_DIR = underExternalOrVault('SPARKOS_DAILY_BRIEF_DIR', 'daily_brief')
export const PERF_DIR = underExternalOrVault('SPARKOS_PERF_DIR', 'perf')
export const RUNTIME_DISTILL_QUEUE = underExternalOrVault('SPARKOS_RUNTIME_DISTILL_QUEUE', 'distill_queue')
export const RUNTIME_EVENTS = underExternalOrVault('SPARKOS_RUNTIME_EVENTS', path.join('archive', 'events.jsonl'))

/** 首次迁移的种子资产：外部运行时存在则优先，否则用包内 seeds/。 */
const MIGRATION: ReadonlyArray<{ runtime: string | null; seed: string; dest: string; note: string }> = [
  { runtime: CONTENTOS_OVERRIDE ? path.join(CONTENTOS_OVERRIDE, 'config', 'narrative_lines.json') : null, seed: 'narrative_lines.json', dest: 'config/narrative_lines.json', note: '叙事主线' },
  { runtime: CONTENTOS_OVERRIDE ? path.join(CONTENTOS_OVERRIDE, 'config', 'line_names.json') : null, seed: 'line_names.json', dest: 'config/line_names.json', note: '主线命名' },
  { runtime: CONTENTOS_OVERRIDE ? path.join(CONTENTOS_OVERRIDE, 'archive', 'events.jsonl') : null, seed: 'events.jsonl', dest: 'archive/events.jsonl', note: '事件账本' },
  { runtime: CONTENTOS_OVERRIDE ? path.join(CONTENTOS_OVERRIDE, 'config', 'timeline_cards.json') : null, seed: 'timeline_cards.json', dest: 'config/timeline_cards.json', note: '知识卡' },
  { runtime: CONTENTOS_OVERRIDE ? path.join(CONTENTOS_OVERRIDE, 'config', 'info_sources.json') : null, seed: 'info_sources.json', dest: 'config/info_sources.json', note: '信息源注册表' },
]

function migrationSource(item: { runtime: string | null; seed: string }): string {
  if (item.runtime && existsSync(item.runtime)) return item.runtime
  return fileURLToPath(new URL('../seeds/' + item.seed, import.meta.url))
}

export interface MigrationResult {
  migrated: Array<{ dest: string; note: string }>
  alreadyPresent: string[]
  vaultRoot: string
}

function copySeed(vaultRoot: string, seed: string, destRelative: string): void {
  const dest = path.join(vaultRoot, destRelative)
  if (existsSync(dest)) return
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(fileURLToPath(new URL('../seeds/' + seed, import.meta.url)), dest)
}

/** 没有简报时放一份示例，打开页面就能看到内容。已有简报则不动。 */
function ensureSampleBrief(vaultRoot: string): void {
  const dir = path.join(vaultRoot, 'daily_brief')
  mkdirSync(path.join(dir, 'drafts'), { recursive: true })
  let hasBrief = false
  try {
    hasBrief = readdirSync(dir).some((name) => name.startsWith('daily_briefing_') && name.endsWith('.md'))
  } catch { hasBrief = false }
  if (hasBrief) return
  copySeed(vaultRoot, 'sample_daily_briefing.md', 'daily_brief/daily_briefing_2000-01-01.md')
  copySeed(vaultRoot, 'sample_daily_data.json', 'daily_brief/daily_data_2000-01-01.json')
}

/** 幂等初始化：已有文件不覆盖，缺目录会创建。 */
export function initVault(vaultRoot = VAULT_ROOT): MigrationResult {
  mkdirSync(vaultRoot, { recursive: true })
  const migrated: Array<{ dest: string; note: string }> = []
  const alreadyPresent: string[] = []
  for (const item of MIGRATION) {
    const destAbs = path.join(vaultRoot, item.dest)
    mkdirSync(path.dirname(destAbs), { recursive: true })
    if (existsSync(destAbs)) {
      alreadyPresent.push(item.dest)
      continue
    }
    copyFileSync(migrationSource(item), destAbs)
    migrated.push(item)
  }
  for (const dir of ['state', 'distill_queue', 'drafts', 'perf', 'daily_brief']) {
    mkdirSync(path.join(vaultRoot, dir), { recursive: true })
  }
  ensureSampleBrief(vaultRoot)
  const manifestPath = path.join(vaultRoot, 'MANIFEST')
  const stamp = new Date().toISOString()
  const lines = readManifest(manifestPath)
  for (const m of migrated) {
    const source = MIGRATION.find((x) => x.dest === m.dest)
    lines.push(`${stamp}\t${m.dest}\t${m.note}\tsrc=${source ? migrationSource(source) : '?'}`)
  }
  if (migrated.length > 0) writeFileSync(manifestPath, `${lines.join('\n')}\n`)
  return { migrated, alreadyPresent, vaultRoot }
}

function readManifest(p: string): string[] {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim() !== '')
}
