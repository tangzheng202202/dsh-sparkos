/** 五守卫双向测试：合法数据放行入库，五种违规各自拦截，commit 防重复追加。 */
import { test } from 'node:test'
import { strictEqual, ok, deepStrictEqual } from 'node:assert'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { validateDaily, type DailyData } from '../src/guards.ts'

function fixture() {
  const root = path.join(tmpdir(), `sparkos-guards-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const vault = path.join(root, 'vault')
  const knowledge = path.join(root, 'knowledge')
  mkdirSync(path.join(vault, 'config'), { recursive: true })
  mkdirSync(path.join(vault, 'archive'), { recursive: true })
  mkdirSync(path.join(knowledge, 'spark-notes', 'observations'), { recursive: true })
  mkdirSync(path.join(knowledge, 'spark-notes', 'models'), { recursive: true })
  writeFileSync(path.join(vault, 'config', 'narrative_lines.json'),
    JSON.stringify({ lines: [{ id: 'L01' }, { id: 'L02' }] }))
  writeFileSync(path.join(vault, 'archive', 'events.jsonl'),
    JSON.stringify({ event_id: 'old-1', date: '2026-08-10' }) + '\n')
  writeFileSync(path.join(knowledge, 'spark-notes', 'observations', '001-obs.md'), 'x')
  writeFileSync(path.join(knowledge, 'spark-notes', 'models', '005-model.md'), 'x')
  return { root, vault, knowledge, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function good(): DailyData {
  return {
    date: '2026-08-19',
    must_reads: [{ event_id: 'e1', title: 't1', fresh_hours: 10, primary_line: 'L01' }],
    drafts: [{ platform: 'xhs', cited_cards: ['obs://1', 'model://5'] }],
    line_updates: [{ line: 'L01' }],
    suggestions: [{ text: 's' }],
    distill_candidates: [],
  }
}

test('合法数据通过并 commit 入库（新 1 条，旧 1 条跳过）', () => {
  const f = fixture()
  try {
    const r = validateDaily(good(), { commit: true, vaultRoot: f.vault, knowledgeRoot: f.knowledge })
    ok(r.ok, r.errors.join('; '))
    strictEqual(r.committed, 1)
    strictEqual(r.skipped, 0)
    const lines = readFileSync(path.join(f.vault, 'archive', 'events.jsonl'), 'utf-8').trim().split('\n')
    strictEqual(lines.length, 2)
    ok(JSON.parse(lines[1]).event_id === 'e1')
  } finally { f.cleanup() }
})

test('G1 48h 窗口：fresh_hours=72 拦截', () => {
  const f = fixture()
  try {
    const d = good(); d.must_reads![0].fresh_hours = 72
    const r = validateDaily(d, { vaultRoot: f.vault, knowledgeRoot: f.knowledge })
    ok(!r.ok && r.errors.some((e) => e.startsWith('G1')))
  } finally { f.cleanup() }
})

test('G2 event_id 与事件库重复拦截；recheck+同日放行；当日重复拦截', () => {
  const f = fixture()
  try {
    const d = good(); d.must_reads![0].event_id = 'old-1'
    ok(!validateDaily(d, { vaultRoot: f.vault, knowledgeRoot: f.knowledge }).ok)
    ok(validateDaily({ ...d, date: '2026-08-10' }, { recheck: true, vaultRoot: f.vault, knowledgeRoot: f.knowledge }).ok)
    const dup = good(); dup.must_reads!.push({ ...dup.must_reads![0] })
    const r = validateDaily(dup, { vaultRoot: f.vault, knowledgeRoot: f.knowledge })
    ok(r.errors.some((e) => e.includes('当日重复')))
  } finally { f.cleanup() }
})

test('G3 引用卡不存在拦截；无引用卡告警', () => {
  const f = fixture()
  try {
    const d = good(); d.drafts![0].cited_cards = ['obs://999']
    ok(!validateDaily(d, { vaultRoot: f.vault, knowledgeRoot: f.knowledge }).ok)
    const w = good(); delete w.drafts![0].cited_cards
    const r = validateDaily(w, { vaultRoot: f.vault, knowledgeRoot: f.knowledge })
    ok(r.ok && r.warnings.some((x) => x.includes('深度层缺失')))
  } finally { f.cleanup() }
})

test('G4 未知主线拦截', () => {
  const f = fixture()
  try {
    const d = good(); d.line_updates![0].line = 'NOPE'
    ok(!validateDaily(d, { vaultRoot: f.vault, knowledgeRoot: f.knowledge }).ok)
  } finally { f.cleanup() }
})

test('G5 建议只读：commit 后 config 文件不被写入建议内容', () => {
  const f = fixture()
  try {
    validateDaily(good(), { commit: true, vaultRoot: f.vault, knowledgeRoot: f.knowledge })
    const cfg = readFileSync(path.join(f.vault, 'config', 'narrative_lines.json'), 'utf-8')
    ok(!cfg.includes('suggestions'))
  } finally { f.cleanup() }
})

test('commit 防重复追加：同数据二次 commit 零新增', () => {
  const f = fixture()
  try {
    const o = { commit: true, vaultRoot: f.vault, knowledgeRoot: f.knowledge } as const
    validateDaily(good(), o)
    const r2 = validateDaily(good(), { ...o, recheck: true })
    strictEqual(r2.committed, 0)
    const lines = readFileSync(path.join(f.vault, 'archive', 'events.jsonl'), 'utf-8').trim().split('\n')
    strictEqual(lines.length, 2)
  } finally { f.cleanup() }
})
