/**
 * M6.5 阶段2 准备：从后端真实链路提取 authoritativePrompt（零额度、只读）。
 * 流程：临时 VAULT/DB → 草稿批准 → 视觉排队 → claim → 提交 → 人工驳回（意见+补充要求）
 * → requestVisualRetry → 再 claim → 打印 authoritativePrompt JSON 到 stdout。
 * 确认后把 prompt 字段喂给 image_generate（aspect=wechat_cover）即可完成真实链路验证。
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-phase2-'))
const vault = path.join(root, 'vault')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_DB_PATH = path.join(vault, 'data', 'sparkos.db')

const { openFactoryDatabase } = await import('../src/storage/database.ts')
const { generateDailyRanking } = await import('../src/intel/ranking.ts')
const { generateEditorialPlan, decideEditorialCard } = await import('../src/editorial/planner.ts')
const { ensureDraftRequest, submitDraftPackage, decideDraftPackage } = await import('../src/creation/drafts.ts')
const { claimVisualTask, queueVisualBatch, submitVisualAttachment } = await import('../src/visual/service.ts')
const { decideVisualAttempt, requestVisualRetry } = await import('../src/visual/review.ts')

function sha256(data) { return createHash("sha256").update(data).digest("hex") }

function png(width, height) {
  const data = Buffer.alloc(64)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data)
  data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20)
  return data
}

const db = openFactoryDatabase({ path: ':memory:' })
generateDailyRanking(db, [{ clusterId: 'c-p2', topicKey: 't-p2', date: '20260823', topic: 'P2', coreFacts: ['f'], heat: 'high', novelty: 'high', sourceCount: 1, evidenceUrls: ['https://e'], evidence: [{ url: 'https://e', sourceType: 'official', verified: true }], knowledgeCards: ['obs/1'], credibility: 'high', risks: [], platforms: ['wechat'], angleSuggestions: [], eventKeys: ['k1'], judgment: { confirmedFacts: [], inferences: [], editorialView: '', counterArguments: [], uncertainties: [] } }], '2026-08-23')
const plan = generateEditorialPlan(db, 'weekly', '2026-08-23')
const card = plan.cards[0]
decideEditorialCard(db, card.id, 'approved')
const draft = ensureDraftRequest(db, card.id).package
const para = 'p'.repeat(700)
const sub = submitDraftPackage(db, {
  packageId: draft.id, editorialAngle: 'a', keyMessage: 'k', factBoundary: 'fb',
  factClaims: [
    { text: 'f1', kind: 'fact', evidenceUrls: ['https://e'] },
    { text: 'f2', kind: 'fact', evidenceUrls: ['https://e'] },
    { text: 'f3', kind: 'inference', evidenceUrls: [] },
  ],
  variants: {
    wechat: { title: 't', dek: 'd', blocks: [{ type: 'heading', level: 2, text: 'h' }, { type: 'paragraph', text: para }, { type: 'image', assetId: 'cover-main', caption: 'c' }, { type: 'heading', level: 2, text: 'h2' }, { type: 'paragraph', text: para }, { type: 'paragraph', text: para }] },
    telegram: { title: 't', body: para },
    x: { posts: ['p'] },
    xiaohongshu: { title: 't', body: para, hashtags: ['a', 'b', 'c'] },
  },
  assets: [
    { id: 'cover-main', kind: 'cover', prompt: '公众号封面：温暖晨光下的城市街区，标题文字留白区', altText: '封面', aspectRatio: '2.35:1', placement: '微信封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
    { id: 'inline-one', kind: 'inline', prompt: '正文配图：数据流程图', altText: '流程图', aspectRatio: '16:9', placement: '微信正文', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
    { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图', altText: '首图', aspectRatio: '3:4', placement: '小红书第1张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
    { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播', altText: '轮播', aspectRatio: '3:4', placement: '小红书第2张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
  ],
}, new Date('2026-08-23T08:00:00Z'))
if (!sub.validation.ok) { console.error('validation failed: ' + sub.validation.errors.join('; ')); process.exit(1) }
const approved = decideDraftPackage(db, draft.id, 'approved', undefined, new Date('2026-08-23T08:01:00Z'))
const queued = queueVisualBatch(db, approved.id, new Date('2026-08-23T08:02:00Z'))
const pkg = queued.batch.packageId
const claim = claimVisualTask(db, { packageId: pkg }, new Date('2026-08-23T09:00:00Z'))
// 领取到的可能是任一资产槽位（按 asset_id 排序），用其真实尺寸构造图片
const claimW = claim.task.targetWidth
const claimH = claim.task.targetHeight
const ref = { attachmentId: 'sha256:' + sha256(png(claimW, claimH)), mediaType: 'image/png', bytes: 64, width: claimW, height: claimH }
const reader = { readImage: async () => ({ ref, data: png(claimW, claimH) }) }
await submitVisualAttachment(db, reader, { taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: ref, provider: 'openai', sourceTool: 'image_generate' }, { now: new Date('2026-08-23T09:01:00Z') })
const rejectNote = '构图需要重做：主体放大，去掉左下角杂物'
const supplementary = '使用暖色调，保留城市街区，标题留白区保持干净'
decideVisualAttempt(db, { attemptId: claim.attempt.id, decision: 'rejected', note: rejectNote }, new Date('2026-08-23T10:00:00Z'))
requestVisualRetry(db, { packageId: pkg, taskId: claim.task.id, currentAttemptId: claim.attempt.id, assetId: claim.task.assetId, idempotencyKey: 'retry:' + claim.task.id + ':' + claim.attempt.id, supplementaryInstruction: supplementary }, new Date('2026-08-23T10:01:00Z'))
const again = claimVisualTask(db, { packageId: pkg }, new Date('2026-08-23T11:00:00Z'))
console.log(JSON.stringify({
  taskId: again.task.id,
  assetId: again.task.assetId,
  aspectRatio: again.task.aspectRatio,
  targetWidth: again.task.targetWidth,
  targetHeight: again.task.targetHeight,
  imageStudioAspect: again.imageStudioAspect,
  provider: again.task.attempts && again.task.attempts[0] ? 'openai' : 'openai',
  prompt: again.authoritativePrompt,
}, null, 2))
db.close()
rmSync(root, { recursive: true, force: true })