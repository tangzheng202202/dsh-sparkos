/**
 * media-os 只读读取器测试。
 *
 * 关键不变量：
 * 1. 排期表两种行形态都能命中今天（W1 三格 / W2+ 两格），且不会误配其它日期
 * 2. 引用/解析全部容错——文件缺失时降级为空，绝不抛错（干净环境必须能渲染简报台）
 * 3. **只读**：模块源码不含任何写 API（media-os 对插件永久只读）
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(join(tmpdir(), 'sparkos-mediaos-'))
const mediaOs = join(root, 'media-os')
mkdirSync(join(mediaOs, '01-content'), { recursive: true })
mkdirSync(join(mediaOs, '04-data'), { recursive: true })

const SCHEDULE = [
  '# 30 天排期 · 2026-08-18 → 09-23',
  '',
  '## W1 · 首发周（8/25 - 8/31）',
  '| 日 | 平台 | 动作 |',
  '|---|---|---|',
  '| 一 8/25 | X | 发第一条推文 |',
  '| 三 8/27 20:00 | 公众号 | 母版① |',
  '',
  '## W3 · 深度周（9/8 - 9/14）',
  '| 日 | 动作 |',
  '|---|---|',
  '| 一 9/8 | 选题会 |',
  '| 三 9/10 20:00 | 公众号《一鱼多吃》（S1E3）；小红书拆条 |',
].join('\n')
writeFileSync(join(mediaOs, '01-content', '30天排期.md'), SCHEDULE)

writeFileSync(join(mediaOs, '04-data', 'metrics.csv'),
  '日期,平台,内容ID,标题,栏目,曝光,播放阅读,赞,藏,评,转,涨粉,完播率打开率,备注\n' +
  '2026-09-01,公众号,c1,标题一,车间,100,50,3,1,0,0,2,5%,\n' +
  '2026-09-05,小红书,c2,标题二,车间,200,90,8,4,1,2,5,12%,\n')

writeFileSync(join(mediaOs, '01-content', '选题池.md'),
  '# 选题池\n\n| 日期 | 标题 |\n|---|---|\n| 08-18 | 选题甲 |\n| 08-20 | 选题乙 |\n| 未定 | 不算 |\n')

process.env.SPARKOS_MEDIA_OS_ROOT = mediaOs
process.env.SPARKOS_VAULT_ROOT = join(root, 'vault')
after(() => rmSync(root, { recursive: true, force: true }))

test('parseSchedule 命中今天：两格行与三格行都能解析，且不误配其它日期', async () => {
  const { __internals } = await import('../src/server/mediaos.ts')
  const r = __internals.parseSchedule(SCHEDULE, '2026-09-10')
  assert.equal(r.items.length, 1, '只应命中 9/10 一行')
  assert.equal(r.items[0].label, '三 9/10 20:00')
  assert.ok(r.items[0].action.includes('一鱼多吃'), '含动作原文')
  assert.equal(r.range, '2026-08-18 → 09-23')
  assert.equal(r.inRange, true)

  const w1 = __internals.parseSchedule(SCHEDULE, '2026-08-25')
  assert.equal(w1.items.length, 1)
  assert.equal(w1.items[0].action, 'X · 发第一条推文', '三格行的平台与动作应合并')

  const none = __internals.parseSchedule(SCHEDULE, '2026-09-11')
  assert.equal(none.items.length, 0)
  assert.equal(none.inRange, true, '9/11 仍在区间内')
})

test('parseRange 支持跨年区间（结束月早于起始月时补一年）', async () => {
  const { __internals } = await import('../src/server/mediaos.ts')
  const r = __internals.parseRange('2026-12-20 → 01-10')
  assert.ok(r)
  assert.equal(r.start.toISOString().slice(0, 10), '2026-12-20')
  assert.equal(r.end.toISOString().slice(0, 10), '2027-01-10')
})

test('parseMetrics 计数数据行并取最后一条日期', async () => {
  const { __internals } = await import('../src/server/mediaos.ts')
  const text = readFileSync(join(mediaOs, '04-data', 'metrics.csv'), 'utf8')
  const m = __internals.parseMetrics(text)
  assert.equal(m.rows, 2, '不含表头')
  assert.equal(m.lastDate, '2026-09-05')
  assert.deepEqual(__internals.parseMetrics('日期,平台\n'), { rows: 0, lastDate: null }, '空表降级')
})

test('parseTopicPool 只数 MM-DD 格式的入库行', async () => {
  const { __internals } = await import('../src/server/mediaos.ts')
  const text = readFileSync(join(mediaOs, '01-content', '选题池.md'), 'utf8')
  assert.equal(__internals.parseTopicPool(text), 2)
})

test('buildMediaOsSnapshot 装配真实 fixture', async () => {
  const { buildMediaOsSnapshot } = await import('../src/server/mediaos.ts')
  const snap = buildMediaOsSnapshot('2026-09-10')
  assert.equal(snap.available, true)
  assert.equal(snap.schedule.items.length, 1)
  assert.equal(snap.metrics.rows, 2)
  assert.equal(snap.metrics.lastDate, '2026-09-05')
  assert.equal(snap.topicPool.entries, 2)
  assert.ok(snap.schedule.updatedAt, '应带 mtime 供页面判断新鲜度')
})

test('文件全缺失时降级为空且不抛错（干净环境必须能渲染）', async () => {
  const { buildMediaOsSnapshot } = await import('../src/server/mediaos.ts')
  const snap = buildMediaOsSnapshot('2026-09-10', join(root, 'does-not-exist'))
  assert.equal(snap.available, false)
  assert.equal(snap.schedule.present, false)
  assert.deepEqual(snap.schedule.items, [])
  assert.equal(snap.schedule.inRange, false)
  assert.equal(snap.metrics.present, false)
  assert.equal(snap.metrics.rows, 0)
  assert.equal(snap.topicPool.present, false)
  assert.equal(snap.topicPool.entries, 0)
  assert.equal(snap.schedule.updatedAt, null, '缺失文件不应有 mtime')
})

test('只读红线：mediaos.ts 源码不含任何写 API', async () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server/mediaos.ts', import.meta.url)), 'utf8')
  for (const bad of ['writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'mkdirSync', 'createWriteStream', 'atomicWriteJson']) {
    assert.ok(!src.includes(bad), 'media-os 读取器不得出现 ' + bad)
  }
  assert.ok(src.includes('readFileSync'), '应只用 readFileSync')
})
