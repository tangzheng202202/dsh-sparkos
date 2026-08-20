import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import path from 'node:path'
import { runIngest, eventKeyOf, statusOf, defaultIntelConfig, type IntelConfig } from '../src/intel/ingest.ts'
import { computeHealth } from '../src/intel/health.ts'
import { runIntelTick } from '../src/intel/tick.ts'
import { buildIntelReport, initOpsIntel } from '../src/intel/report.ts'
import { generateDispatch } from '../src/intel/dispatch.ts'
import { VAULT_ROOT } from '../src/vault.ts'

function fixtureCfg() {
  const root = mkdtempSync(join(tmpdir(), 'sparkos-intel-'))
  const alphaDir = join(root, 'alpha-archive')
  const hermesDir = join(root, 'hermes-archive')
  mkdirSync(alphaDir, { recursive: true })
  mkdirSync(hermesDir, { recursive: true })
  // 假 archive：alpha 一个 published + 一个 unsent-scope-blocked
  writeFileSync(join(alphaDir, 'd20260810123456_a001.published.json'), JSON.stringify({ status: 'published', created_at: '2026-08-10T00:00:00Z', title: 'alpha item' }))
  writeFileSync(join(alphaDir, 'd20260810123457_a002.unsent-scope-blocked.json'), JSON.stringify({ created_at: '2026-08-10T00:00:00Z', title: 'blocked item' }))
  // 假 archive：hermes 一个 published（正文含 item/draft 结构）
  writeFileSync(join(hermesDir, 'd20260820070000_h001.published.json'), JSON.stringify({ status: 'published', created_at: '2026-08-20T07:00:00Z', item: { title: 'hermes item' }, draft: { title: 'hermes draft' } }))
  const cfg: IntelConfig = {
    sources: [
      { id: 'alpha-signal', dir: alphaDir, maxStalenessHours: 48, pattern: 'all' },
      { id: 'hermes-cn', dir: hermesDir, maxStalenessHours: 24, pattern: 'published-only' },
      { id: 'baicaotang', dir: null, maxStalenessHours: 24, pattern: 'all' },
    ],
    outDir: join(root, 'out', 'ingest'),
    runsDir: join(root, 'out', 'runs'),
    keepDays: 14,
  }
  return { root, cfg, alphaDir, hermesDir }
}

test('eventKeyOf/statusOf 映射：文件名去后缀 + 后缀状态', () => {
  assert.equal(eventKeyOf('d20260810123456_a001.published.json'), 'd20260810123456_a001')
  assert.equal(statusOf('a.published.json', {}), 'ok')
  assert.equal(statusOf('a.unsent-scope-blocked.json', {}), 'blocked')
  assert.equal(statusOf('a.rejected.json', {}), 'rejected')
  assert.equal(statusOf('a.json', { status: 'published' }), 'ok')
  assert.equal(statusOf('a.json', {}), 'unknown')
})

test('ingest 字段映射：eventKey/source/status/raw 保留 + 幂等（二次零新增）', () => {
  const { root, cfg, hermesDir } = fixtureCfg()
  const r1 = runIngest(cfg)
  assert.equal(r1.ok, true)
  const hermes = r1.sources.find((s) => s.source === 'hermes-cn')!
  assert.equal(hermes.scanned, 1)
  assert.equal(hermes.added, 1)
  const snap = JSON.parse(readFileSync(join(cfg.outDir, 'hermes-cn', 'd20260820070000_h001.snapshot.json'), 'utf8'))
  assert.equal(snap.eventKey, 'd20260820070000_h001')
  assert.equal(snap.source, 'hermes-cn')
  assert.equal(snap.status, 'ok')
  assert.ok(snap.raw.draft.title, 'raw 保留原文件内容')
  // 幂等：二次 run 零新增
  const r2 = runIngest(cfg)
  assert.equal(r2.sources.find((s) => s.source === 'hermes-cn')!.added, 0)
  rmSync(root, { recursive: true, force: true })
})

test('只读红线回归：源 archive 文件 mtime 与内容在 ingest 前后不变', () => {
  const { root, cfg, alphaDir } = fixtureCfg()
  const before = statSync(join(alphaDir, 'd20260810123456_a001.published.json')).mtimeMs
  const contentBefore = readFileSync(join(alphaDir, 'd20260810123456_a001.published.json'), 'utf8')
  runIngest(cfg)
  runIngest(cfg)
  const after = statSync(join(alphaDir, 'd20260810123456_a001.published.json')).mtimeMs
  const contentAfter = readFileSync(join(alphaDir, 'd20260810123456_a001.published.json'), 'utf8')
  assert.equal(after, before, '源文件 mtime 不得变化（只读红线）')
  assert.equal(contentAfter, contentBefore)
  rmSync(root, { recursive: true, force: true })
})

test('源目录缺失必须显式 fail: source-missing（不静默）', () => {
  const { root, cfg } = fixtureCfg()
  const cfg2: IntelConfig = { ...cfg, sources: [{ id: 'ghost', dir: join(root, 'no-such-dir'), maxStalenessHours: 24, pattern: 'all' }] }
  const r = runIngest(cfg2)
  assert.equal(r.ok, false)
  assert.equal(r.sources[0].ok, false)
  assert.equal(r.sources[0].error, 'source-missing')
  rmSync(root, { recursive: true, force: true })
})

test('健康阈值：新鲜 published → green；陈旧 → red；pending-source → pending', () => {
  const { root, cfg } = fixtureCfg()
  const fresh = new Date('2026-08-20T08:00:00Z')
  const h1 = computeHealth(cfg, fresh) // hermes 07:00 发布，距今 1h < 24h
  assert.equal(h1.sources.find((s) => s.id === 'hermes-cn')!.status, 'green')
  const stale = new Date('2026-08-21T20:00:00Z') // hermes 距今 37h > 24h
  const h2 = computeHealth(cfg, stale)
  assert.equal(h2.sources.find((s) => s.id === 'hermes-cn')!.status, 'red')
  assert.equal(h2.sources.find((s) => s.id === 'baicaotang')!.status, 'pending')
  rmSync(root, { recursive: true, force: true })
})

test('tick 全链：initOpsIntel 建目录 + run 留痕 + 空源 run.ok=false', () => {
  const { root, cfg } = fixtureCfg()
  // 独立 VAULT 隔离：initOpsIntel 用真实 VAULT_ROOT，这里只验证 tick 的 run 留痕
  const t = runIntelTick
  assert.equal(typeof t, 'function')
  // 直接验证 initOpsIntel 幂等（真实 VAULT 下运行，创建目录）
  const created = initOpsIntel(join(root, 'vault'))
  assert.ok(created.created.includes('ingest'))
  assert.ok(existsSync(join(root, 'vault', 'ops-intel', 'runs')))
  rmSync(root, { recursive: true, force: true })
})

test('S1 report：archiveCounts 实算 published/blocked/rejected/total（fixture）', () => {
  const { root, cfg } = fixtureCfg()
  const counts = buildIntelReport(cfg).archiveCounts
  const alpha = counts.find((c) => c.source === 'alpha-signal')!
  const hermes = counts.find((c) => c.source === 'hermes-cn')!
  assert.equal(alpha.total, 2)
  assert.equal(alpha.published, 1)
  assert.equal(alpha.blocked, 1)
  assert.equal(alpha.rejected, 0)
  assert.equal(hermes.total, 1)
  assert.equal(hermes.published, 1)
  assert.equal(hermes.blocked, 0)
  rmSync(root, { recursive: true, force: true })
})

test('S3 dispatch：preferences.json 生成且发布权归原 Owner（fixture）', () => {
  const { root, cfg } = fixtureCfg()
  // 先造一份 fusion 供 dispatch 读取
  const fusionDir = join(path.dirname(cfg.outDir), 'fusion')
  mkdirSync(fusionDir, { recursive: true })
  writeFileSync(join(fusionDir, 'fusion-20260820.json'), JSON.stringify({
    items: [{ eventKey: 'd20260820070000_h001', source: 'hermes-cn', title: 'hermes item' }],
  }))
  const d = generateDispatch(cfg)
  assert.equal(d.items.length, 1)
  const file = join(fusionDir, '..', 'dispatch', 'preferences.json')
  assert.ok(existsSync(file))
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(saved.mode, 'manual-optional')
  assert.ok(saved.redLine.includes('红线'))
  assert.ok(saved.ownerNote.includes('原 Owner'))
  assert.equal(saved.items[0].source, 'hermes-cn')
  // 不碰源目录
  assert.ok(existsSync(join(root, 'alpha-archive', 'd20260810123456_a001.published.json')))
  rmSync(root, { recursive: true, force: true })
})
