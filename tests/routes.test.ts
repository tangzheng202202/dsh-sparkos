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
    headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
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

test('POST /sparkos/creation/decision：驳回必须携带非空 note，批准不强制', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const packageId = 'dp-0000000000000000'
  for (const body of [
    { packageId, decision: 'rejected' },
    { packageId, decision: 'rejected', note: '   ' },
  ]) {
    const rejected = mockRes()
    await handleSparkosHttp(mockReq('POST', '/sparkos/creation/decision', body), rejected.res)
    assert.equal(rejected.out.status, 400)
    assert.match(JSON.parse(rejected.out.body).error.message, /必须填写审核意见/)
  }
  const approved = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/creation/decision', { packageId, decision: 'approved' }), approved.res)
  assert.equal(approved.out.status, 422, '批准无 note 应通过 HTTP 参数校验并进入业务状态检查')
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
  const { buildFactorySnapshot, runDraftSubmission } = await import('../src/factory/service.ts')
  const draftPackage = buildFactorySnapshot().drafts[0]
  assert.equal(draftPackage.status, 'awaiting_generation', '批准选题后自动创建草稿任务')
  const long = '这是经过证据约束的完整平台草稿内容，明确区分事实、推断与观点，并保留人工审核。'.repeat(30)
  runDraftSubmission({
    packageId: draftPackage.id, editorialAngle: '路由测试角度', keyMessage: '流程必须可审计', factBoundary: '长期影响仍待观察',
    factClaims: [
      { text: '事实已确认', kind: 'fact', evidenceUrls: ['https://official.example/route'] },
      { text: '官方证据可回链', kind: 'fact', evidenceUrls: ['https://official.example/route'] },
      { text: '长期影响待观察', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: { title: '路由测试完整稿', dek: '经过校验的摘要', blocks: [
        { type: 'heading', level: 2, text: '结论' }, { type: 'paragraph', text: long },
        { type: 'image', assetId: 'inline-one', caption: '流程图' }, { type: 'heading', level: 2, text: '边界' },
        { type: 'paragraph', text: long }, { type: 'paragraph', text: long },
      ] },
      telegram: { title: 'Telegram 完整稿', body: long },
      x: { posts: ['内容工厂需要证据链和人工审核。'] },
      xiaohongshu: { title: '内容工厂测试', body: long, hashtags: ['AI', '内容创作', '工作流'] },
    },
    assets: [
      { id: 'cover-one', kind: 'cover', prompt: '内容工厂封面', altText: '封面', aspectRatio: '2.35:1', placement: '封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
      { id: 'inline-one', kind: 'inline', prompt: '流程图', altText: '流程', aspectRatio: '16:9', placement: '正文', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
      { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图', altText: '首图', aspectRatio: '3:4', placement: '小红书第一张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
      { id: 'carousel-one', kind: 'carousel', prompt: '卡片图', altText: '卡片', aspectRatio: '3:4', placement: '小红书第二张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
    ],
  })
  const preview = mockRes()
  await handleSparkosHttp(mockReq('GET', `/sparkos/creation/artifact?packageId=${draftPackage.id}&file=wechat.html`), preview.res)
  assert.equal(preview.out.status, 200)
  assert.match(String(preview.out.body), /<!doctype html>/)
  const rejectDraft = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/creation/decision', { packageId: draftPackage.id, decision: 'rejected', note: '请重写开头' }), rejectDraft.res)
  assert.equal(rejectDraft.out.status, 200)
  assert.equal(JSON.parse(rejectDraft.out.body).value.status, 'rejected')
  assert.equal(JSON.parse(rejectDraft.out.body).value.reviewNote, '请重写开头')
  const rejectedSnapshot = buildFactorySnapshot().drafts.find((item) => item.id === draftPackage.id)!
  assert.equal(rejectedSnapshot.reviewNote, '请重写开头')
  const revision = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/creation/revise', { packageId: draftPackage.id }), revision.res)
  assert.equal(revision.out.status, 200)
  assert.equal(JSON.parse(revision.out.body).value.parentReviewNote, '请重写开头')
  const bad = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/editorial/decision', { cardId: 'bad', decision: 'approved' }), bad.res)
  assert.equal(bad.out.status, 400)
})

test('GET /sparkos/app-v2：V2 受控工作台（GET 200 · 内嵌数据 · 仅含六类受控 POST · 无其它写端点）', async () => {
  const { handleSparkosHttp } = await import('../src/server/routes.ts')
  const res = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/app-v2'), res.res)
  assert.equal(res.out.status, 200)
  const html = res.out.body
  assert.ok(html.includes('window._embeddedDailyData'), 'V2 注入同一数据范式')
  assert.ok(html.includes('id="visual-lightbox"'), 'V2 复用受控 lightbox')
  assert.ok(html.includes('data-nav="intel"') || html.includes("data-nav='intel'") || html.includes('data-nav'), 'V2 侧栏导航')
  assert.ok(html.includes('V2 受控操作'), 'V2 受控操作声明')
  // 受控写边界（M6.6）：V2 允许的写端点为视觉 decision/retry、草稿 decision/revise、
  // 交付 delivery 与发布 publish（publish 仅创建台账 job，不自动发布），
  // 均只在人工确认对话框提交时以 POST 发送；其余写端点一律不得出现。
  assert.ok(html.includes('/sparkos/visual/decision'), 'V2 应引用受控视觉审核端点')
  assert.ok(html.includes('/sparkos/visual/retry'), 'V2 应引用受控重试端点（仅人工确认后 POST）')
  assert.ok(html.includes('/sparkos/creation/decision'), 'V2 应引用受控草稿审批端点（仅人工确认后 POST）')
  assert.ok(html.includes('/sparkos/creation/revise'), 'V2 应引用受控草稿修订端点（仅人工确认后 POST）')
  assert.ok(html.includes('/sparkos/visual/delivery'), 'V2 应引用受控交付生成端点（仅人工确认后 POST）')
  assert.ok(html.includes('/sparkos/publish'), 'V2 应引用受控发布任务端点（仅创建台账，不自动发布）')
  assert.ok(html.includes('data-draft-decision'), 'V2 应含草稿审批按钮')
  for (const forbidden of ['/sparkos/visual/queue', '/sparkos/mutate', '/sparkos/editorial/decision', 'data-editorial']) {
    assert.ok(!html.includes(forbidden), 'V2 页面不得包含写端点：' + forbidden)
  }
  assert.ok(!html.includes('"PUT"') && !html.includes('"PATCH"') && !html.includes('"DELETE"') && !html.includes("'PUT'") && !html.includes("'PATCH'") && !html.includes("'DELETE'"), 'V2 不得发起 PUT/PATCH/DELETE')
  // 与 V1 隔离：V2 不含 V1 的 nav-tab 标记；V1 不含 V2 标记
  assert.ok(!html.includes('nav-tab'), 'V2 不含 V1 导航标记')
  assert.ok(html.includes('data-nav='), 'V2 含 hash 路由导航')
  const v1 = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/app'), v1.res)
  assert.equal(v1.out.status, 200)
  assert.ok(v1.out.body.includes('nav-tab'), 'V1 保持不变')
  assert.ok(!v1.out.body.includes('data-nav='), 'V1 不含 V2 导航标记')
  // 只读：POST /sparkos/app-v2 一律 404
  const post = mockRes()
  await handleSparkosHttp(mockReq('POST', '/sparkos/app-v2'), post.res)
  assert.equal(post.out.status, 404)
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
