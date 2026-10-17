import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  contentosRootFrom,
  expandHomePath,
  initVault,
  knowledgeRootFrom,
  mediaOsRootFrom,
  resolveVaultRoot,
  underExternalOrVaultFrom,
} from '../src/vault.ts'

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

test('数据目录跟随 DSH_HOME，SPARKOS_VAULT_ROOT 优先', () => {
  const home = '/tmp/sparkos-home'
  assert.equal(resolveVaultRoot({}, home), path.join(home, '.dsh', 'sparkos'))
  assert.equal(resolveVaultRoot({ DSH_HOME: '   ' }, home), path.join(home, '.dsh', 'sparkos'))
  assert.equal(resolveVaultRoot({ DSH_HOME: '/var/dsh' }, home), path.join('/var/dsh', 'sparkos'))
  assert.equal(resolveVaultRoot({ DSH_HOME: '~/profiles' }, home), path.join(home, 'profiles', 'sparkos'))
  assert.equal(resolveVaultRoot({ DSH_HOME: '/var/dsh', SPARKOS_VAULT_ROOT: '/tmp/explicit' }, home), '/tmp/explicit')
  assert.equal(resolveVaultRoot({ SPARKOS_VAULT_ROOT: '~/ledger' }, home), path.join(home, 'ledger'))
  assert.equal(expandHomePath('~', home), home)
})

test('已存在的个人目录不能压过显式 DSH_HOME 或 SPARKOS_VAULT_ROOT', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'sparkos-home-'))
  const legacy = path.join(home, 'DeepSeek harness', 'sparkos')
  mkdirSync(legacy, { recursive: true })
  try {
    assert.equal(resolveVaultRoot({ DSH_HOME: '/var/dsh' }, home), path.join('/var/dsh', 'sparkos'))
    assert.equal(resolveVaultRoot({}, home), path.join(home, '.dsh', 'sparkos'))
    assert.equal(resolveVaultRoot({ DSH_HOME: '/var/dsh', SPARKOS_VAULT_ROOT: '/tmp/explicit' }, home), '/tmp/explicit')
    for (const value of [
      resolveVaultRoot({ DSH_HOME: '/var/dsh' }, home),
      resolveVaultRoot({}, home),
    ]) {
      assert.equal(value.includes('DeepSeek harness'), false, value)
      assert.equal(/\/Users\/mac|\/cow\/|openclaw|newsroom-cn/.test(value), false, value)
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('未设置环境变量时知识库、每日产物和 media-os 没有个人默认路径', () => {
  assert.equal(knowledgeRootFrom({}), '')
  assert.equal(contentosRootFrom({}), null)
  assert.equal(mediaOsRootFrom({}), null)
  const vault = '/var/dsh/sparkos'
  assert.equal(
    underExternalOrVaultFrom('SPARKOS_DAILY_BRIEF_DIR', 'daily_brief', {}, vault, null),
    path.join(vault, 'daily_brief'),
  )
  assert.equal(
    underExternalOrVaultFrom('SPARKOS_PERF_DIR', 'perf', {}, vault, null),
    path.join(vault, 'perf'),
  )
  assert.equal(
    underExternalOrVaultFrom('SPARKOS_RUNTIME_DISTILL_QUEUE', path.join('obsidian-bridge', 'distill_queue'), {}, vault, null),
    path.join(vault, 'obsidian-bridge', 'distill_queue'),
  )
  assert.equal(
    underExternalOrVaultFrom('SPARKOS_DAILY_BRIEF_DIR', 'daily_brief', {}, vault, '/ext/contentos'),
    path.join('/ext/contentos', 'daily_brief'),
  )
  assert.equal(
    underExternalOrVaultFrom('SPARKOS_DAILY_BRIEF_DIR', 'daily_brief', { SPARKOS_DAILY_BRIEF_DIR: '/explicit/brief' }, vault, '/ext/contentos'),
    '/explicit/brief',
  )
  const samples = [
    knowledgeRootFrom({}),
    contentosRootFrom({}) ?? '',
    mediaOsRootFrom({}) ?? '',
    resolveVaultRoot({}, '/tmp/sparkos-fresh-home'),
  ]
  for (const value of samples) {
    assert.equal(/cow|DeepSeek harness|openclaw|newsroom-cn|\/Users\/mac/.test(value), false, value)
  }
})

test('发布清单不收录构建不产出的旧文件', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { files?: string[] }
  assert.ok(Array.isArray(pkg.files), 'package.json 应有 files 白名单')
  const listed = pkg.files.join('\n')
  assert.equal(listed.includes('lib/vault.js'), false)
  assert.equal(listed.includes('lib/tools/run.js'), false)
  assert.equal(existsSync(new URL('../lib/vault.js', import.meta.url)), false)
  assert.equal(existsSync(new URL('../lib/vault.d.ts', import.meta.url)), false)
  assert.equal(existsSync(new URL('../lib/tools/run.js', import.meta.url)), false)
  assert.equal(existsSync(new URL('../lib/tools/run.d.ts', import.meta.url)), false)
})

test('plist 替换按字面写入，并转义 XML 特殊字符', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-plist-'))
  const src = path.join(root, 'in.plist')
  const dest = path.join(root, 'out.plist')
  writeFileSync(src, '<string>__VAULT_ROOT__</string><string>__BRIDGE_DIR__</string>')
  const tricky = 'a|b&c<d>\\e'
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const run = spawnSync('bash', ['-lc', 'source launch/env.sh && render_plist "$1" "$2" "__VAULT_ROOT__=$3" "__BRIDGE_DIR__=$4"', 'bash', src, dest, tricky, ''], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(run.status, 0, run.stderr)
  const text = readFileSync(dest, 'utf8')
  assert.equal(text, '<string>a|b&amp;c&lt;d&gt;\\e</string><string></string>')
  rmSync(root, { recursive: true, force: true })
})

test('initVault 迁移清单落 MANIFEST', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-vault-'))
  initVault(root)
  const manifest = readFileSync(path.join(root, 'MANIFEST'), 'utf8')
  assert.ok(manifest.includes('narrative_lines.json'), 'MANIFEST 应含主线文件记录')
  rmSync(root, { recursive: true, force: true })
})
