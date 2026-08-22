/**
 * HTTP 路由层测试：模块级单 fixture + env 前置，handleSparkosHttp 直测（mock req/res）。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'sparkos-routes-'))
const vault = join(root, 'vault')
const brief = join(root, 'daily_brief')
const drafts = join(brief, 'drafts')
const queue = join(root, 'obsidian-bridge', 'distill_queue')
const archive = join(root, 'archive')
mkdirSync(join(vault, 'config'), { recursive: true })
mkdirSync(join(vault, 'archive'), { recursive: true })
mkdirSync(join(vault, 'distill_queue'), { recursive: true })
mkdirSync(drafts, { recursive: true })
mkdirSync(queue, { recursive: true })
mkdirSync(archive, { recursive: true })
writeFileSync(join(vault, 'config', 'narrative_lines.json'), JSON.stringify({ lines: [{ id: 'L01' }] }))
writeFileSync(join(vault, 'config', 'line_names.json'), JSON.stringify({ L01: '主线一' }))
writeFileSync(join(brief, 'daily_data_2026-08-20.json'), JSON.stringify({ date: '2026-08-20', must_reads: [{ event_id: 'ev-1', title: '事件一', fresh_hours: 4, primary_line: 'L01' }] }))
writeFileSync(join(brief, 'daily_briefing_2026-08-20.md'), '# 每日简报\n\n## 一、必读\n- 事件一')
writeFileSync(join(drafts, '2026-08-20-wechat.md'), '# 草稿\n\n全文内容。')
writeFileSync(join(queue, '2026-08-20-cand.md'), '---\ntitle: 候选\n---\n观察内容。')
writeFileSync(join(archive, 'events.jsonl'), JSON.stringify({ event_id: 'e1' }) + '\n')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_CONTENTOS_ROOT = root
process.env.SPARKOS_DAILY_BRIEF_DIR = brief
process.env.SPARKOS_RUNTIME_DISTILL_QUEUE = queue
process.env.SPARKOS_RUNTIME_EVENTS = join(archive, 'events.jsonl')
process.env.SPARKOS_TIMELINE_DATA = join(vault, 'config', 'timeline_cards.json')
after(() => rmSync(root, { recursive: true, force: true }))

type MockRes = { res: import('node:http').ServerResponse; out: { status: number; body: string } }

function mockReq(method: string, url: string, body?: unknown) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  let i = 0
  return {
    method,
    url,
    [Symbol.asyncIterator]() {
      return {
        next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
      }
    },
  } as unknown as import('node:http').IncomingMessage
}

function mockRes(): MockRes {
  const out = { status: 0, body: '' }
  const res = {
    writeHead(status: number) { out.status = status },
    end(payload: string) { out.body = payload },
  } as unknown as import('node:http').ServerResponse
  return { res, out }
}

test('GET /sparkos/data：嵌入每日产物（daily.date / briefing / drafts / distill / events）', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const { res, out } = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/data'), res)
  assert.equal(out.status, 200)
  const j = JSON.parse(out.body)
  assert.equal(j.ok, true)
  assert.equal(j.value.daily.date, '2026-08-20')
  assert.ok(j.value.daily.briefing.includes('每日简报'))
  assert.equal(j.value.runtimeDrafts.length, 1)
  assert.equal(j.value.distillQueue.length, 1)
  assert.equal(j.value.events, 1)
  assert.equal(j.value.lines[0].name, '主线一')
})

test('GET /sparkos/draft：按文件名读全文；路径穿越拒绝', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const ok1 = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/draft?file=2026-08-20-wechat.md'), ok1.res)
  assert.equal(ok1.out.status, 200)
  assert.ok(JSON.parse(ok1.out.body).value.content.includes('全文内容'))
  const bad = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/draft?file=..%2F..%2Fetc%2Fpasswd'), bad.res)
  assert.equal(bad.out.status, 400)
  const missing = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/draft?file=nope.md'), missing.res)
  assert.equal(missing.out.status, 404)
})

test('POST /sparkos/mutate：topic 决策落盘；非法 action 400；蒸馏采纳进待写回', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const res = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/mutate', { kind: 'topic', id: 'ev-1', action: 'adopt' }), res.res)
  assert.equal(res.out.status, 200)
  assert.equal(JSON.parse(res.out.body).entry.action, 'adopt')
  const decisionsFile = join(vault, 'state', 'decisions.json')
  assert.ok(existsSync(decisionsFile))
  const bad = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/mutate', { kind: 'topic', id: 'ev-1', action: 'hack' }), bad.res)
  assert.equal(bad.out.status, 400)
  // 蒸馏采纳（runtime 队列）→ 待写回清单
  const dres = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/mutate', { kind: 'distill', id: '2026-08-20-cand.md', action: 'adopt' }), dres.res)
  assert.equal(dres.out.status, 200)
  const wbFile = join(vault, 'state', 'writeback_queue.json')
  assert.ok(existsSync(wbFile))
  const wb = JSON.parse(readFileSync(wbFile, 'utf8'))
  assert.equal(wb.length, 1)
  assert.ok(wb[0].content.includes('观察内容'), '待写回含全文快照')
})

test('写回清单端点：GET 列表 / POST remove 单条移除', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  await handleSparkosHttp(mockReq('POST', '/sparkos/mutate', { kind: 'distill', id: '2026-08-20-cand.md', action: 'adopt' }), mockRes().res)
  const gres = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/writeback'), gres.res)
  assert.equal(gres.out.status, 200)
  assert.equal(JSON.parse(gres.out.body).value.length, 1)
  const rres = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/writeback/remove', { file: '2026-08-20-cand.md' }), rres.res)
  assert.equal(rres.out.status, 200)
  assert.equal(JSON.parse(rres.out.body).value.length, 0)
})

test('POST /sparkos/editorial/decision：选题卡人工批准落 SQLite 审批闸门', async () => {
  const { openFactoryDatabase } = await import('../src/storage/database.ts')
  const { generateDailyRanking } = await import('../src/intel/ranking.ts')
  const { generateEditorialPlan } = await import('../src/editorial/planner.ts')
  const db = openFactoryDatabase()
  generateDailyRanking(db, [{
    clusterId: 'c-20260822-001', topicKey: 't-route-editorial', date: '20260822', topic: '路由测试选题',
    coreFacts: ['事实已确认'], heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: ['https://official.example/route'], evidence: [{ url: 'https://official.example/route', sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://route'], credibility: 'high', risks: [], platforms: ['wechat'], angleSuggestions: ['测试角度'],
    eventKeys: ['route-1', 'route-2'], judgment: { confirmedFacts: ['事实已确认'], inferences: [], editorialView: '测试判断', counterArguments: ['反方'], uncertainties: [] },
  }], '2026-08-22')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-22')
  db.close()

  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const ok = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/editorial/decision', { cardId: plan.cards[0].id, decision: 'approved' }), ok.res)
  assert.equal(ok.out.status, 200)
  assert.equal(JSON.parse(ok.out.body).value.decision, 'approved')
  const bad = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/editorial/decision', { cardId: 'bad', decision: 'approved' }), bad.res)
  assert.equal(bad.out.status, 400)
})

test('404：未知路径返回 not-found', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const res = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/nope'), res.res)
  assert.equal(res.out.status, 404)
  assert.ok(JSON.parse(res.out.body).error.code === 'not-found')
})
test('POST body 超限返回 413', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const big = { kind: 'topic', id: 'x', action: 'adopt', pad: 'a'.repeat(300 * 1024) }
  const res = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/mutate', big), res.res)
  assert.equal(res.out.status, 413)
})
