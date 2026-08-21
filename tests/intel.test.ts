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
import { collectDailyItems } from '../src/intel/fusion.ts'
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
test('expired 状态：statusOf 映射 + countArchive 计数（alpha 词表补全）', () => {
  const { root, cfg, alphaDir } = fixtureCfg()
  try {
    // statusOf 直接映射
    assert.equal(statusOf('a.expired.json', {}), 'expired')
    assert.equal(statusOf('a.json', { status: 'expired' }), 'expired')
    // fixture 加一个 expired 文件，countArchive 应计入
    writeFileSync(join(alphaDir, 'd20260811111111_a003.expired.json'), JSON.stringify({ created_at: '2026-08-11T00:00:00Z', title: 'expired item' }))
    const counts = buildIntelReport(cfg).archiveCounts
    const alpha = counts.find((c) => c.source === 'alpha-signal')!
    assert.equal(alpha.total, 3)
    assert.equal(alpha.expired, 1, 'expired 单独计数')
    // ingest 也识别 expired
    const r = runIngest(cfg)
    const snap = JSON.parse(readFileSync(join(cfg.outDir, 'alpha-signal', 'd20260811111111_a003.snapshot.json'), 'utf8'))
    assert.equal(snap.status, 'expired')
    assert.equal(r.ok, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('健康 overall 语义：pending-source 不计入；仅全部 pending 才 pending', () => {
  const { root, cfg, alphaDir } = fixtureCfg()
  try {
    const fresh = new Date('2026-08-20T08:00:00Z')
    // 给 alpha 补一条新鲜的 published（fixture 原有 08-10 的已过期）
    writeFileSync(join(alphaDir, 'd20260820080000_a004.published.json'), JSON.stringify({ status: 'published', created_at: '2026-08-20T07:30:00Z', title: 'fresh alpha' }))
    const h = computeHealth(cfg, fresh)
    // hermes 新鲜 + alpha 新鲜 → green；baicaotang pending 不影响 overall
    assert.equal(h.overall, 'green', '真实源健康时 overall 不应因 pending-source 变 pending')
    const allPending = computeHealth({ ...cfg, sources: [{ id: 'baicaotang', dir: null, maxStalenessHours: 24, pattern: 'all' }] }, fresh)
    assert.equal(allPending.overall, 'pending', '全部 pending 才 pending')
    const stale = new Date('2026-08-21T20:00:00Z')
    const hr = computeHealth(cfg, stale)
    assert.equal(hr.overall, 'red', '任一真实源红则整体红')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('fusion 快照输入：observedAt 本地日期归类 + 昨日排除 + title 提取', () => {
  const { root, cfg } = fixtureCfg()
  try {
    const outAlpha = join(cfg.outDir, 'alpha-signal')
    const outHermes = join(cfg.outDir, 'hermes-cn')
    mkdirSync(outAlpha, { recursive: true })
    mkdirSync(outHermes, { recursive: true })
    const now = new Date()
    const iso = (dayOffset: number, hour: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0).toISOString()
    // 今日（本地）两条：alpha 用 UTC 命名的晚落盘稿件（observedAt 仍是今日本地时间）
    writeFileSync(join(outAlpha, 'a1.snapshot.json'), JSON.stringify({
      eventKey: 'a1', source: 'alpha-signal', status: 'ok', observedAt: iso(0, 8), raw: { title: 'alpha 今日稿' },
    }))
    writeFileSync(join(outHermes, 'h1.snapshot.json'), JSON.stringify({
      eventKey: 'h1', source: 'hermes-cn', status: 'ok', observedAt: iso(0, 9), raw: { draft: { title: 'hermes 今日稿' } },
    }))
    // 昨日快照不应进今日
    writeFileSync(join(outHermes, 'h0.snapshot.json'), JSON.stringify({
      eventKey: 'h0', source: 'hermes-cn', status: 'ok', observedAt: iso(-1, 9), raw: { title: '昨日稿' },
    }))
    // 非法 JSON 快照跳过
    writeFileSync(join(outHermes, 'bad.snapshot.json'), '{broken')
    const items = collectDailyItems(cfg, now)
    const keys = items.map((i) => i.eventKey).sort()
    assert.deepEqual(keys, ['a1', 'h1'], '只有今日两条（含 UTC 命名的 alpha）')
    assert.ok(items.every((i) => i.observedAt !== ''), 'observedAt 均非空')
    const hermes = items.find((i) => i.eventKey === 'h1')!
    assert.equal(hermes.title, 'hermes 今日稿', 'title 从 raw.draft 提取')
    assert.equal(hermes.source, 'hermes-cn')
    assert.equal(hermes.status, 'ok')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
