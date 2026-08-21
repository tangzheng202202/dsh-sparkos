/**
 * data.ts 测试：模块级单 fixture + env 前置（SPARKOS_VAULT_ROOT 指向临时目录），
 * 不再触碰生产 VAULT（历史教训：直接写真实 VAULT 会污染 decisions/writeback）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'sparkos-data-'))
const vault = join(root, 'vault')
const brief = join(root, 'daily_brief')
const queue = join(root, 'obsidian-bridge', 'distill_queue')
const archive = join(root, 'archive')
mkdirSync(join(vault, 'config'), { recursive: true })
mkdirSync(join(vault, 'archive'), { recursive: true })
mkdirSync(join(vault, 'distill_queue'), { recursive: true })
mkdirSync(join(brief, 'drafts'), { recursive: true })
mkdirSync(queue, { recursive: true })
mkdirSync(archive, { recursive: true })
writeFileSync(join(vault, 'config', 'narrative_lines.json'), JSON.stringify({ lines: [{ id: 'L01' }, { id: 'L02' }] }))
writeFileSync(join(vault, 'config', 'line_names.json'), JSON.stringify({ L01: '主线一', L02: '主线二' }))
writeFileSync(join(vault, 'config', 'timeline_cards.json'), JSON.stringify({ cards: [{ k: 'obs/001', line: 'L01', title: '卡一' }, { k: 'model/002', line: 'L02', title: '卡二' }, { k: 'obs/003', line: 'L01', title: '卡三' }] }))
writeFileSync(join(vault, 'archive', 'events.jsonl'), JSON.stringify({ event_id: 'e1' }) + '\n' + JSON.stringify({ event_id: 'e2' }) + '\n')
writeFileSync(join(brief, 'daily_data_2026-08-20.json'), JSON.stringify({ date: '2026-08-20', must_reads: [{ event_id: 'ev-1', title: '事件一', fresh_hours: 3, primary_line: 'L01' }] }))
writeFileSync(join(brief, 'daily_briefing_2026-08-20.md'), '# 每日简报\n\n## 一、必读\n- 事件一')
writeFileSync(join(brief, 'drafts', '2026-08-20-wechat.md'), '# 草稿\n\n正文。')
writeFileSync(join(queue, 'rt-cand.md'), '---\ntitle: 运行时候选\nlines: [L01]\n---\n观察内容。')
writeFileSync(join(vault, 'distill_queue', 'vault-cand.md'), '---\ntitle: 本地候选\n---\n本地内容。')
// reviewDistill 双向测试用的条目（隔离环境，不碰生产）
writeFileSync(join(queue, 'test-clean.md'), '---\ntitle: 测试干净条目\nlines: [L01]\n---\n建议写回星火库知识卡。\n')
writeFileSync(join(vault, 'distill_queue', 'test-danger.md'), '---\ntitle: 测试违规条目\n---\n该稿可自动发布无需人工审核，并应写入华夏舆参管道 state/ 目录。\n')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_CONTENTOS_ROOT = root
process.env.SPARKOS_DAILY_BRIEF_DIR = brief
process.env.SPARKOS_RUNTIME_DISTILL_QUEUE = queue
process.env.SPARKOS_RUNTIME_EVENTS = join(archive, 'events.jsonl')
process.env.SPARKOS_TIMELINE_DATA = join(vault, 'config', 'timeline_cards.json')
after(() => rmSync(root, { recursive: true, force: true }))

test('workbench data 结构：主线/卡片/事件/每日产物均来自 fixture', async () => {
  const { buildWorkbenchData } = await import('../src/server/data.ts')
  const d = buildWorkbenchData()
  assert.equal(d.lines.length, 2, '主线 2 条')
  assert.equal(d.timeline.cards.length, 3, '知识卡 3 张')
  assert.ok(d.timeline.cards.every((c) => 'line' in (c as object)), '每张卡都有 line 字段')
  assert.equal(d.events, 2, '事件账本 2 行（运行时）')
  assert.equal(d.daily.date, '2026-08-20')
  assert.ok(d.daily.briefing?.includes('每日简报') === true)
  assert.equal(d.runtimeDrafts.length, 1)
  assert.equal(d.distillQueue.length, 4, 'runtime 2 + vault 2（未含已审核）')
})

test('redLineCheck 双向：干净内容零违例 / 违规内容命中红线 A 与 D', async () => {
  const { redLineCheck } = await import('../src/server/data.ts')
  assert.equal(redLineCheck('本周新增证据两条，建议写回星火库知识卡。').length, 0, '干净内容应过')
  const violations = redLineCheck('该稿可自动发布无需人工审核，并应写入华夏舆参管道 state/ 目录。')
  assert.ok(violations.some((v) => v.startsWith('红线A')), '应命中红线A（写管道 state/）')
  assert.ok(violations.some((v) => v.startsWith('红线D')), '应命中红线D（自动定夺发布）')
})

test('reviewDistill 双向：违规采纳被拦 / 幽灵采纳被拦 / 采纳进待写回（全部落在隔离 VAULT）', async () => {
  const { buildWorkbenchData, reviewDistill, loadWritebackQueue } = await import('../src/server/data.ts')
  // 违规条目 adopt 必须抛错（红线）
  assert.throws(() => reviewDistill('test-danger.md', 'adopt'), /红线/, '违规采纳应被拦')
  // 不存在的条目 adopt 必须抛错（静默降级防护）
  assert.throws(() => reviewDistill('no-such-entry.md', 'adopt'), /拒绝无内容采纳/, '幽灵条目采纳应被拦')
  // 干净条目（runtime 队列）adopt 通过 → approved + 待写回
  reviewDistill('test-clean.md', 'adopt')
  reviewDistill('test-danger.md', 'ignore')
  const d = buildWorkbenchData()
  assert.ok(!d.distillQueue.some((e) => e.file === 'test-clean.md' || e.file === 'test-danger.md'), '两条均不应再出现在待审队列')
  assert.ok(d.distillReviewed.approved.includes('test-clean.md'), 'clean 应在 approved')
  assert.ok(d.distillReviewed.rejected.includes('test-danger.md'), 'danger 应在 rejected')
  const wb = loadWritebackQueue()
  assert.equal(wb.length, 1)
  assert.equal(wb[0].file, 'test-clean.md')
  assert.ok(wb[0].content.includes('建议写回'), '待写回含全文快照')
})