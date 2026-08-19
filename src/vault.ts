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

export const VAULT_ROOT = path.join(homedir(), 'DeepSeek harness', 'sparkos')

/** 只读外部资产（绝不写入）。 */
export const KNOWLEDGE_ROOT = '/Users/mac/cow/knowledge'
export const TIMELINE_DATA = '/Users/mac/cow/visualization/timeline_data.json'

/** 首次迁移的种子资产：源（参考实现，只读） → VAULT 内目标。 */
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
