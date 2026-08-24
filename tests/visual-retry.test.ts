/** M6.2 controlled retry (V2 视觉驳回 → 按意见重试) regression tests.
 * 完全隔离 fixture：不触碰生产视觉任务；不调用真实 image_generate；
 * 只创建重试任务并验证状态机、幂等、maxAttempts、authoritative prompt、
 * 历史保留与“不自动审批/交付/发布”不变量。 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DraftAssetPlan, DraftSubmission } from '../src/creation/drafts.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-m62-'))
const vault = path.join(root, 'vault')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_DB_PATH = path.join(vault, 'data', 'sparkos.db')
after(() => rmSync(root, { recursive: true, force: true }))

const { openFactoryDatabase } = await import('../src/storage/database.ts')
const { generateDailyRanking } = await import('../src/intel/ranking.ts')
const { generateEditorialPlan, decideEditorialCard } = await import('../src/editorial/planner.ts')
const { ensureDraftRequest, submitDraftPackage, decideDraftPackage } = await import('../src/creation/drafts.ts')
const { claimVisualTask, queueVisualBatch, submitVisualAttachment, visualStatus, VisualPipelineError } = await import('../src/visual/service.ts')
const { decideVisualAttempt, requestVisualRetry, retryVisualTask } = await import('../src/visual/review.ts')
const { handleSparkosHttp } = await import('../src/server/routes.ts')

const evidenceUrl = 'https://official.example/m62'
let fixtureNo = 0

const V2_ASSETS: DraftAssetPlan[] = [
  { id: 'cover-main', kind: 'cover', prompt: '封面提示词：温暖晨光下的城市街区', altText: '公众号封面', aspectRatio: '2.35:1', placement: '微信公众号封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
  { id: 'inline-one', kind: 'inline', prompt: '正文提示词：数据流程图', altText: '正文流程图', aspectRatio: '16:9', placement: '微信正文第一节后', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
  { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图提示词', altText: '小红书首图', aspectRatio: '3:4', placement: '小红书第1张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
  { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播提示词', altText: '小红书第二张', aspectRatio: '3:4', placement: '小红书第2张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
]

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function cluster(suffix: string): IntelCluster {
  return {
    clusterId: `c-20260823-m62-${suffix}`, topicKey: `t-m62-${suffix}`, date: '20260823', topic: `M6.2 受控重试 ${suffix}`,
    coreFacts: ['重试由人工发起'], heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: [evidenceUrl], evidence: [{ url: evidenceUrl, sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://m62'], credibility: 'high', risks: ['样本有限'], platforms: ['wechat', 'telegram', 'x', 'xiaohongshu'],
    angleSuggestions: ['从受控重试切入'], eventKeys: [`${suffix}-1`, `${suffix}-2`],
    judgment: { confirmedFacts: ['重试由人工发起'], inferences: ['可能提升审核效率'], editorialView: '重试必须可追溯。', counterArguments: ['流程有成本'], uncertainties: ['样本有限'] },
  }
}

function submission(packageId: string, assets: DraftAssetPlan[]): DraftSubmission {
  const paragraph = '这是围绕已确认事实展开的完整正文，明确区分事实、推断和观点，并说明人工重试、视觉生成与发布准备之间的边界。'.repeat(6)
  const copy = assets.map((asset) => ({ ...asset, platforms: asset.platforms ? [...asset.platforms] : undefined }))
  return {
    packageId, editorialAngle: '受控重试与审核', keyMessage: '被驳回的图片只能由人工按意见发起重试。',
    factBoundary: '功能实现属于事实；长期影响仍待观察。',
    factClaims: [
      { text: '重试由人工发起', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '审核意见可追溯', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '可能提升审核效率', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: { title: '为什么重试要人工', dek: '可靠附件只是起点，人工决定和交付闸门同样重要。', blocks: [
        { type: 'heading', level: 2, text: '先说结论' }, { type: 'paragraph', text: paragraph },
        { type: 'image', assetId: 'inline-one', caption: '审核流程图' },
        { type: 'heading', level: 2, text: '交付边界' }, { type: 'paragraph', text: paragraph }, { type: 'paragraph', text: paragraph },
      ] },
      telegram: { title: '受控重试', body: paragraph + paragraph },
      x: { posts: ['人工重试需要可追溯。'] },
      xiaohongshu: { title: '重试避坑', body: paragraph + paragraph + ' asset://xhs-cover', hashtags: ['视觉生产', '内容创作', '审核'] },
    },
    assets: copy,
  }
}

function fixture(options: { dbPath?: string } = {}) {
  fixtureNo += 1
  const db = openFactoryDatabase({ path: options.dbPath ?? ':memory:' })
  const suffix = String(fixtureNo).padStart(3, '0')
  generateDailyRanking(db, [cluster(suffix)], '2026-08-23')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-23')
  const card = plan.cards.find((item) => item.topicKey === `t-m62-${suffix}`) ?? plan.cards[0]
  decideEditorialCard(db, card.id, 'approved')
  const draft = ensureDraftRequest(db, card.id).package
  const submitted = submitDraftPackage(db, submission(draft.id, V2_ASSETS), new Date('2026-08-23T08:00:00Z'))
  assert.equal(submitted.validation.ok, true, submitted.validation.errors.join('; '))
  const approved = decideDraftPackage(db, draft.id, 'approved', undefined, new Date('2026-08-23T08:01:00Z'))
  const queued = queueVisualBatch(db, approved.id, new Date('2026-08-23T08:02:00Z'))
  return { db, queued }
}

function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(64)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data)
  data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20)
  return data
}

function attachment(data: Buffer, width: number, height: number) {
  const ref = { attachmentId: `sha256:${sha256(data)}`, mediaType: 'image/png', bytes: data.byteLength, width, height, name: 'generated.png' }
  return {
    ref,
    reader: { async readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> { return { ref: ref as unknown as ImageAttachmentRef, data } } },
  }
}

async function submitClaim(db: ReturnType<typeof openFactoryDatabase>, claim: NonNullable<ReturnType<typeof claimVisualTask>>, provider: string, second: number, extra: Record<string, unknown> = {}) {
  const image = attachment(png(claim.task.targetWidth, claim.task.targetHeight), claim.task.targetWidth, claim.task.targetHeight)
  return submitVisualAttachment(db, image.reader, {
    taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref,
    provider, model: provider === 'stub' ? 'stub-v1' : 'image-model', sourceTool: 'image_generate', promptEffective: claim.authoritativePrompt,
    ...extra,
  }, { now: new Date(`2026-08-23T09:${String(second).padStart(2, '0')}:00Z`) })
}

/** 生成第一个 attempt 并人工驳回，返回当前 attempt 与驳回意见。 */
async function rejectFirst(db: ReturnType<typeof openFactoryDatabase>, packageId: string, provider = 'openai', note = '构图需要重做：主体放大，去掉左下角杂物') {
  const claim = claimVisualTask(db, { packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(db, claim, provider, 1)
  const task = visualStatus(db, packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((item) => item.attemptNo === task.currentAttempt)!
  decideVisualAttempt(db, { attemptId: attempt.id, decision: 'rejected', note }, new Date('2026-08-23T10:00:00Z'))
  return { db, task, attempt, note, claim }
}

function retryPayload(task: { id: string; packageId: string; assetId: string; currentAttempt: number }, attempt: { id: string }, idempotencyKey?: string, extra: Record<string, unknown> = {}) {
  return {
    packageId: task.packageId, taskId: task.id, currentAttemptId: attempt.id, assetId: task.assetId,
    idempotencyKey: idempotencyKey ?? `retry:${task.id}:${attempt.id}`,
    ...extra,
  }
}

function visualError(code: string): (error: unknown) => boolean {
  return (error) => error instanceof VisualPipelineError && error.code === code
}

function artifactSnapshot(artifacts: Array<{ relativePath: string }>): Record<string, { sha: string; mtime: string }> {
  return Object.fromEntries(artifacts.map((artifact) => {
    const file = path.join(vault, artifact.relativePath)
    return [artifact.relativePath, { sha: sha256(readFileSync(file)), mtime: String(statSync(file, { bigint: true }).mtimeNs) }]
  }))
}

function imageSnapshot(relativePath: string): { sha: string; mtime: string } {
  const file = path.join(vault, relativePath)
  return { sha: sha256(readFileSync(file)), mtime: String(statSync(file, { bigint: true }).mtimeNs) }
}

// ---------------------------------------------------------------------------

test('1: rejected current attempt can request a retry; new attemptNo is monotonic and claimable', async () => {
  const item = fixture()
  const { db, task, attempt, note } = await rejectFirst(item.db, item.queued.batch.packageId)
  const result = requestVisualRetry(db, retryPayload(task, attempt))
  assert.equal(result.state, 'retry')
  assert.equal(result.previousNote, note)
  assert.equal(result.idempotent, false)
  assert.equal(result.expectedNextAttemptNo, 2)
  const fresh = visualStatus(db, task.packageId).batches[0].tasks[0]
  assert.equal(fresh.pipelineState, 'retry')
  assert.equal(fresh.retry.eligible, false, 'already requested → no longer retryable')
  // 领取新 attempt：attemptNo 单调递增，authoritativePrompt 携带驳回意见
  const claimed = claimVisualTask(db, { packageId: task.packageId }, new Date('2026-08-23T11:00:00Z'))!
  assert.equal(claimed.attempt.attemptNo, 2)
  assert.equal(claimed.previousNote, note)
  assert.match(claimed.authoritativePrompt, new RegExp(escapeRe(task.prompt)))
  assert.match(claimed.authoritativePrompt, new RegExp(escapeRe(note)))
  assert.match(claimed.authoritativePrompt, /固定规格/)
  assert.match(claimed.authoritativePrompt, /事实边界/)
  // retry request 标记为 claimed
  const row = db.prepare("SELECT status FROM visual_retry_requests WHERE task_id=?").get(task.id) as { status: string }
  assert.equal(row.status, 'claimed')
  db.close()
})

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('2: retry is refused when the reject note is blank', async () => {
  const item = fixture()
  const { db, task, attempt } = await rejectFirst(item.db, item.queued.batch.packageId, 'openai', '有效意见')
  // 测试隔离 fixture 直接清空意见，模拟“驳回意见缺失”
  db.prepare("UPDATE approvals SET note='   ' WHERE subject_kind='visual_attempt' AND subject_id=?").run(attempt.id)
  assert.throws(() => requestVisualRetry(db, retryPayload(task, attempt)), visualError('retry-note-required'))
  db.close()
})

test('3: approved tasks cannot be retried', async () => {
  const item = fixture()
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'approved' }, new Date('2026-08-23T10:00:00Z'))
  assert.throws(() => requestVisualRetry(item.db, retryPayload(task, attempt)), visualError('approved-cannot-retry'))
  item.db.close()
})

test('4: a waiting_visual_approval attempt with no decision cannot be retried', async () => {
  const item = fixture()
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  assert.throws(() => requestVisualRetry(item.db, retryPayload(task, attempt)), visualError('invalid-state'))
  item.db.close()
})

test('5: a historical (non-current) attempt cannot be retried', async () => {
  const item = fixture()
  const first = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, first, 'openai', 1)
  const task1 = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt1 = task1.attempts.find((a) => a.attemptNo === task1.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt1.id, decision: 'rejected', note: '历史意见' }, new Date('2026-08-23T10:00:00Z'))
  requestVisualRetry(item.db, retryPayload(task1, attempt1))
  // 领取后 attempt #1 成为历史（当前 attempt=2 且处于 generating）
  const second = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T11:00:00Z'))!
  assert.equal(second.task.id, task1.id)
  assert.equal(second.attempt.attemptNo, 2)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const current = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  // 把历史 attempt（#1）当 currentAttemptId 提交（新幂等键，视为全新请求）→ 409 not-current-attempt
  assert.throws(() => requestVisualRetry(item.db, retryPayload(task, { id: attempt1.id }, 'retry:' + task.id + ':' + attempt1.id + ':fresh')), visualError('not-current-attempt'))
  // 当前 attempt 处于 generating（非 rejected）→ 409 invalid-state
  assert.throws(() => requestVisualRetry(item.db, retryPayload(task, current)), visualError('invalid-state'))
  item.db.close()
})

test('6: maxAttempts reached blocks retry with 422', async () => {
  const item = fixture()
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'rejected', note: '再改一次' }, new Date('2026-08-23T10:00:00Z'))
  // 模拟已达上限（maxAttempts=1、currentAttempt=1）
  item.db.prepare('UPDATE visual_asset_tasks SET max_attempts=1 WHERE id=?').run(task.id)
  assert.throws(() => requestVisualRetry(item.db, retryPayload(task, attempt)), visualError('max-attempts-reached'))
  item.db.close()
})

test('7+8: same idempotency key replays; same key with different content conflicts', async () => {
  const f = fixture()
  const r = await rejectFirst(f.db, f.queued.batch.packageId)
  const key = 'retry:' + r.task.id + ':' + r.attempt.id
  const first = requestVisualRetry(r.db, retryPayload(r.task, r.attempt, key))
  assert.equal(first.idempotent, false)
  // 状态已变为 retry，重放仍返回相同结果
  const replay = requestVisualRetry(r.db, retryPayload(r.task, r.attempt, key))
  assert.equal(replay.idempotent, true)
  assert.equal(replay.requestId, first.requestId)
  assert.equal(replay.previousNote, r.note)
  // 相同 key 但补充要求不同 → 409
  assert.throws(() => requestVisualRetry(r.db, retryPayload(r.task, r.attempt, key, { supplementaryInstruction: '换个方向' })),
    visualError('idempotency-conflict'))
  r.db.close()
})

test('9+10+12: double-click creates a single retry; claim creates one new attempt and one new job (old job untouched)', async () => {
  const item = fixture()
  const before = item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind='visual.generate'").get() as { count: number }
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'rejected', note: '重做' }, new Date('2026-08-23T10:00:00Z'))
  const key = 'retry:' + task.id + ':' + attempt.id
  requestVisualRetry(item.db, retryPayload(task, attempt, key))
  requestVisualRetry(item.db, retryPayload(task, attempt, key))
  assert.equal(Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_retry_requests WHERE task_id=?').get(task.id)!.count), 1)
  const claimed = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T11:00:00Z'))!
  assert.equal(claimed.attempt.attemptNo, 2)
  const after = item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind='visual.generate'").get() as { count: number }
  assert.equal(Number(after.count) - Number(before.count), 2, '两次 attempt 各一个新 job（首次 + 重试）')
  const oldJob = item.db.prepare('SELECT status FROM workflow_jobs WHERE id=?').get(claim.attempt.jobId) as { status: string }
  assert.equal(oldJob.status, 'waiting_approval', '旧 job 不被复活')
  item.db.close()
})

test('11: old attempt, image, approval and events are all preserved', async () => {
  const item = fixture()
  const draftRows = item.db.prepare('SELECT relative_path FROM draft_artifacts WHERE package_id=?').all(item.queued.batch.packageId) as unknown as Array<{ relative_path: string }>
  const beforeArtifacts = artifactSnapshot(draftRows.map((row) => ({ relativePath: row.relative_path })))
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  const submitted = await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'rejected', note: '重做构图' }, new Date('2026-08-23T10:00:00Z'))
  const oldImage = imageSnapshot(submitted.relativePath)
  const oldApproval = item.db.prepare("SELECT decision, note FROM approvals WHERE subject_kind='visual_attempt' AND subject_id=?").get(attempt.id) as { decision: string; note: string }
  const oldEvents = Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_asset_events WHERE task_id=?').get(task.id)!.count)
  const oldAttempts = Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_asset_attempts WHERE task_id=?').get(task.id)!.count)
  requestVisualRetry(item.db, retryPayload(task, attempt))
  assert.deepEqual(imageSnapshot(submitted.relativePath), oldImage)
  assert.deepEqual(item.db.prepare("SELECT decision, note FROM approvals WHERE subject_kind='visual_attempt' AND subject_id=?").get(attempt.id), oldApproval)
  assert.equal(Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_asset_attempts WHERE task_id=?').get(task.id)!.count), oldAttempts)
  assert.ok(Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_asset_events WHERE task_id=?').get(task.id)!.count) > oldEvents, '重试事件已追加')
  const afterRows = item.db.prepare('SELECT relative_path FROM draft_artifacts WHERE package_id=?').all(item.queued.batch.packageId) as unknown as Array<{ relative_path: string }>
  const afterArtifacts = artifactSnapshot(afterRows.map((row) => ({ relativePath: row.relative_path })))
  assert.deepEqual(afterArtifacts, beforeArtifacts, '原 8 个产物 hash/mtime 不变')
  item.db.close()
})

test('13+14: authoritative prompt carries original prompt, reject note and supplementary; supplementary never overrides the note', async () => {
  const item = fixture()
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'rejected', note: '驳回意见A：主体放大' }, new Date('2026-08-23T10:00:00Z'))
  const result = requestVisualRetry(item.db, retryPayload(task, attempt, undefined, { supplementaryInstruction: '补充要求B：使用暖色调' }))
  // 补充要求不覆盖驳回意见：结果 previousNote 仍是驳回意见
  assert.equal(result.previousNote, '驳回意见A：主体放大')
  assert.equal(result.supplementaryInstruction, '补充要求B：使用暖色调')
  const claimed = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T11:00:00Z'))!
  assert.match(claimed.authoritativePrompt, new RegExp(escapeRe(task.prompt)))
  assert.match(claimed.authoritativePrompt, /驳回意见A：主体放大/)
  assert.match(claimed.authoritativePrompt, /补充要求B：使用暖色调/)
  const row = item.db.prepare('SELECT reject_note, supplementary_instruction FROM visual_retry_requests WHERE task_id=?').get(task.id) as { reject_note: string; supplementary_instruction: string | null }
  assert.equal(row.reject_note, '驳回意见A：主体放大')
  assert.equal(row.supplementary_instruction, '补充要求B：使用暖色调')
  item.db.close()
})

test('15: supplementary rejects local paths, URLs, attachment ids and provider keys', async () => {
  const item = fixture()
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'rejected', note: '重做' }, new Date('2026-08-23T10:00:00Z'))
  for (const bad of ['/Users/me/pic.png', 'C:\\tmp\\a.png', 'https://example.com/x.png', 'file:///tmp/x.png', 'sha256:' + 'a'.repeat(64), 'use attachmentId 123']) {
    assert.throws(() => requestVisualRetry(item.db, retryPayload(task, attempt, undefined, { supplementaryInstruction: bad })), visualError('supplementary-forbidden'), bad)
  }
  assert.throws(() => requestVisualRetry(item.db, retryPayload(task, attempt, undefined, { supplementaryInstruction: 'x'.repeat(501) })), visualError('supplementary-too-long'))
  item.db.close()
})

test('16+17+18+19: retry → claim → submit returns to waiting_visual_approval without auto-approval', async () => {
  const item = fixture()
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'rejected', note: '重做' }, new Date('2026-08-23T10:00:00Z'))
  requestVisualRetry(item.db, retryPayload(task, attempt))
  assert.equal(visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0].pipelineState, 'retry')
  const claimed = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T11:00:00Z'))!
  assert.equal(claimed.attempt.attemptNo, 2)
  assert.equal(claimed.attempt.status, 'generating')
  await submitClaim(item.db, claimed, 'openai', 2)
  const after = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  assert.equal(after.state, 'waiting_visual_approval')
  const approval = item.db.prepare("SELECT decision FROM approvals WHERE subject_kind='visual_attempt' AND subject_id=?").get(claimed.attempt.id) as { decision: string }
  assert.equal(approval.decision, 'pending', '提交后不自动批准')
  item.db.close()
})

test('20: read-only status never creates retry rows', async () => {
  const item = fixture()
  const before = Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_retry_requests').get()!.count)
  visualStatus(item.db, item.queued.batch.packageId)
  visualStatus(item.db)
  assert.equal(Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_retry_requests').get()!.count), before)
  item.db.close()
})

test('HTTP: controlled retry schema, status codes and legacy taskId path', async () => {
  const item = fixture({ dbPath: process.env.SPARKOS_DB_PATH! })
  const claim = claimVisualTask(item.db, { packageId: item.queued.batch.packageId }, new Date('2026-08-23T09:00:00Z'))!
  await submitClaim(item.db, claim, 'openai', 1)
  const task = visualStatus(item.db, item.queued.batch.packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
  item.db.close()

  // 400: 缺字段 / 非法补充字段
  assert.equal((await http('POST', '/sparkos/visual/retry', { packageId: task.packageId, taskId: task.id })).status, 400)
  // 409: 未驳回不可重试
  const pending = await http('POST', '/sparkos/visual/retry', retryHttp(task, attempt))
  assert.equal(pending.status, 409)
  assert.match(pending.body.toString('utf8'), /invalid-state/)

  // 驳回后 200
  const db = openFactoryDatabase()
  decideVisualAttempt(db, { attemptId: attempt.id, decision: 'rejected', note: '重做' }, new Date('2026-08-23T10:00:00Z'))
  db.close()
  const ok = await http('POST', '/sparkos/visual/retry', retryHttp(task, attempt))
  assert.equal(ok.status, 200)
  const parsed = JSON.parse(ok.body.toString('utf8')) as { value: { state: string; idempotent: boolean } }
  assert.equal(parsed.value.state, 'retry')
  assert.equal(parsed.value.idempotent, false)
  // 幂等重放 200
  const replay = await http('POST', '/sparkos/visual/retry', retryHttp(task, attempt))
  assert.equal(replay.status, 200)
  assert.equal((JSON.parse(replay.body.toString('utf8')) as { value: { idempotent: boolean } }).value.idempotent, true)
  // 同一 key 不同内容 409
  const conflict = await http('POST', '/sparkos/visual/retry', { ...retryHttp(task, attempt), supplementaryInstruction: '不同内容' })
  assert.equal(conflict.status, 409)
  assert.match(conflict.body.toString('utf8'), /idempotency-conflict/)
  // 422: 已在上一条里进入 retry 后再提交同一 attempt 会 invalid-state(409)；验证 legacy taskId 仍可用
  const db2 = openFactoryDatabase()
  const legacy = await http('POST', '/sparkos/visual/retry', { taskId: task.id })
  db2.close()
  assert.equal(legacy.status, 409, '任务已进入 retry 后 legacy taskId 不得再次重写状态')
  assert.match(legacy.body.toString('utf8'), /invalid-state/)
  const db3 = openFactoryDatabase()
  const rows = db3.prepare('SELECT COUNT(*) AS count FROM visual_retry_requests').get() as { count: number }
  assert.equal(Number(rows.count), 1)
  assert.equal(Number(db3.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE '%publish%'").get()!.count), 0)
  assert.equal(Number(db3.prepare('SELECT COUNT(*) AS count FROM visual_delivery_artifacts').get()!.count), 0)
  db3.close()
})

function retryHttp(task: { id: string; packageId: string; assetId: string; currentAttempt: number }, attempt: { id: string }) {
  return {
    packageId: task.packageId, taskId: task.id, currentAttemptId: attempt.id, assetId: task.assetId,
    idempotencyKey: 'retry:' + task.id + ':' + attempt.id,
  }
}

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
