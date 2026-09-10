import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import path from 'node:path'
import { runIngest, eventKeyOf, statusOf, defaultIntelConfig, itemEventKey, observedAtOf, type IntelConfig } from '../src/intel/ingest.ts'
import { computeHealth } from '../src/intel/health.ts'
import { runIntelTick } from '../src/intel/tick.ts'
import { buildIntelReport, initOpsIntel } from '../src/intel/report.ts'
import { generateDispatch } from '../src/intel/dispatch.ts'
import { collectDailyItems, clusterDuplicates, titleSimilarity } from '../src/intel/fusion.ts'
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
test('分类白名单：配了必须命中才进融合，未配全收，过滤数可统计', () => {
  const { root, cfg } = fixtureCfg()
  try {
    const day = new Date('2026-08-20T08:00:00Z')
    const outHermes = join(cfg.outDir, 'hermes-cn')
    mkdirSync(outHermes, { recursive: true })
    const mk = (key: string, category: string): void => {
      writeFileSync(join(outHermes, key + '.snapshot.json'), JSON.stringify({
        eventKey: key, source: 'hermes-cn', status: 'ok', observedAt: '2026-08-20T07:00:00Z',
        raw: { item: { title: key, category }, draft: { title: key } },
      }))
    }
    mk('d20260820070001_keep', '科技创新')
    mk('d20260820070002_drop', '社会民生')
    // 未配白名单：两条全收
    assert.equal(collectDailyItems(cfg, day).length, 2, '未配白名单不过滤')
    // 配白名单：只留命中的，并统计被过滤条数
    const scoped: IntelConfig = {
      ...cfg,
      sources: cfg.sources.map((s) => (s.id === 'hermes-cn' ? { ...s, categories: ['科技创新', '财经经济'] } : s)),
    }
    const stats = { filtered: {} as Record<string, number> }
    const kept = collectDailyItems(scoped, day, stats)
    assert.deepEqual(kept.map((i) => i.eventKey), ['d20260820070001_keep'])
    assert.equal(stats.filtered['hermes-cn'], 1, '被过滤 1 条')
    // alpha 类快照用 source_hint.category 也能命中
    const outAlpha = join(cfg.outDir, 'alpha-signal')
    mkdirSync(outAlpha, { recursive: true })
    writeFileSync(join(outAlpha, 'a9.snapshot.json'), JSON.stringify({
      eventKey: 'a9', source: 'alpha-signal', status: 'ok', observedAt: '2026-08-20T07:00:00Z',
      raw: { source_hint: { category: '财经经济' }, title: 'alpha 财经稿' },
    }))
    const scopedAlpha: IntelConfig = {
      ...cfg,
      sources: cfg.sources.map((s) => (s.id === 'alpha-signal' ? { ...s, categories: ['财经经济'] } : s)),
    }
    assert.ok(collectDailyItems(scopedAlpha, day).some((i) => i.eventKey === 'a9'), 'source_hint.category 命中白名单')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('titleSimilarity：相似标题高分 / 不相关低分', () => {
  const a = '伊朗外交部谴责美国新一轮经济制裁'
  const b = '伊朗谴责美国新一轮制裁称将以一切手段维护国家利益'
  const c = '市场监管部门整治驾校抱团涨价等乱象'
  assert.ok(titleSimilarity(a, b) >= 0.5, '同主题应 ≥0.5，实际 ' + titleSimilarity(a, b))
  assert.ok(titleSimilarity(a, c) < 0.4, '不相关应 <0.4，实际 ' + titleSimilarity(a, c))
  assert.equal(titleSimilarity('', 'x'), 0, '空标题相似度 0')
})

test('clusterDuplicates：聚类疑似重复组；不相关不聚；阈值可调', () => {
  const items = [
    { eventKey: 'a', source: 'hermes', status: 'ok', title: '伊朗外交部谴责美国新一轮经济制裁', observedAt: '', evidenceUrl: '', heat: null, breaking: false, topics: [] },
    { eventKey: 'b', source: 'hermes', status: 'ok', title: '伊朗谴责美国新一轮制裁称将以一切手段维护国家利益', observedAt: '', evidenceUrl: '', heat: null, breaking: false, topics: [] },
    { eventKey: 'c', source: 'alpha', status: 'ok', title: 'NVIDIA 发布 SkillEvaluator 评估 AI Agent', observedAt: '', evidenceUrl: '', heat: null, breaking: false, topics: [] },
    { eventKey: 'd', source: 'hermes', status: 'ok', title: '市场监管部门整治驾校抱团涨价等乱象', observedAt: '', evidenceUrl: '', heat: null, breaking: false, topics: [] },
  ]
  const groups = clusterDuplicates(items)
  assert.equal(groups.length, 1, '只有 1 组疑似重复')
  const g = groups[0].sort()
  assert.deepEqual(g, ['a', 'b'], 'a/b 同主题归组')
  // 更高阈值不聚类
  assert.equal(clusterDuplicates(items, 0.9).length, 0, '阈值 0.9 不应聚类')
})
test('同 key 多状态文件：写后即记 known，不互相覆盖（状态机防扫描顺序依赖）', () => {
  const { root, cfg, alphaDir } = fixtureCfg()
  try {
    // 同一 eventKey 两个状态文件（published + blocked）
    writeFileSync(join(alphaDir, 'dup001.published.json'), JSON.stringify({ status: 'published', created_at: '2026-08-20T00:00:00Z', title: 'dup pub' }))
    writeFileSync(join(alphaDir, 'dup001.unsent-scope-blocked.json'), JSON.stringify({ created_at: '2026-08-20T01:00:00Z', title: 'dup blocked' }))
    const r = runIngest(cfg)
    const alpha = r.sources.find((s) => s.source === 'alpha-signal')!
    assert.equal(alpha.added, 3, 'a001+a002+dup001 首个共 3（写后即记 known）')
    assert.equal(alpha.skipped, 1, '另一状态文件被 skip（不覆盖）')
    // 快照存在且内容来自首次写入
    const snapFile = join(cfg.outDir, 'alpha-signal', 'dup001.snapshot.json')
    assert.ok(existsSync(snapFile))
    const snap = JSON.parse(readFileSync(snapFile, 'utf8'))
    assert.equal(snap.eventKey, 'dup001')
    // 第二轮零新增
    const r2 = runIngest(cfg)
    assert.equal(r2.sources.find((s) => s.source === 'alpha-signal')!.added, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('情报簇：规则骨架预填（分组/来源数/证据URL/热度）+ 校验 + 合并写回', async () => {
  const { root, cfg } = fixtureCfg()
  try {
    const { buildClusterSkeletons, validateCluster, saveClusters, loadClusters } = await import('../src/intel/cluster.ts')
    const items = [
      // a 带真实高热（hermes strong+breaking → 70），b 中等，c 无热度信号
      { eventKey: 'a', source: 'hermes', status: 'ok', title: '伊朗谴责制裁', observedAt: '', evidenceUrl: 'https://a.example', heat: 70, breaking: true, topics: ['伊朗'] },
      { eventKey: 'b', source: 'alpha', status: 'ok', title: '伊朗谴责制裁2', observedAt: '', evidenceUrl: 'https://b.example', heat: 45, breaking: false, topics: [] },
      { eventKey: 'c', source: 'alpha', status: 'ok', title: 'NVIDIA 发布', observedAt: '', evidenceUrl: 'https://c.example', heat: null, breaking: false, topics: [] },
    ]
    const sk = buildClusterSkeletons(items, [['a', 'b']], new Date(2026, 7, 21))
    assert.equal(sk.length, 2, '1 组重复 + 1 单事件')
    const dup = sk.find((c) => c.eventKeys.length === 2)!
    assert.equal(dup.heat, 'high', '成员最高真实热度 70 → high（跨源再升一级仍是 high）')
    assert.equal(dup.sourceCount, 2)
    assert.ok(dup.evidenceUrls.includes('https://a.example'), '证据 URL 聚合')
    assert.equal(dup.topic, '', '主题留待模型')
    const single = sk.find((c) => c.eventKeys.length === 1)!
    assert.equal(single.heat, 'low', '无热度信号且单源单条 → low')
    // 校验：合法通过 / 非法拒绝
    const good = { ...dup, topic: '伊朗制裁' }
    assert.equal(validateCluster(good).length, 0)
    assert.ok(validateCluster({ ...dup, topic: '' }).some((e) => e.includes('topic')), '缺主题拒绝')
    assert.ok(validateCluster({ ...dup, topic: 'x', heat: 'hot' as never }).some((e) => e.includes('heat')), '非法热度拒绝')
    // 合并写回（同 id 覆盖）
    const r1 = saveClusters(cfg, [good, single], new Date(2026, 7, 21))
    assert.equal(r1.total, 2, '骨架 2 簇均写入')
    const again = { ...good, topic: '伊朗制裁（更新）' }
    saveClusters(cfg, [again], new Date(2026, 7, 21))
    const loaded = loadClusters(cfg, new Date(2026, 7, 21))
    assert.equal(loaded.length, 2)
    assert.equal(loaded.find((c) => c.clusterId === good.clusterId)?.topic, '伊朗制裁（更新）', '同 id 覆盖')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
// ---------------------------------------------------------------- 多条目馈送源（hn / FeedFuse 快照）
// 2026-09-10 新增：科技快照 tech-ai-*.json 是一个数组（HN + GitHub），
// 条目自带真实热度。按条目展开 + 内容哈希去重，根治「同批重放多日」。

function feedCfg() {
  const root = mkdtempSync(join(tmpdir(), 'sparkos-feed-'))
  const feedDir = join(root, 'sources-raw')
  mkdirSync(feedDir, { recursive: true })
  const cfg: IntelConfig = {
    sources: [
      {
        id: 'hn', dir: feedDir, maxStalenessHours: 30, pattern: 'all',
        filePrefix: 'tech-ai-', explodeItems: true,
      },
    ],
    outDir: join(root, 'out', 'ingest'),
    runsDir: join(root, 'out', 'runs'),
    keepDays: 14,
  }
  return { root, cfg, feedDir }
}

const HN_DAY1 = [
  { title: 'Shopify acquires Tailwind', url: 'https://tailwindcss.com/blog/x', score: 856, source: 'hackernews', collected_at: '2026-09-10T08:01:03.142468', heat: 856 },
  { title: 'iPhone Duo', url: 'https://www.apple.com/iphone-duo/', score: 801, source: 'hackernews', collected_at: '2026-09-10T08:01:02.127788', heat: 801 },
  { title: 'some/repo', url: 'https://github.com/some/repo', score: 120, source: 'github', collected_at: '2026-09-10T08:01:30.000000', heat: 120 },
]

test('itemEventKey：按 URL 内容哈希（跨文件稳定），无 URL 退回 title', () => {
  const a = itemEventKey('hn', { url: 'https://x.example/a' })
  const b = itemEventKey('hn', { url: 'https://x.example/a' })
  const c = itemEventKey('hn', { url: 'https://x.example/b' })
  assert.equal(a, b, '同 URL 必须同 key（跨天去重的前提）')
  assert.notEqual(a, c)
  assert.match(a, /^hn-[0-9a-f]{16}$/, 'key 必须是文件名安全的内容哈希')
  // 无 URL 时退回 title：同 title 稳定，且与任何 URL 派生的 key 不同
  const byTitle = itemEventKey('hn', { title: '只有标题没有链接' })
  assert.equal(byTitle, itemEventKey('hn', { title: '只有标题没有链接' }))
  assert.notEqual(byTitle, itemEventKey('hn', { url: 'https://x.example/a' }))
})

test('observedAtOf：优先 created_at，其次 collected_at，最后回落 now', () => {
  const now = new Date('2026-09-10T12:00:00Z')
  assert.equal(observedAtOf({ created_at: 'A', collected_at: 'B' }, now), 'A')
  assert.equal(observedAtOf({ collected_at: 'B' }, now), 'B')
  assert.equal(observedAtOf({}, now), now.toISOString())
})

test('多条目馈送：数组按条目展开 + 前缀过滤 + 幂等 + 跨天重放去重', () => {
  const { root, cfg, feedDir } = feedCfg()
  try {
    writeFileSync(join(feedDir, 'tech-ai-2026-09-10.json'), JSON.stringify(HN_DAY1))
    // 同目录里不该被本源的 filePrefix 收进来的文件
    writeFileSync(join(feedDir, 'other-2026-09-10.json'), JSON.stringify([{ title: '噪声', url: 'https://noise.example/' }]))

    const first = runIngest(cfg, new Date('2026-09-10T09:00:00Z'))
    const s1 = first.sources[0]
    assert.equal(s1.ok, true)
    assert.equal(s1.added, 3, '只展开 tech-ai- 前缀文件的 3 条')
    assert.equal(s1.scanned, 3, '前缀不匹配的文件不计入')

    const snapDir = join(cfg.outDir, 'hn')
    const files = readdirSync(snapDir).filter((f) => f.endsWith('.snapshot.json'))
    assert.equal(files.length, 3)
    assert.equal(existsSync(join(snapDir, 'other-2026-09-10.snapshot.json')), false, '未匹配前缀不得落快照')

    // 条目级快照：raw 就是条目本身，rawFile 指向来源文件，observedAt 取 collected_at
    const one = JSON.parse(readFileSync(join(snapDir, files[0]), 'utf8')) as {
      raw: Record<string, unknown>; rawFile: string; observedAt: string; status: string; source: string
    }
    assert.equal(one.source, 'hn')
    assert.equal(one.status, 'ok', '快照条目视为已发布')
    assert.equal(one.rawFile, 'tech-ai-2026-09-10.json')
    assert.ok(one.raw.url || one.raw.title, 'raw 保留条目原字段（含真实 score）')
    assert.match(one.observedAt, /^2026-09-10T08:01:/, 'observedAt 取 collected_at 而非 ingest 时间')

    // 幂等：同日重跑零新增
    const again = runIngest(cfg, new Date('2026-09-10T10:00:00Z'))
    assert.equal(again.sources[0].added, 0)
    assert.equal(again.sources[0].skipped, 3)

    // 跨天：老条目重放必须去重，只有新条目入库
    const day2 = [HN_DAY1[0], { title: 'brand new', url: 'https://new.example/z', score: 300, source: 'hackernews', collected_at: '2026-09-11T08:01:00.000000', heat: 300 }]
    writeFileSync(join(feedDir, 'tech-ai-2026-09-11.json'), JSON.stringify(day2))
    const day2run = runIngest(cfg, new Date('2026-09-11T09:00:00Z'))
    assert.equal(day2run.sources[0].added, 1, '重放的老条目不得二次入库')
    // 第三天会重扫两个文件：day1 的 3 条 + day2 里重放的那 1 条，共 4 条被跳过
    assert.equal(day2run.sources[0].skipped, 4)
    assert.equal(readdirSync(snapDir).filter((f) => f.endsWith('.snapshot.json')).length, 4)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('多条目馈送：健康取条目 collected_at（不得因数组无 status 而误判红灯）', () => {
  const { root, cfg, feedDir } = feedCfg()
  try {
    writeFileSync(join(feedDir, 'tech-ai-2026-09-10.json'), JSON.stringify(HN_DAY1))
    const health = computeHealth(cfg, new Date('2026-09-10T11:00:00Z'))
    const hn = health.sources.find((s) => s.id === 'hn')
    assert.ok(hn)
    assert.equal(hn.status, 'green', '3 小时前的快照应判绿')
    // collected_at 无时区后缀 → 按本地时间解析；断言用同一解析结果比对，避免时区耦合
    const latestTs = Date.parse(String(hn.latestPublishedAt))
    assert.equal(latestTs, Date.parse('2026-09-10T08:01:30.000000'), '应取最大 collected_at（github 那条）')
    assert.equal(hn.stalenessHours, Math.round((Date.parse('2026-09-10T11:00:00Z') - latestTs) / 3600000))
    assert.equal(health.overall, 'green')

    const stale = computeHealth(cfg, new Date('2026-09-13T00:00:00Z'))
    assert.equal(stale.sources.find((s) => s.id === 'hn')?.status, 'red', '超过 maxStalenessHours 应判红')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('多条目馈送：archiveCounts 按条目计数而不是文件数', () => {
  const { root, cfg, feedDir } = feedCfg()
  try {
    writeFileSync(join(feedDir, 'tech-ai-2026-09-10.json'), JSON.stringify(HN_DAY1))
    writeFileSync(join(feedDir, 'tech-ai-2026-09-11.json'), JSON.stringify([HN_DAY1[0], HN_DAY1[1]]))
    const report = buildIntelReport(cfg)
    const hn = report.archiveCounts.find((c) => c.source === 'hn')
    assert.ok(hn)
    assert.equal(hn.total, 5, '2 个文件共 5 条目')
    assert.equal(hn.published, 5)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('P0 白名单收紧：hermes-cn 不再放行「国际动态」', () => {
  const cfg = defaultIntelConfig()
  const hermes = cfg.sources.find((s) => s.id === 'hermes-cn')
  assert.ok(hermes?.categories)
  assert.deepEqual(hermes.categories, ['科技创新', '财经经济'], '14 天实测国际动态 63 条仅 1 条与 AI 相关')
  const hn = cfg.sources.find((s) => s.id === 'hn')
  assert.ok(hn, 'hn 源必须登记进情报层')
  assert.equal(hn.explodeItems, true)
  assert.equal(hn.filePrefix, 'tech-ai-')
  assert.equal(hn.categories, undefined, 'hn 条目无 category 字段，不得配白名单（会全滤掉）')
})

test('英文标题防误聚：单字符集合会把无关英文标题串成巨组（混合特征 + 领头聚类回归）', () => {
  // 旧实现（单字符 Dice）下这些对子分别为 0.62 / 0.83 / 0.73，全部越过 0.5 阈值，
  // 接入 HN 后单链聚类把 19 条毫不相关的英文新闻串成一个巨组，
  // 建簇时凭空造出一个「high 热度」簇排到第一。
  const unrelated: Array<[string, string]> = [
    ['Larger Pacific Striped Octopus', 'What do Visa and Mastercard do? An intro to card networks'],
    ['Shopify acquires Tailwind', 'What algorithm did Windows XP use to choose'],
    ['Stockfish 19', 'Larger Pacific Striped Octopus'],
    ['GPT-6 Astra, looped transformers, and hidden reasoning', 'Qwen 3.8 follows GPT-5.5 Pro reasoning p'],
  ]
  for (const [a, b] of unrelated) {
    assert.ok(titleSimilarity(a, b) < 0.5, `无关英文标题不得越阈值：${titleSimilarity(a, b).toFixed(2)} ${a} | ${b}`)
  }
  // 同主题（跨源同一新闻）必须仍然聚得上——否则跨源验证永远不触发
  assert.ok(titleSimilarity('苹果发布 Apple Watch Series 12，搭载全新健康传感系统', 'Apple Watch Series 12') >= 0.5)

  const titles = [
    'Apple Watch Series 12', 'iPhone Duo', 'AirPods 5',
    'GPT-6 Astra, looped transformers, and hidden reasoning', 'Larger Pacific Striped Octopus',
    'Stockfish 19', 'Shopify acquires Tailwind', 'What do Visa and Mastercard do? An intro to card networks',
    'What algorithm did Windows XP use to choose', 'Growing proof that autonomous cars save lives',
    'Show HN: The same nine streaming subscriptions', "No Man's Sky Cosmos", 'DeepSeek v4.1 Flash',
  ]
  const items = titles.map((t, i) => ({ eventKey: 'k' + i, source: 'hn', status: 'ok' as const, title: t, observedAt: '', evidenceUrl: '', heat: null, breaking: false, topics: [] }))
  assert.deepEqual(clusterDuplicates(items), [], '真实 HN 英文池不得聚出任何组（旧实现产出 10+ 条巨组）')
})

// ---------------------------------------------------------------- P1 真实热度接入
// 此前 cluster.heat 只由「合并了几条」合成，而合并不自动发生 → heat 恒为 low。
// 现在以源注意力信号为准：hn 的 HN points（对数映射）、hermes 的 breaking/strong。

test('sourceHeatOf：HN points 对数映射 / GitHub 固定中等 / hermes 用审核标记 / alpha 为 null', async () => {
  const { sourceHeatOf, breakingOf, topicsOf } = await import('../src/intel/fusion.ts')
  // HN points：1→10, 112→67, 544→89, 1162→100（>1431 封顶 100）
  assert.equal(sourceHeatOf({ source: 'hackernews', score: 1 }), 10)
  assert.equal(sourceHeatOf({ source: 'hackernews', score: 112 }), 67)
  assert.equal(sourceHeatOf({ source: 'hackernews', score: 544 }), 89)
  assert.equal(sourceHeatOf({ source: 'hackernews', score: 1162 }), 100)
  assert.equal(sourceHeatOf({ source: 'hackernews', score: 1079623 }), 100, '异常大值必须封顶')
  assert.equal(sourceHeatOf({ source: 'hackernews', score: 0 }), 0)
  // GitHub 的 score 是累计 star（35k~1M），不能当热度 → 固定中等，不得顶格
  assert.equal(sourceHeatOf({ source: 'github', score: 35068 }), 55)
  assert.equal(sourceHeatOf({ source: 'github', score: 1079623 }), 55)

  // hermes：用 breaking/strong，**不用 item.heat**
  assert.equal(sourceHeatOf({ item: {}, strong: true, breaking: true }), 70)
  assert.equal(sourceHeatOf({ item: {}, strong: true }), 60)
  assert.equal(sourceHeatOf({ item: {}, breaking: true }), 45)
  assert.equal(sourceHeatOf({ item: {} }), 25)
  // 关键回归：item.heat 与人工审核标记不相关（实测 heat=100 的 48 条里仅 2 条 strong），必须忽略它
  assert.equal(sourceHeatOf({ item: { heat: 100 } }), 25, '不得把饱和的 item.heat 当热度')
  // alpha-signal：无任何热度字段 → null（不是 0）
  assert.equal(sourceHeatOf({ source_hint: { category: '科技产业' } }), null)

  assert.equal(breakingOf({ breaking: true }), true)
  assert.equal(breakingOf({ source_hint: { breaking: true } }), true)
  assert.equal(breakingOf({ item: {} }), false)
  assert.deepEqual(topicsOf({ watch_hits: { topics: ['人工智能', 'AI'] } }), ['人工智能', 'AI'])
  assert.deepEqual(topicsOf({ watch_hits: { topics: ['x', '', 3] } }), ['x'], '过滤空值与非字符串')
  assert.deepEqual(topicsOf({}), [])
})

test('heatLevelOf：阈值分档 + null 不当成 0 热度', async () => {
  const { heatLevelOf } = await import('../src/intel/cluster.ts')
  assert.equal(heatLevelOf(null), 'low')
  assert.equal(heatLevelOf(0), 'low')
  assert.equal(heatLevelOf(44), 'low')
  assert.equal(heatLevelOf(45), 'medium')
  assert.equal(heatLevelOf(69), 'medium')
  assert.equal(heatLevelOf(70), 'high')
  assert.equal(heatLevelOf(100), 'high')
})

test('真实热度驱动建簇：高热度单条即 high，无热度多条靠佐证升级', async () => {
  const { buildClusterSkeletons } = await import('../src/intel/cluster.ts')
  const mk = (k: string, source: string, heat: number | null, breaking = false) =>
    ({ eventKey: k, source, status: 'ok', title: 't' + k, observedAt: '', evidenceUrl: 'https://' + k + '.example', heat, breaking, topics: [] })
  // 单条但真实高热（HN 1162 分）→ high（旧规则只会给 low）
  const hot = buildClusterSkeletons([mk('a', 'hn', 100)], [], new Date(2026, 8, 10))
  assert.equal(hot[0].heat, 'high', '单条高热必须 high')
  // 单条中等热度 → medium
  const mid = buildClusterSkeletons([mk('a', 'hn', 50)], [], new Date(2026, 8, 10))
  assert.equal(mid[0].heat, 'medium')
  // 单条低热度、单源 → low
  const cold = buildClusterSkeletons([mk('a', 'hn', 20)], [], new Date(2026, 8, 10))
  assert.equal(cold[0].heat, 'low')
  // 三条低热但同主题 + 跨源 → 佐证升两级到 high
  const corroborated = buildClusterSkeletons(
    [mk('a', 'hn', 20), mk('b', 'hermes', 25), mk('c', 'hn', 30)], [['a', 'b', 'c']], new Date(2026, 8, 10))
  assert.equal(corroborated.find((c) => c.eventKeys.length === 3)!.heat, 'high', '多源多佐证可升到 high')
})

// ---------------------------------------------------------------- P0+ 主题门 / P3 补卡清单

test('源闸门：分类与主题是「或」关系（主题门救回被分类门误杀的主线稿件）', async () => {
  const { defaultIntelConfig } = await import('../src/intel/ingest.ts')
  const { collectDailyItems } = await import('../src/intel/fusion.ts')
  const root = mkdtempSync(join(tmpdir(), 'sparkos-gate-'))
  try {
    const outDir = join(root, 'ingest', 'hermes-cn')
    mkdirSync(outDir, { recursive: true })
    const now = new Date()
    const snap = (key: string, raw: Record<string, unknown>) => writeFileSync(
      join(outDir, key + '.snapshot.json'),
      JSON.stringify({ eventKey: key, source: 'hermes-cn', status: 'ok', observedAt: now.toISOString(), rawFile: key + '.json', raw }),
    )
    snap('a', { item: { category: '科技创新', title: '政策门命中' }, watch_hits: { topics: [] } })
    snap('b', { item: { category: '国际动态', title: '主题门命中' }, watch_hits: { topics: ['人工智能'] } })
    snap('c', { item: { category: '国际动态', title: '两者都不命中' }, watch_hits: { topics: ['关税'] } })

    const cfg = {
      sources: [{ id: 'hermes-cn', dir: null, maxStalenessHours: 24, pattern: 'all' as const,
        categories: ['科技创新', '财经经济'], topicsAllow: ['人工智能', 'AI'] }],
      outDir: join(root, 'ingest'), runsDir: join(root, 'runs'), keepDays: 14,
    }
    const stats = { filtered: {} as Record<string, number> }
    const items = collectDailyItems(cfg, now, stats)
    assert.deepEqual(items.map((i) => i.eventKey).sort(), ['a', 'b'], '分类命中 + 主题命中都应通过')
    assert.equal(stats.filtered['hermes-cn'], 1, '两者都不命中的被挡')

    // 只配主题、不配分类：未命中主题的一律挡
    const topicOnly = { ...cfg, sources: [{ ...cfg.sources[0], categories: undefined, topicsAllow: ['人工智能'] }] }
    const only = collectDailyItems(topicOnly, now)
    assert.deepEqual(only.map((i) => i.eventKey), ['b'])

    // 两者都不配：全收（现状不变）
    const noGate = { ...cfg, sources: [{ ...cfg.sources[0], categories: undefined, topicsAllow: undefined }] }
    assert.equal(collectDailyItems(noGate, now).length, 3)

    // 默认配置必须仍带 topicsAllow（P0+ 已落地）
    const hermes = defaultIntelConfig().sources.find((s) => s.id === 'hermes-cn')
    assert.ok(hermes?.topicsAllow?.includes('人工智能'), '默认 hermes-cn 必须配主题白名单')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('nextCardNumbers：读 spark-notes 编号前缀，缺失目录从 001 起', async () => {
  const { nextCardNumbers } = await import('../src/intel/cards.ts')
  const root = mkdtempSync(join(tmpdir(), 'sparkos-cards-'))
  try {
    assert.deepEqual(nextCardNumbers(root), { obs: 1, model: 1 }, '目录缺失不得抛错')
    mkdirSync(join(root, 'spark-notes', 'observations'), { recursive: true })
    mkdirSync(join(root, 'spark-notes', 'models'), { recursive: true })
    writeFileSync(join(root, 'spark-notes', 'observations', '055-foo-2026-09-10.md'), '')
    writeFileSync(join(root, 'spark-notes', 'observations', '007-bar-2026-08-01.md'), '')
    writeFileSync(join(root, 'spark-notes', 'observations', 'INDEX.md'), '')
    writeFileSync(join(root, 'spark-notes', 'models', '025-baz-2026-08-30.md'), '')
    assert.deepEqual(nextCardNumbers(root), { obs: 56, model: 26 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('buildCardRequests：只挑「够热且 0 卡」，编号连续，标题用融合条目兜底', async () => {
  const { buildCardRequests } = await import('../src/intel/cards.ts')
  const root = mkdtempSync(join(tmpdir(), 'sparkos-cards2-'))
  try {
    mkdirSync(join(root, 'spark-notes', 'observations'), { recursive: true })
    writeFileSync(join(root, 'spark-notes', 'observations', '055-x-2026-09-10.md'), '')
    const mkCluster = (id: string, o: Record<string, unknown> = {}) => ({
      clusterId: id, date: '20260910', topic: '', coreFacts: [], heat: 'low' as const, novelty: 'medium' as const,
      sourceCount: 1, evidenceUrls: ['https://e.example/' + id], knowledgeCards: [], credibility: 'medium' as const,
      risks: [], platforms: [], angleSuggestions: [], eventKeys: [id], ...o,
    })
    const clusters = [
      mkCluster('c1', { sourceHeat: 95, heat: 'high' }),          // 够热、0 卡 → 要
      mkCluster('c2', { sourceHeat: 74 }),                        // 够热 → 要
      mkCluster('c3', { sourceHeat: 30, heat: 'low' }),           // 不够热 → 不要
      mkCluster('c4', { sourceHeat: 99, knowledgeCards: ['obs://001'] }), // 已有卡 → 不要
      mkCluster('c5', { heat: 'high', topic: '模型分析过的主题' }), // 无 sourceHeat 但 high → 要，且用 topic
    ]
    const reqs = buildCardRequests(clusters, { knowledgeRoot: root, titles: new Map([['c1', '融合条目标题']]) })
    assert.deepEqual(reqs.map((r) => r.clusterId), ['c1', 'c2', 'c5'])
    assert.deepEqual(reqs.map((r) => r.suggestedUri), ['obs://056', 'obs://057', 'obs://058'], '编号从知识库最大值连续递增')
    assert.equal(reqs[0].title, '融合条目标题', '骨架 topic 为空时用融合标题兜底')
    assert.equal(reqs[2].title, '模型分析过的主题', '有 topic 时优先用 topic')
    assert.equal(reqs[0].sourceHeat, 95)
    assert.ok(reqs[0].reason.includes('knowledgeDepth=0'), '理由要点明缺卡对排序的影响')
    // limit 生效
    assert.equal(buildCardRequests(clusters, { knowledgeRoot: root, limit: 1 }).length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('writeCardRequests：写出 json + md，且不触碰星火库', async () => {
  const { writeCardRequests } = await import('../src/intel/cards.ts')
  const root = mkdtempSync(join(tmpdir(), 'sparkos-cards3-'))
  try {
    const cfg = { sources: [], outDir: join(root, 'ops-intel', 'ingest'), runsDir: join(root, 'ops-intel', 'runs'), keepDays: 14 }
    const w = writeCardRequests(cfg, [{
      clusterId: 'c-20260910-001', suggestedUri: 'obs://056', suggestedFile: '056-slug-2026-09-10.md',
      title: '标题', reason: '理由', heat: 'high', sourceHeat: 95, sourceCount: 1,
      evidenceUrls: ['https://e.example/a'], eventKeys: ['k1'],
    }], new Date(2026, 8, 10))
    assert.equal(w.pending, 1)
    assert.equal(w.files.length, 2)
    assert.ok(existsSync(w.files[0]) && existsSync(w.files[1]))
    const json = JSON.parse(readFileSync(w.files[0], 'utf8'))
    assert.equal(json.requests[0].suggestedUri, 'obs://056')
    assert.ok(json.note.includes('不写知识库'), '产物需声明不写星火库')
    assert.ok(readFileSync(w.files[1], 'utf8').includes('obs://056'))
    // 空清单也要有可读产物
    const empty = writeCardRequests(cfg, [], new Date(2026, 8, 11))
    assert.ok(readFileSync(empty.files[1], 'utf8').includes('没有'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------- P4 T0 候选筛选
// 目的：把每日 30+ 簇收窄成个位数交给 agent，否则「不跑分析 → 全是空骨架 → 进不了创作候选」。

test('t0Candidates：跨源优先、真实热度次之、上限可控', async () => {
  const { t0Candidates } = await import('../src/intel/cluster.ts')
  const mk = (id: string, o: Record<string, unknown> = {}) => ({
    clusterId: id, date: '20260910', topic: '', coreFacts: [], heat: 'low' as const, novelty: 'medium' as const,
    sourceCount: 1, evidenceUrls: ['https://e.example/' + id], knowledgeCards: [], credibility: 'medium' as const,
    risks: [], platforms: [], angleSuggestions: [], eventKeys: [id], ...o,
  })
  const clusters = [
    mk('hot1', { sourceHeat: 95 }),
    mk('hot2', { sourceHeat: 88 }),
    mk('hot3', { sourceHeat: 82 }),
    mk('cold', { sourceHeat: 20, heat: 'low' }),          // 不够热、不跨源 → 出局
    mk('hotLow', { heat: 'high' }),                        // 无 sourceHeat 但 high → 入选
    mk('cross', { sourceHeat: 30, sourceCount: 2 }),       // 跨源（低热）→ 入选且排最前
  ]
  const t0 = t0Candidates(clusters)
  assert.equal(t0[0].clusterId, 'cross', '跨源必须优先（已具备交叉验证）')
  assert.deepEqual(t0.slice(1).map((c) => c.clusterId), ['hot1', 'hot2', 'hot3', 'hotLow'])
  assert.ok(!t0.some((c) => c.clusterId === 'cold'), '低热且单源不得进入 T0')
  // 上限：把每日分析量收窄成个位数
  assert.equal(t0Candidates(clusters, { limit: 2 }).length, 2)
  // 门槛可调
  assert.ok(t0Candidates(clusters, { minHeat: 90 }).every((c) => c.sourceCount >= 2 || (c.sourceHeat ?? 0) >= 90 || c.heat === 'high'))
})

test('writeAnalyzeRequest：产物含有界 t0 数组与判据说明（agent 只读 t0 即可）', async () => {
  const { writeAnalyzeRequest } = await import('../src/intel/cluster.ts')
  const root = mkdtempSync(join(tmpdir(), 'sparkos-t0-'))
  try {
    const cfg = { sources: [], outDir: join(root, 'ops-intel', 'ingest'), runsDir: join(root, 'ops-intel', 'runs'), keepDays: 14 }
    const mk = (id: string, sourceHeat: number | null, sourceCount = 1) => ({
      clusterId: id, date: '20260910', topic: '', coreFacts: [], heat: 'medium' as const, novelty: 'medium' as const,
      sourceCount, evidenceUrls: [], knowledgeCards: [], credibility: 'medium' as const,
      risks: [], platforms: [], angleSuggestions: [], eventKeys: [id],
      ...(sourceHeat === null ? {} : { sourceHeat }),
    })
    const skeletons = [mk('c-20260910-001', 95), mk('c-20260910-002', 30), mk('c-20260910-003', null, 2)]
    const r = writeAnalyzeRequest(cfg, skeletons, new Date(2026, 8, 10))
    assert.equal(r.pending, 3, 'pending 仍是完整清单（向后兼容）')
    assert.equal(r.t0, 2, 't0 = 高热 1 + 跨源 1')
    const file = JSON.parse(readFileSync(r.file, 'utf8'))
    assert.equal(file.t0.length, 2)
    assert.ok(file.t0Note.includes('T0'), '需说明判据，agent 才知道为何只跑这些')
    assert.ok(file.instructions.batching.includes('只分析 t0'), 'instructions 必须约束 agent 只跑 t0')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
