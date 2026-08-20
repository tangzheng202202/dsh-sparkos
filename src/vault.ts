/**
 * VAULT（数据区）路径解析与初始化迁移。
 *
 * 数据与代码分离：VAULT = ~/DeepSeek harness/sparkos/（不进 git）；
 * 星火知识库 (/Users/mac/cow/knowledge) 对插件只读，写回仅经 distill_queue 人工审核。
 * @module dsh-sparkos/src/vault
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export function envPath(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : fallback
}

export const VAULT_ROOT = envPath('SPARKOS_VAULT_ROOT', path.join(homedir(), 'DeepSeek harness', 'sparkos'))

/** 只读外部资产（绝不写入）。 */
export const KNOWLEDGE_ROOT = envPath('SPARKOS_KNOWLEDGE_ROOT', '/Users/mac/cow/knowledge')
export const TIMELINE_DATA = envPath('SPARKOS_TIMELINE_DATA', '/Users/mac/cow/visualization/timeline_data.json')

/** 首次迁移的种子资产：源（参考实现，只读） → VAULT 内目标。 */
/** 每日工作流运行时根（sparkos-daily skill 的真实产出区，工作台只读）。 */
export const CONTENTOS_ROOT = envPath('SPARKOS_CONTENTOS_ROOT', '/Users/mac/cow/projects/contentos-x')
/** 每日产物目录：daily_data_*.json / daily_briefing_*.md / drafts/。 */
export const DAILY_BRIEF_DIR = envPath('SPARKOS_DAILY_BRIEF_DIR', path.join(CONTENTOS_ROOT, 'daily_brief'))
/** 发布表现目录：perf/*.json（缺失则发布表现降级为空）。 */
export const PERF_DIR = envPath('SPARKOS_PERF_DIR', path.join(CONTENTOS_ROOT, 'perf'))
/** 运行时蒸馏队列（sparkos-daily skill 写候选处，工作台只读）。 */
export const RUNTIME_DISTILL_QUEUE = envPath('SPARKOS_RUNTIME_DISTILL_QUEUE', path.join(CONTENTOS_ROOT, 'obsidian-bridge', 'distill_queue'))
/** 运行时事件账本（skill 的 validate_daily.py --commit 写这里）。 */
export const RUNTIME_EVENTS = envPath('SPARKOS_RUNTIME_EVENTS', path.join(CONTENTOS_ROOT, 'archive', 'events.jsonl'))

const MIGRATION: ReadonlyArray<{ src: string; dest: string; note: string }> = [
  { src: '/Users/mac/cow/projects/contentos-x/config/narrative_lines.json', dest: 'config/narrative_lines.json', note: '10 叙事主线' },
  { src: '/Users/mac/cow/projects/contentos-x/config/line_names.json', dest: 'config/line_names.json', note: '主线命名' },
  { src: '/Users/mac/cow/projects/contentos-x/archive/events.jsonl', dest: 'archive/events.jsonl', note: '事件账本(7事件)' },
]

export interface MigrationResult {
  migrated: Array<{ dest: string; note: string }>
  alreadyPresent: string[]
  vaultRoot: string
}

/** 幂等初始化：已有文件不覆盖，迁移清单落 vault/MANIFEST。 */
export function initVault(): MigrationResult {
  mkdirSync(VAULT_ROOT, { recursive: true })
  const migrated: Array<{ dest: string; note: string }> = []
  const alreadyPresent: string[] = []
  for (const item of MIGRATION) {
    const destAbs = path.join(VAULT_ROOT, item.dest)
    mkdirSync(path.dirname(destAbs), { recursive: true })
    if (existsSync(destAbs)) {
      alreadyPresent.push(item.dest)
      continue
    }
    copyFileSync(item.src, destAbs)
    migrated.push(item)
  }
  // 保证工作流状态目录存在
  for (const dir of ['state', 'distill_queue', 'drafts']) {
    mkdirSync(path.join(VAULT_ROOT, dir), { recursive: true })
  }
  const manifestPath = path.join(VAULT_ROOT, 'MANIFEST')
  const stamp = new Date().toISOString()
  const lines = readManifest(manifestPath)
  for (const m of migrated) {
    const source = MIGRATION.find((x) => x.dest === m.dest)
    lines.push(`${stamp}\t${m.dest}\t${m.note}\tsrc=${source?.src ?? '?'}`)
  }
  if (migrated.length > 0) writeFileSync(manifestPath, `${lines.join('\n')}\n`)
  return { migrated, alreadyPresent, vaultRoot: VAULT_ROOT }
}

function readManifest(p: string): string[] {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim() !== '')
}