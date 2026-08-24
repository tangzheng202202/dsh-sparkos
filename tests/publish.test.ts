/** M6.6 受控发布任务创建（台账，不自动发布）回归测试。
 * 隔离 fixture：就绪包创建 kind=publish 的 workflow job 作为可追溯台账，
 * 绝不实际发布；幂等同包复用；未就绪/testOnly 拒绝；visualStatus 展示最近任务。 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DraftAssetPlan, DraftSubmission } from '../src/creation/drafts.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-publish-'))
const vault = path.join(root, 'vault')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_DB_PATH = path.join(vault, 'data', 'sparkos.db')
after(() => rmSync(root, { recursive: true, force: true }))

const { openFactoryDatabase } = await import('../src/storage/database.ts')
const { generateDailyRanking } = await import('../src/intel/ranking.ts')
const { generateEditorialPlan, decideEditorialCard } = await import('../src/editorial/planner.ts')
const { ensureDraftRequest, submitDraftPackage, decideDraftPackage } = await import('../src/creation/drafts.ts')
const { claimVisualTask, queueVisualBatch, submitVisualAttachment, visualStatus, VisualPipelineError } = await import('../src/visual/service.ts')
const { createVisualDelivery } = await import('../src/visual/delivery.ts')
const { decideVisualAttempt, createPublishTask, latestPublishTask } = await import('../src/visual/review.ts')
const { handleSparkosHttp } = await import('../src/server/routes.ts')

const evidenceUrl = 'https://official.example/publish'

const V2_ASSETS: DraftAssetPlan[] = [
  { id: 'cover-main', kind: 'cover', prompt: '封面提示词', altText: '公众号封面', aspectRatio: '2.35:1', placement: '微信公众号封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
  { id: 'inline-one', kind: 'inline', prompt: '正文提示词', altText: '正文流程图', aspectRatio: '16:9', placement: '微信正文第一节后', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
  { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图提示词', altText: '小红书首图', aspectRatio: '3:4', placement: '小红书第1张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
  { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播提示词', altText: '小红书第二张', aspectRatio: '3:4', placement: '小红书第2张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
]

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

let fixtureNo = 0

function cluster(): IntelCluster {
  fixtureNo += 1
  return {
    clusterId: 'c-20260823-publish-' + fixtureNo, topicKey: 't-publish-' + fixtureNo, date: '20260823', topic: 'M6.6 发布任务 ' + fixtureNo,
    coreFacts: ['发布由人工执行'], heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: [evidenceUrl], evidence: [{ url: evidenceUrl, sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://publish'], credibility: 'high', risks: [], platforms: ['wechat', 'telegram', 'x', 'xiaohongshu'],
    angleSuggestions: [], eventKeys: ['p1', 'p2'],
    judgment: { confirmedFacts: ['发布由人工执行'], inferences: [], editorialView: '', counterArguments: [], uncertainties: [] },
  }
}

function submission(packageId: string): DraftSubmission {
  const paragraph = '这是围绕已确认事实展开的完整正文，明确区分事实、推断和观点，并说明受控发布任务与人工发布之间的边界。'.repeat(6)
  const assets = V2_ASSETS.map((asset) => ({ ...asset, platforms: [...asset.platforms!] }))
  return {
    packageId, editorialAngle: '受控发布', keyMessage: '发布任务仅作台账，最终发布由人工在对应后台执行。',
    factBoundary: '功能实现属于事实；长期影响仍待观察。',
    factClaims: [
      { text: '发布由人工执行', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '任务可追溯', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '可能提升效率', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: { title: '为什么发布要人工', dek: '可靠附件只是起点。', blocks: [
        { type: 'heading', level: 2, text: '先说结论' }, { type: 'paragraph', text: paragraph },
        { type: 'image', assetId: 'inline-one', caption: '流程图' },
        { type: 'heading', level: 2, text: '边界' }, { type: 'paragraph', text: paragraph }, { type: 'paragraph', text: paragraph },
      ] },
      telegram: { title: '受控发布', body: paragraph + paragraph },
      x: { posts: ['发布需要人工。'] },
      xiaohongshu: { title: '发布避坑', body: paragraph + paragraph + ' asset://xhs-cover', hashtags: ['内容创作', '审核', '发布'] },
    },
    assets,
  }
}

function fixture(options: { stub?: boolean; dbPath?: string } = {}) {
  const db = openFactoryDatabase({ path: options.dbPath ?? ':memory:' })
  generateDailyRanking(db, [cluster()], '2026-08-23')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-23')
  const card = plan.cards.find((item) => item.topicKey === 't-publish-' + fixtureNo) ?? plan.cards[0]
  decideEditorialCard(db, card.id, 'approved')
  const draft = ensureDraftRequest(db, card.id).package
  const submitted = submitDraftPackage(db, submission(draft.id), new Date('2026-08-23T08:00:00Z'))
  assert.equal(submitted.validation.ok, true, submitted.validation.errors.join('; '))
  const approved = decideDraftPackage(db, draft.id, 'approved', undefined, new Date('2026-08-23T08:01:00Z'))
  const queued = queueVisualBatch(db, approved.id, new Date('2026-08-23T08:02:00Z'))
  return { db, package: approved, queued, stub: !!options.stub }
}

function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(64)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data)
  data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20)
  return data
}

function attachment(data: Buffer, width: number, height: number) {
  const ref = { attachmentId: 'sha256:' + sha256(data), mediaType: 'image/png', bytes: data.byteLength, width, height, name: 'generated.png' }
  return {
    ref,
    reader: { async readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> { return { ref: ref as unknown as ImageAttachmentRef, data } } },
  }
}

async function generateAll(db: ReturnType<typeof openFactoryDatabase>, packageId: string, provider: string) {
  let second = 1
  while (true) {
    const claim = claimVisualTask(db, { packageId }, new Date('2026-08-23T09:' + String(second).padStart(2, '0') + ':00Z'))
    if (!claim) break
    const image = attachment(png(claim.task.targetWidth, claim.task.targetHeight), claim.task.targetWidth, claim.task.targetHeight)
    await submitVisualAttachment(db, image.reader, { taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref, provider, model: provider === 'stub' ? 'stub-v1' : 'image-model', sourceTool: 'image_generate' }, { now: new Date('2026-08-23T09:' + String(second).padStart(2, '0') + ':10Z') })
    second += 1
  }
}

function approveAll(db: ReturnType<typeof openFactoryDatabase>, packageId: string) {
  let minute = 20
  const batch = visualStatus(db, packageId).batches[0]
  for (const task of batch.tasks) {
    const attempt = task.attempts.find((item) => item.attemptNo === task.currentAttempt)!
    decideVisualAttempt(db, { attemptId: attempt.id, decision: 'approved' }, new Date('2026-08-23T10:' + String(minute).padStart(2, '0') + ':00Z'))
    minute += 1
  }
}

test('M6.6: 就绪包创建 kind=publish 台账 job，绝不实际发布；幂等同包复用', async () => {
  const item = fixture()
  const pkg = item.queued.batch.packageId
  await generateAll(item.db, pkg, 'openai')
  approveAll(item.db, pkg)
  createVisualDelivery(item.db, { packageId: pkg, mode: 'production' }, new Date('2026-08-23T11:00:00Z'))
  const beforePublishJobs = Number(item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind='publish'").get()!.count)
  const result = createPublishTask(item.db, pkg, new Date('2026-08-23T12:00:00Z'))
  assert.equal(result.created, true)
  assert.equal(result.status, 'queued')
  assert.equal(result.readyForPublication, true)
  assert.equal(Number(item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind='publish'").get()!.count), beforePublishJobs + 1)
  const job = item.db.prepare('SELECT kind, status, idempotency_key, input_json FROM workflow_jobs WHERE id=?').get(result.jobId) as { kind: string; status: string; idempotency_key: string | null; input_json: string }
  assert.equal(job.kind, 'publish')
  assert.equal(job.status, 'queued')
  assert.equal(job.idempotency_key, 'publish:' + pkg)
  assert.deepEqual(JSON.parse(job.input_json), { packageId: pkg })
  // 幂等：同包重复请求返回同一任务
  const again = createPublishTask(item.db, pkg)
  assert.equal(again.created, false)
  assert.equal(again.jobId, result.jobId)
  // 绝不实际发布：job 保持 queued，无平台执行痕迹
  assert.equal(Number(item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind='publish' AND status='queued'").get()!.count), 1)
  // visualStatus 展示最近发布任务
  const publishTask = visualStatus(item.db, pkg).batches[0].publishTask
  assert.ok(publishTask, 'publishTask 应展示')
  assert.equal(publishTask.id, result.jobId)
  assert.equal(publishTask.status, 'queued')
  item.db.close()
})

test('M6.6: 未就绪（视觉未批准）与 testOnly 均拒绝创建发布任务', async () => {
  // 视觉未批准
  const item = fixture()
  const pkg = item.queued.batch.packageId
  assert.throws(() => createPublishTask(item.db, pkg), (error) => error instanceof VisualPipelineError && error.code === 'publish-not-ready')
  assert.equal(latestPublishTask(item.db, pkg), null, '无任务时不展示')
  item.db.close()
  // testOnly（stub 全批准）
  const stubItem = fixture({ stub: true })
  const stubPkg = stubItem.queued.batch.packageId
  await generateAll(stubItem.db, stubPkg, 'stub')
  approveAll(stubItem.db, stubPkg)
  assert.throws(() => createPublishTask(stubItem.db, stubPkg), (error) => error instanceof VisualPipelineError && error.code === 'publish-not-ready')
  stubItem.db.close()
})

test('M6.6: HTTP POST /sparkos/publish 受控端点（200/400/404/409，不自动发布）', async () => {
  const item = fixture({ dbPath: process.env.SPARKOS_DB_PATH! })
  const pkg = item.queued.batch.packageId
  await generateAll(item.db, pkg, 'openai')
  approveAll(item.db, pkg)
  createVisualDelivery(item.db, { packageId: pkg, mode: 'production' }, new Date('2026-08-23T11:00:00Z'))
  item.db.close()
  // 未就绪 409
  const pending = fixture({ dbPath: process.env.SPARKOS_DB_PATH! })
  const pendingPkg = pending.queued.batch.packageId
  pending.db.close()
  assert.equal((await http('POST', '/sparkos/publish', { packageId: pendingPkg })).status, 409)
  // 非法 400
  assert.equal((await http('POST', '/sparkos/publish', { packageId: 'bad' })).status, 400)
  assert.equal((await http('POST', '/sparkos/publish', { packageId: pkg, extra: 1 })).status, 400)
  // 404
  assert.equal((await http('POST', '/sparkos/publish', { packageId: 'dp-' + '9'.repeat(16) })).status, 404)
  // 就绪 200
  const ok = await http('POST', '/sparkos/publish', { packageId: pkg })
  assert.equal(ok.status, 200)
  assert.equal((JSON.parse(ok.body.toString('utf8')) as { value: { status: string } }).value.status, 'queued')
  // 幂等重放 200
  const replay = await http('POST', '/sparkos/publish', { packageId: pkg })
  assert.equal(replay.status, 200)
  const db = openFactoryDatabase()
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind='publish'").get()!.count), 1, '幂等：只创建一个发布任务')
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind='publish' AND status='queued'").get()!.count), 1, '任务保持 queued，不自动发布')
  db.close()
})

interface HttpResult { status: number; headers: Record<string, string>; body: Buffer }
async function http(method: string, url: string, body?: unknown): Promise<HttpResult> {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  Object.assign(req, { method, url, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} })
  const result: HttpResult = { status: 0, headers: {}, body: Buffer.alloc(0) }
  const res = {
    writeHead(status: number, headers: Record<string, string>) { result.status = status; result.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])) },
    end(chunk?: string | Buffer) { result.body = chunk === undefined ? Buffer.alloc(0) : Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk) },
  } as unknown as ServerResponse
  await handleSparkosHttp(req, res)
  return result
}

