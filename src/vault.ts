/**
 * VAULT（数据区）路径解析与初始化迁移。
 *
 * 合并版：保留上游「数据跟 DSH_HOME 走、不设个人默认路径」的骨架，
 * 同时兼容本机既有数据目录（已存在时优先，避免升级后看起来「数据没了」）。
 *
 * 优先级：SPARKOS_VAULT_ROOT → 已存在的 ~/DeepSeek harness/sparkos → $DSH_HOME/sparkos → ~/.dsh/sparkos。
 * 第二项存在即优先：这是升级兼容，不是默认值（新装环境没有该目录，会直接走 DSH_HOME）。
 * 知识库 / 编辑侧 OS / 每日产物默认指向本机既有目录，均可被环境变量覆盖。
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

/** 展开 `~`、`~/`、`~\`。其余原样返回。与 dsh-home-paths 的规则一致。 */
export function expandHomePath(input: string, home = homedir()): string {
  if (input === '~') return home
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(home, input.slice(2))
  return input
}

/**
 * 插件数据目录。
 * 优先级：SPARKOS_VAULT_ROOT → 既有的 ~/DeepSeek harness/sparkos → $DSH_HOME/sparkos → ~/.dsh/sparkos。
 * 空白的 DSH_HOME 当作没设，避免落到当前工作目录。
 */
export function resolveVaultRoot(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  const explicit = env.SPARKOS_VAULT_ROOT
  if (explicit !== undefined && explicit.trim() !== '') return path.resolve(expandHomePath(explicit.trim(), home))
  const fromEnv = env.DSH_HOME
  // 既有数据目录优先：升级接入时不让旧账本「消失」。新装环境没有这个目录，会照常跟随 DSH_HOME。
  const legacy = path.join(home, 'DeepSeek harness', 'sparkos')
  if (existsSync(legacy)) return path.resolve(legacy)
  const dshHome = fromEnv !== undefined && fromEnv.trim() !== ''
    ? expandHomePath(fromEnv.trim(), home)
    : path.join(home, '.dsh')
  return path.resolve(dshHome, 'sparkos')
}

export const VAULT_ROOT = resolveVaultRoot()

/** 只读知识库（G3 引用卡校验）。 */
export const KNOWLEDGE_ROOT = envPath('SPARKOS_KNOWLEDGE_ROOT', path.join(homedir(), 'cow', 'knowledge'))

/** 每日工作流运行时根（sparkos-daily skill 的真实产出区，工作台只读）。 */
export const CONTENTOS_ROOT = envPath('SPARKOS_CONTENTOS_ROOT', path.join(homedir(), 'cow', 'projects', 'contentos-x'))

/**
 * 编辑侧内容 OS（New City 13）：选题池 / 30 天排期 / 数据主表。
 * 与 CONTENTOS_ROOT（每日循环引擎）是两套资产，**全程只读**。
 */
export const MEDIA_OS_ROOT = envPath('SPARKOS_MEDIA_OS_ROOT', path.join(homedir(), 'DeepSeek harness', 'media-os'))

function underExternalOrVault(envName: string, relative: string): string {
  const explicit = envOrNull(envName)
  if (explicit) return explicit
  return path.join(CONTENTOS_ROOT, relative)
}

export const TIMELINE_DATA = envPath('SPARKOS_TIMELINE_DATA', path.join(VAULT_ROOT, 'config', 'timeline_cards.json'))
export const DAILY_BRIEF_DIR = underExternalOrVault('SPARKOS_DAILY_BRIEF_DIR', 'daily_brief')
export const PERF_DIR = underExternalOrVault('SPARKOS_PERF_DIR', 'perf')
export const RUNTIME_DISTILL_QUEUE = underExternalOrVault('SPARKOS_RUNTIME_DISTILL_QUEUE', path.join('obsidian-bridge', 'distill_queue'))
export const RUNTIME_EVENTS = underExternalOrVault('SPARKOS_RUNTIME_EVENTS', path.join('archive', 'events.jsonl'))

/** 运行时资产存在则优先，否则用包内 seeds/（干净环境可独立初始化）。 */
function runtimeIf(relative: string): string | null {
  const p = path.join(CONTENTOS_ROOT, relative)
  return existsSync(p) ? p : null
}

const MIGRATION: ReadonlyArray<{ runtime: string | null; seed: string; dest: string; note: string }> = [
  { runtime: runtimeIf(path.join('config', 'narrative_lines.json')), seed: 'narrative_lines.json', dest: 'config/narrative_lines.json', note: '叙事主线' },
  { runtime: runtimeIf(path.join('config', 'line_names.json')), seed: 'line_names.json', dest: 'config/line_names.json', note: '主线命名' },
  { runtime: runtimeIf(path.join('archive', 'events.jsonl')), seed: 'events.jsonl', dest: 'archive/events.jsonl', note: '事件账本' },
  { runtime: runtimeIf(path.join('config', 'timeline_cards.json')), seed: 'timeline_cards.json', dest: 'config/timeline_cards.json', note: '知识卡' },
  { runtime: runtimeIf(path.join('config', 'info_sources.json')), seed: 'info_sources.json', dest: 'config/info_sources.json', note: '信息源注册表' },
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
