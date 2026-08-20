/**
 * daily 读取器测试：模块级单 fixture + env 前置，动态 import 保证 env 生效。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'sparkos-daily-'))
const brief = join(root, 'daily_brief')
const drafts = join(brief, 'drafts')
const perf = join(root, 'perf')
const queue = join(root, 'obsidian-bridge', 'distill_queue')
const archive = join(root, 'archive')
const vault = join(root, 'vault')
mkdirSync(drafts, { recursive: true })
mkdirSync(perf, { recursive: true })
mkdirSync(queue, { recursive: true })
mkdirSync(archive, { recursive: true })
mkdirSync(join(vault, 'distill_queue'), { recursive: true })
writeFileSync(join(brief, 'daily_data_2026-08-19.json'), JSON.stringify({ date: '2026-08-19', must_reads: [{ event_id: 'old', fresh_hours: 30 }] }))
writeFileSync(join(brief, 'daily_data_2026-08-20.json'), JSON.stringify({ date: '2026-08-20', must_reads: [{ event_id: 'ev-new', title: '今日事件', fresh_hours: 5, primary_line: 'L01' }], suggestions: [{ type: 'source', note: '补 RSS' }] }))
writeFileSync(join(brief, 'daily_briefing_2026-08-20.md'), '# 每日简报 2026-08-20\n\n## 一、必读\n- 事件A')
writeFileSync(join(drafts, '2026-08-20-wechat.md'), '# 草稿标题\n\n正文内容测试。')
writeFileSync(join(perf, 'wechat.json'), JSON.stringify({ platform: 'wechat', exported_at: '2026-08-20', posts: [{ title: 'x', published_at: '2026-08-19', read_count: 1200, like_count: 45 }] }))
writeFileSync(join(queue, '2026-08-20-cand.md'), '---\ntitle: 候选卡\nlines: [L01]\n---\n观察内容。')
writeFileSync(join(vault, 'distill_queue', 'vault-cand.md'), '---\ntitle: 本地候选\n---\n本地内容。')
writeFileSync(join(archive, 'events.jsonl'), JSON.stringify({ event_id: 'e1' }) + '\n' + JSON.stringify({ event_id: 'e2' }) + '\n')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_CONTENTOS_ROOT = root
process.env.SPARKOS_DAILY_BRIEF_DIR = brief
process.env.SPARKOS_PERF_DIR = perf
process.env.SPARKOS_RUNTIME_DISTILL_QUEUE = queue
process.env.SPARKOS_RUNTIME_EVENTS = join(archive, 'events.jsonl')
after(() => rmSync(root, { recursive: true, force: true }))

test('daily_data：取最新文件；daily_briefing：取最新', async () => {
  const daily = await import('../src/daily.ts')
  const d = daily.latestDailyData()
  assert.equal(d?.date, '2026-08-20')
  assert.equal(d?.must_reads?.[0].event_id, 'ev-new')
  const b = daily.latestBriefing()
  assert.equal(b?.date, '2026-08-20')
  assert.ok(b?.text.includes('每日简报'))
  assert.equal(daily.listDailyDataFiles().length, 2)
})

test('drafts：runtime 草稿带预览；readDraft 读全文', async () => {
  const daily = await import('../src/daily.ts')
  const ds = daily.listRuntimeDrafts()
  assert.equal(ds.length, 1)
  assert.equal(ds[0].file, '2026-08-20-wechat.md')
  assert.ok(ds[0].preview.includes('草稿标题'))
  const full = daily.readDraft(ds[0].path)
  assert.ok(full?.includes('正文内容测试'))
})

test('perf：平台聚合（篇数/总阅读/平均/最近）', async () => {
  const daily = await import('../src/daily.ts')
  const p = daily.listPerf()
  assert.equal(p.files, 1)
  assert.equal(p.totalPosts, 1)
  assert.equal(p.platforms.length, 1)
  assert.equal(p.platforms[0].platform, 'wechat')
  assert.equal(p.platforms[0].totalReads, 1200)
  assert.equal(p.platforms[0].avgReads, 1200)
  assert.equal(p.platforms[0].last, '2026-08-19')
})

test('distill 队列：runtime+vault 合并；findDistillEntry 双目录查找', async () => {
  const daily = await import('../src/daily.ts')
  const q = daily.listDistillQueue()
  assert.equal(q.length, 2, 'runtime 1 + vault 1')
  const rt = q.find((e) => e.file === '2026-08-20-cand.md')
  assert.equal(rt?.dir, 'runtime')
  assert.equal(rt?.targets[0], 'L01')
  assert.ok(rt?.content.includes('观察内容'))
  const v = q.find((e) => e.file === 'vault-cand.md')
  assert.equal(v?.dir, 'vault')
  const found = daily.findDistillEntry('2026-08-20-cand.md')
  assert.equal(found?.dir, 'runtime')
  assert.equal(daily.findDistillEntry('no-such.md'), null)
})

test('runtimeEventsCount：运行时账本行数（缺失回退 VAULT）', async () => {
  const daily = await import('../src/daily.ts')
  assert.equal(daily.runtimeEventsCount(), 2)
})

test('infoSources：读运行时注册表（缺失返回 null 不抛错）', async () => {
  const daily = await import('../src/daily.ts')
  assert.equal(daily.infoSources(), null, 'fixture 无 info_sources.json')
})
