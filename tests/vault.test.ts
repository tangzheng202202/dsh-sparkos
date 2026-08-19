import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { initVault, VAULT_ROOT } from '../src/vault.ts'

test('initVault 幂等：重复运行不重复迁移不覆盖', () => {
  const first = initVault()
  const second = initVault()
  assert.equal(second.migrated.length, 0, '第二次运行不应再迁移')
  assert.ok(second.alreadyPresent.length >= first.migrated.length, '种子文件应记为已存在')
  for (const dest of ['config/narrative_lines.json', 'config/line_names.json', 'archive/events.jsonl']) {
    assert.ok(existsSync(path.join(VAULT_ROOT, dest)), dest)
  }
})

test('initVault 迁移清单落 MANIFEST', () => {
  initVault()
  const manifest = readFileSync(path.join(VAULT_ROOT, 'MANIFEST'), 'utf8')
  assert.ok(manifest.includes('narrative_lines.json'), 'MANIFEST 应含主线文件记录')
})
