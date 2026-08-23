/** M6.5 SparkOS V2 端到端闭环验收（隔离 fixture，零真实资源）：
 * 一条链路串起 草稿批准 → 视觉排队 → claim → 生成提交 → 人工驳回 →
 * 受控重试 → 再 claim（authoritativePrompt 含驳回意见/补充要求）→ 再生成 →
 * 批准全部 → 生产交付 → 发布就绪度，并在每个阶段断言不变量：
 * 原 8 产物 hash/mtime 不变、历史图片/attempt/approval/event 保留、
 * job 生命周期（旧 job 不被复活、新 job 每 attempt 一个）、幂等重放、
 * 无 publish job、交付仅经显式调用产生。 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DraftAssetPlan, DraftSubmission } from '../src/creation/drafts.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-e2e-'))
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
const { decideVisualAttempt, requestVisualRetry } = await import('../src/visual/review.ts')

const evidenceUrl = 'https://official.example/e2e'

const V2_ASSETS: DraftAssetPlan[] = [
  { id: 'cover-main', kind: 'cover', prompt: '封面提示词：温暖晨光下的城市街区', altText: '公众号封面', aspectRatio: '2.35:1', placement: '微信公众号封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
  { id: 'inline-one', kind: 'inline', prompt: '正文提示词：数据流程图', altText: '正文流程图', aspectRatio: '16:9', placement: '微信正文第一节后', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
  { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图提示词', altText: '小红书首图', aspectRatio: '3:4', placement: '小红书第1张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
  { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播提示词', altText: '小红书第二张', aspectRatio: '3:4', placement: '小红书第2张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
]

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function cluster(): IntelCluster {
  return {
    clusterId: 'c-20260823-e2e', topicKey: 't-e2e', date: '20260823', topic: 'M6.5 端到端验收',
    coreFacts: ['闭环可审计'], heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: [evidenceUrl], evidence: [{ url: evidenceUrl, sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://e2e'], credibility: 'high', risks: ['样本有限'], platforms: ['wechat', 'telegram', 'x', 'xiaohongshu'],
    angleSuggestions: ['从闭环切入'], eventKeys: ['e2e-1', 'e2e-2'],
    judgment: { confirmedFacts: ['闭环可审计'], inferences: ['可能提升效率'], editorialView: '闭环必须可审计。', counterArguments: ['流程有成本'], uncertainties: ['样本有限'] },
  }
}

function submission(packageId: string): DraftSubmission {
  const paragraph = '这是围绕已确认事实展开的完整正文，明确区分事实、推断和观点，并说明人工审核、受控重试、交付与发布准备之间的边界。'.repeat(6)
  const assets = V2_ASSETS.map((asset) => ({ ...asset, platforms: [...asset.platforms!] }))
  return {
    packageId, editorialAngle: '端到端闭环', keyMessage: '只有通过全链路人工闸门的可靠附件才能进入交付。',
    factBoundary: '功能实现属于事实；长期影响仍待观察。',
    factClaims: [
      { text: '闭环可审计', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '审核由人工执行', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '可能提升效率', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: { title: '为什么闭环要可审计', dek: '可靠附件只是起点。', blocks: [
        { type: 'heading', level: 2, text: '先说结论' }, { type: 'paragraph', text: paragraph },
        { type: 'image', assetId: 'inline-one', caption: '闭环流程图' },
        { type: 'heading', level: 2, text: '交付边界' }, { type: 'paragraph', text: paragraph }, { type: 'paragraph', text: paragraph },
      ] },
      telegram: { title: '端到端闭环', body: paragraph + paragraph },
      x: { posts: ['闭环需要可审计。'] },
      xiaohongshu: { title: '闭环避坑', body: paragraph + paragraph + ' asset://xhs-cover', hashtags: ['视觉生产', '内容创作', '审核'] },
    },
    assets,
  }
}

function fixture() {
  const db = openFactoryDatabase({ path: ':memory:' })
  generateDailyRanking(db, [cluster()], '2026-08-23')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-23')
  const card = plan.cards.find((item) => item.topicKey === 't-e2e') ?? plan.cards[0]
  decideEditorialCard(db, card.id, 'approved')
  const draft = ensureDraftRequest(db, card.id).package
  const submitted = submitDraftPackage(db, submission(draft.id), new Date('2026-08-23T08:00:00Z'))
  assert.equal(submitted.validation.ok, true, submitted.validation.errors.join('; '))
  const approved = decideDraftPackage(db, draft.id, 'approved', undefined, new Date('2026-08-23T08:01:00Z'))
  const queued = queueVisualBatch(db, approved.id, new Date('2026-08-23T08:02:00Z'))
  return { db, package: approved, queued }
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

function draftArtifactSnapshot(db: ReturnType<typeof openFactoryDatabase>, packageId: string): Record<string, { sha: string; mtime: string }> {
  const rows = db.prepare('SELECT relative_path FROM draft_artifacts WHERE package_id=?').all(packageId) as unknown as Array<{ relative_path: string }>
  return Object.fromEntries(rows.map((row) => {
    const file = path.join(vault, row.relative_path)
    return [row.relative_path, { sha: sha256(readFileSync(file)), mtime: String(statSync(file, { bigint: true }).mtimeNs) }]
  }))
}

function imageSnapshot(relativePath: string): { sha: string; mtime: string } {
  const file = path.join(vault, relativePath)
  return { sha: sha256(readFileSync(file)), mtime: String(statSync(file, { bigint: true }).mtimeNs) }
}

test('M6.5: full controlled loop — approve → queue → claim → generate → reject → retry → regenerate → approve → production delivery → readiness, with invariants', async () => {
  const item = fixture()
  const pkg = item.queued.batch.packageId
  const draftBefore = draftArtifactSnapshot(item.db, pkg)

  // 阶段 1：全部资产 claim → 生成（真实 provider 语义）→ 提交
  const submissions: Array<{ taskId: string; attemptId: string; relativePath: string }> = []
  let second = 1
  while (true) {
    const claim = claimVisualTask(item.db, { packageId: pkg }, new Date('2026-08-23T09:' + String(second).padStart(2, '0') + ':00Z'))
    if (!claim) break
    assert.equal(claim.authoritativePrompt.indexOf(claim.task.prompt) >= 0, true, '首 attempt 也携带原 prompt 与固定规格')
    const image = attachment(png(claim.task.targetWidth, claim.task.targetHeight), claim.task.targetWidth, claim.task.targetHeight)
    const result = await submitVisualAttachment(item.db, image.reader, {
      taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref,
      provider: 'openai', model: 'image-model', sourceTool: 'image_generate', promptEffective: claim.authoritativePrompt,
    }, { now: new Date('2026-08-23T09:' + String(second).padStart(2, '0') + ':10Z') })
    submissions.push({ taskId: claim.task.id, attemptId: claim.attempt.id, relativePath: result.relativePath })
    second += 1
  }
  assert.equal(submissions.length, 4, '四个资产槽位全部生成提交')

  // 阶段 2：人工驳回 cover-main，携带意见与补充要求创建受控重试
  const statusBefore = visualStatus(item.db, pkg).batches[0]
  const cover = statusBefore.tasks.find((task) => task.assetId === 'cover-main')!
  const coverAttempt = cover.attempts.find((attempt) => attempt.attemptNo === cover.currentAttempt)!
  const rejectNote = '构图需要重做：主体放大，去掉左下角杂物'
  const supplementary = '使用暖色调，保留城市街区'
  decideVisualAttempt(item.db, { attemptId: coverAttempt.id, decision: 'rejected', note: rejectNote }, new Date('2026-08-23T10:00:00Z'))
  const retry = requestVisualRetry(item.db, {
    packageId: pkg, taskId: cover.id, currentAttemptId: coverAttempt.id, assetId: cover.assetId,
    idempotencyKey: 'retry:' + cover.id + ':' + coverAttempt.id, supplementaryInstruction: supplementary,
  }, new Date('2026-08-23T10:01:00Z'))
  assert.equal(retry.previousNote, rejectNote)
  assert.equal(retry.supplementaryInstruction, supplementary)
  assert.equal(retry.state, 'retry')

  // 幂等重放：同键同内容返回相同结果，不产生第二个请求
  const replay = requestVisualRetry(item.db, {
    packageId: pkg, taskId: cover.id, currentAttemptId: coverAttempt.id, assetId: cover.assetId,
    idempotencyKey: 'retry:' + cover.id + ':' + coverAttempt.id, supplementaryInstruction: supplementary,
  })
  assert.equal(replay.idempotent, true)
  assert.equal(replay.requestId, retry.requestId)
  assert.equal(Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_retry_requests WHERE task_id=?').get(cover.id)!.count), 1)

  // 阶段 3：重新 claim cover-main → authoritativePrompt 必须包含 原 prompt + 驳回意见 + 补充要求 + 固定规格
  const coverImageBefore = imageSnapshot(submissions.find((s) => s.taskId === cover.id)!.relativePath)
  const claimedAgain = claimVisualTask(item.db, { packageId: pkg }, new Date('2026-08-23T11:00:00Z'))!
  assert.equal(claimedAgain.task.id, cover.id)
  assert.equal(claimedAgain.attempt.attemptNo, 2, '重试 attempt 编号单调递增')
  assert.match(claimedAgain.authoritativePrompt, new RegExp(escapeRe(cover.prompt)))
  assert.match(claimedAgain.authoritativePrompt, new RegExp(escapeRe(rejectNote)))
  assert.match(claimedAgain.authoritativePrompt, new RegExp(escapeRe(supplementary)))
  assert.match(claimedAgain.authoritativePrompt, /固定规格/)
  assert.match(claimedAgain.authoritativePrompt, /事实边界/)
  const image2 = attachment(png(claimedAgain.task.targetWidth, claimedAgain.task.targetHeight), claimedAgain.task.targetWidth, claimedAgain.task.targetHeight)
  const submittedAgain = await submitVisualAttachment(item.db, image2.reader, {
    taskId: claimedAgain.task.id, attemptId: claimedAgain.attempt.id, leaseToken: claimedAgain.leaseToken, attachment: image2.ref,
    provider: 'openai', model: 'image-model', sourceTool: 'image_generate', promptEffective: claimedAgain.authoritativePrompt,
  }, { now: new Date('2026-08-23T11:01:00Z') })
  assert.ok(submittedAgain.relativePath.length > 0)

  // 历史图片、attempt、approval、event 全部保留
  assert.deepEqual(imageSnapshot(submissions.find((s) => s.taskId === cover.id)!.relativePath), coverImageBefore, '旧图片 hash/mtime 不变')
  const history = item.db.prepare('SELECT attempt_no, status FROM visual_asset_attempts WHERE task_id=? ORDER BY attempt_no').all(cover.id) as Array<{ attempt_no: number; status: string }>
  assert.deepEqual(history.map((row) => [row.attempt_no, row.status]), [[1, 'waiting_visual_approval'], [2, 'waiting_visual_approval']])
  const approval = item.db.prepare("SELECT decision, note FROM approvals WHERE subject_kind='visual_attempt' AND subject_id=?").get(coverAttempt.id) as { decision: string; note: string }
  assert.equal(approval.decision, 'rejected'); assert.equal(approval.note, rejectNote)
  assert.ok(Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_asset_events WHERE task_id=?').get(cover.id)!.count) >= 6, '事件历史保留并追加重试事件')

  // 阶段 4：批准全部资产
  let minute = 20
  const afterRetry = visualStatus(item.db, pkg).batches[0]
  for (const task of afterRetry.tasks) {
    const attempt = task.attempts.find((item2) => item2.attemptNo === task.currentAttempt)!
    assert.equal(attempt.status, 'waiting_visual_approval')
    decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'approved' }, new Date('2026-08-23T12:' + String(minute).padStart(2, '0') + ':00Z'))
    minute += 1
  }
  const approvedStatus = visualStatus(item.db, pkg).batches[0]
  assert.equal(approvedStatus.status, 'visual_approved')
  assert.equal(approvedStatus.readiness.visualApproved, true)
  assert.equal(approvedStatus.readiness.testOnly, false)

  // 阶段 5：生产交付 → 发布就绪，无 publish job
  const beforeJobs = Number(item.db.prepare('SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE ?').get('%publish%')!.count)
  const delivery = createVisualDelivery(item.db, { packageId: pkg, mode: 'production' }, new Date('2026-08-23T13:00:00Z'))
  assert.equal(delivery.created, true)
  assert.equal(delivery.delivery.manifest.testOnly, false)
  assert.equal(delivery.delivery.manifest.readyForPublication, true)
  const readiness = visualStatus(item.db, pkg).batches[0].readiness
  assert.deepEqual(readiness.readyByPlatform, { wechat: true, telegram: true, x: true, xiaohongshu: true })
  assert.equal(readiness.readyForPublication, true)
  assert.equal(Number(item.db.prepare('SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE ?').get('%publish%')!.count), beforeJobs, '不产生 publish job')
  assert.equal(Number(item.db.prepare('SELECT COUNT(*) AS count FROM visual_delivery_artifacts WHERE package_id=?').get(pkg)!.count) > 0, true, '交付产物仅经显式调用产生')

  // 不变量：原 8 产物 hash/mtime 不变
  assert.deepEqual(draftArtifactSnapshot(item.db, pkg), draftBefore, '原 8 个产物 hash/mtime 不变')

  // job 生命周期：5 个 attempt（4 首轮 + 1 重试）各一个新 visual.generate job，且全部为终态
  const jobs = item.db.prepare("SELECT status FROM workflow_jobs WHERE kind='visual.generate' ORDER BY created_at").all() as Array<{ status: string }>
  assert.equal(jobs.length, 5, '每 attempt 一个新 job')
  for (const job of jobs) assert.ok(['succeeded', 'waiting_approval', 'failed'].includes(job.status), 'job 终态：' + job.status)
  item.db.close()
})

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('M6.5: stub 全链对照 —— 全批准后 testOnly 交付被生产闸门拦截，preview 可生成', async () => {
  const item = fixture()
  const pkg = item.queued.batch.packageId
  let second = 1
  while (true) {
    const claim = claimVisualTask(item.db, { packageId: pkg }, new Date('2026-08-23T09:' + String(second).padStart(2, '0') + ':00Z'))
    if (!claim) break
    const image = attachment(png(claim.task.targetWidth, claim.task.targetHeight), claim.task.targetWidth, claim.task.targetHeight)
    await submitVisualAttachment(item.db, image.reader, {
      taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref,
      provider: 'stub', model: 'stub-v1', sourceTool: 'image_generate',
    }, { now: new Date('2026-08-23T09:' + String(second).padStart(2, '0') + ':10Z') })
    second += 1
  }
  let minute = 20
  const status = visualStatus(item.db, pkg).batches[0]
  for (const task of status.tasks) {
    const attempt = task.attempts.find((item2) => item2.attemptNo === task.currentAttempt)!
    decideVisualAttempt(item.db, { attemptId: attempt.id, decision: 'approved' }, new Date('2026-08-23T10:' + String(minute).padStart(2, '0') + ':00Z'))
    minute += 1
  }
  const after = visualStatus(item.db, pkg).batches[0]
  assert.equal(after.status, 'visual_approved_test')
  assert.throws(() => createVisualDelivery(item.db, { packageId: pkg, mode: 'production' }), (error) => error instanceof VisualPipelineError && error.code === 'production-gate')
  const preview = createVisualDelivery(item.db, { packageId: pkg, mode: 'preview' }, new Date('2026-08-23T11:00:00Z'))
  assert.equal(preview.created, true)
  assert.equal(preview.delivery.manifest.testOnly, true)
  assert.equal(preview.delivery.manifest.readyForPublication, false)
  assert.equal(Number(item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE '%publish%'").get()!.count), 0)
  item.db.close()
})
