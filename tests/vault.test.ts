import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initVault } from '../src/vault.ts'

test('initVault 幂等：重复运行不重复迁移不覆盖', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-vault-'))
  const first = initVault(root)
  const second = initVault(root)
  assert.equal(second.migrated.length, 0, '第二次运行不应再迁移')
  assert.ok(second.alreadyPresent.length >= first.migrated.length, '种子文件应记为已存在')
  for (const dest of ['config/narrative_lines.json', 'config/line_names.json', 'archive/events.jsonl']) {
    assert.ok(existsSync(path.join(root, dest)), dest)
  }
  rmSync(root, { recursive: true, force: true })
})

test('initVault 迁移清单落 MANIFEST', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-vault-'))
  initVault(root)
  const manifest = readFileSync(path.join(root, 'MANIFEST'), 'utf8')
  assert.ok(manifest.includes('narrative_lines.json'), 'MANIFEST 应含主线文件记录')
  rmSync(root, { recursive: true, force: true })
})
