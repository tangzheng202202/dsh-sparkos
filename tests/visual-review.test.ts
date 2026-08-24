import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DraftAssetPlan, DraftSubmission } from '../src/creation/drafts.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-m5b-'))
const vault = path.join(root, 'vault')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_DB_PATH = path.join(vault, 'data', 'sparkos.db')
after(() => rmSync(root, { recursive: true, force: true }))

const { databaseHealth, openFactoryDatabase } = await import('../src/storage/database.ts')
const { generateDailyRanking } = await import('../src/intel/ranking.ts')
const { generateEditorialPlan, decideEditorialCard } = await import('../src/editorial/planner.ts')
const { ensureDraftRequest, submitDraftPackage, decideDraftPackage, validateDraftSubmission } = await import('../src/creation/drafts.ts')
const { claimVisualTask, failVisualTask, queueVisualBatch, submitVisualAttachment, visualStatus, VisualPipelineError } = await import('../src/visual/service.ts')
const { decideVisualAttempt, retryVisualTask } = await import('../src/visual/review.ts')
const { createVisualDelivery, readVisualDeliveryFile, readVisualDeliveryZip } = await import('../src/visual/delivery.ts')
const { deterministicZip } = await import('../src/visual/zip.ts')
const { handleSparkosHttp } = await import('../src/server/routes.ts')

const evidenceUrl = 'https://official.example/m5b'
let fixtureNo = 0

const V2_ASSETS: DraftAssetPlan[] = [
  { id: 'cover-main', kind: 'cover', prompt: '封面提示词', altText: '公众号封面', aspectRatio: '2.35:1', placement: '微信公众号封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
  { id: 'inline-one', kind: 'inline', prompt: '正文提示词', altText: '正文流程图', aspectRatio: '16:9', placement: '微信正文第一节后', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
  { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图', altText: '小红书首图', aspectRatio: '3:4', placement: '小红书第1张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
  { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播', altText: '小红书第二张', aspectRatio: '3:4', placement: '小红书第2张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
]

const LEGACY_ASSETS: DraftAssetPlan[] = [
  { id: 'cover-main', kind: 'cover', prompt: '封面提示词', altText: '公众号封面', aspectRatio: '2.35:1', placement: '微信公众号封面' },
  { id: 'inline-one', kind: 'inline', prompt: '正文提示词', altText: '正文流程图', aspectRatio: '16:9', placement: '微信正文第一节后' },
  { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播', altText: '小红书第二张', aspectRatio: '3:4', placement: '小红书第2张' },
]

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function cluster(suffix: string): IntelCluster {
  return {
    clusterId: `c-20260823-m5b-${suffix}`, topicKey: `t-m5b-${suffix}`, date: '20260823', topic: `M5B 视觉审核 ${suffix}`,
    coreFacts: ['功能已实现', '审核由人工执行'], heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: [evidenceUrl], evidence: [{ url: evidenceUrl, sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://m5b'], credibility: 'high', risks: ['样本仍然有限'], platforms: ['wechat', 'telegram', 'x', 'xiaohongshu'],
    angleSuggestions: ['从可靠审核切入'], eventKeys: [`${suffix}-1`, `${suffix}-2`, `${suffix}-3`],
    judgment: { confirmedFacts: ['功能已实现'], inferences: ['可能提升可靠性'], editorialView: '视觉审核必须可追溯。', counterArguments: ['流程会增加成本'], uncertainties: ['样本仍然有限'] },
  }
}

function submission(packageId: string, assets: DraftAssetPlan[], malicious = false): DraftSubmission {
  const paragraph = '这是围绕已确认事实展开的完整正文，明确区分事实、推断和观点，并说明视觉生成、人工审核、派生交付与发布准备之间的边界。'.repeat(6)
  const copy = assets.map((asset) => ({ ...asset, platforms: asset.platforms ? [...asset.platforms] : undefined }))
  if (malicious) {
    copy.find((asset) => asset.id === 'inline-one')!.altText = '"><script>altAttack()</script>'
    copy.find((asset) => asset.id === 'inline-one')!.prompt = '<img src=x onerror=promptAttack()>'
  }
  return {
    packageId, editorialAngle: '视觉审核与交付', keyMessage: '只有经过人工视觉审核的可靠附件才能进入交付。',
    factBoundary: '功能实现属于事实；长期影响仍待观察，样本仍然有限。',
    factClaims: [
      { text: '功能已实现', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '审核由人工执行', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '可能提升可靠性', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: { title: '视觉审核为什么不能省略', dek: '可靠附件只是起点，人工决定和交付闸门同样重要。', blocks: [
        { type: 'heading', level: 2, text: '先说结论' }, { type: 'paragraph', text: paragraph },
        { type: 'image', assetId: 'inline-one', caption: malicious ? '</figcaption><script>captionAttack()</script>' : '审核流程图' },
        { type: 'heading', level: 2, text: '交付边界' }, { type: 'paragraph', text: paragraph }, { type: 'paragraph', text: paragraph },
      ] },
      telegram: { title: '视觉审核与交付', body: paragraph + paragraph },
      x: { posts: ['可靠视觉需要附件校验、人工审核和发布闸门。'] },
      xiaohongshu: { title: '视觉审核避坑', body: paragraph + paragraph + (assets.some((asset) => asset.id === 'xhs-cover') ? ' asset://xhs-cover' : ''), hashtags: ['视觉生产', '内容创作', '审核'] },
    },
    assets: copy,
  }
}

function fixture(options: { legacy?: boolean; dbPath?: string; malicious?: boolean } = {}) {
  fixtureNo += 1
  const db = openFactoryDatabase({ path: options.dbPath ?? ':memory:' })
  const suffix = String(fixtureNo).padStart(3, '0')
  generateDailyRanking(db, [cluster(suffix)], '2026-08-23')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-23')
  const card = plan.cards.find((item) => item.topicKey === `t-m5b-${suffix}`) ?? plan.cards[0]
  decideEditorialCard(db, card.id, 'approved')
  const draft = ensureDraftRequest(db, card.id).package
  if (options.legacy) db.prepare('UPDATE draft_packages SET contract_version=1 WHERE id=?').run(draft.id)
  const submitted = submitDraftPackage(db, submission(draft.id, options.legacy ? LEGACY_ASSETS : V2_ASSETS, options.malicious), new Date('2026-08-23T08:00:00Z'))
  assert.equal(submitted.validation.ok, true, submitted.validation.errors.join('; '))
  const approved = decideDraftPackage(db, draft.id, 'approved', undefined, new Date('2026-08-23T08:01:00Z'))
  const queued = queueVisualBatch(db, approved.id, new Date('2026-08-23T08:02:00Z'))
  return { db, card, package: approved, queued }
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

async function submitClaim(db: ReturnType<typeof openFactoryDatabase>, claim: NonNullable<ReturnType<typeof claimVisualTask>>, provider: string, second: number) {
  const image = attachment(png(claim.task.targetWidth, claim.task.targetHeight), claim.task.targetWidth, claim.task.targetHeight)
  return submitVisualAttachment(db, image.reader, {
    taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref,
    provider, model: provider === 'stub' ? 'stub-v1' : 'image-model', sourceTool: 'image_generate', promptEffective: claim.task.prompt,
  }, { now: new Date(`2026-08-23T09:${String(second).padStart(2, '0')}:00Z`) })
}

async function generateAll(db: ReturnType<typeof openFactoryDatabase>, packageId: string, provider: string) {
  let second = 1
  while (true) {
    const claim = claimVisualTask(db, { packageId }, new Date(`2026-08-23T09:${String(second).padStart(2, '0')}:00Z`))
    if (!claim) break
    await submitClaim(db, claim, provider, second)
    second += 1
  }
}

function approveAll(db: ReturnType<typeof openFactoryDatabase>, packageId: string): void {
  const batch = visualStatus(db, packageId).batches[0]
  let minute = 20
  for (const task of batch.tasks) {
    const attempt = task.attempts.find((item) => item.attemptNo === task.currentAttempt)!
    decideVisualAttempt(db, { attemptId: attempt.id, decision: 'approved' }, new Date(`2026-08-23T10:${minute}:00Z`))
    minute += 1
  }
}

function artifactSnapshot(artifacts: Array<{ relativePath: string }>): Record<string, { sha: string; mtime: string }> {
  return Object.fromEntries(artifacts.map((artifact) => {
    const file = path.join(vault, artifact.relativePath)
    return [artifact.relativePath, { sha: sha256(readFileSync(file)), mtime: String(statSync(file, { bigint: true }).mtimeNs) }]
  }))
}

function visualError(code: string): (error: unknown) => boolean {
  return (error) => error instanceof VisualPipelineError && error.code === code
}

test('schema v4 to v6 is additive and idempotent without changing five existing attempts', async () => {
  const file = path.join(root, 'migration-v4.db')
  const item = fixture({ dbPath: file })
  const first = claimVisualTask(item.db, { packageId: item.package.id }, new Date('2026-08-23T11:00:00Z'))!
  failVisualTask(item.db, { taskId: first.task.id, attemptId: first.attempt.id, leaseToken: first.leaseToken, code: 'one', message: 'retry one', retryable: true }, new Date('2026-08-23T11:00:10Z'))
  const second = claimVisualTask(item.db, { packageId: item.package.id }, new Date('2026-08-23T11:01:00Z'))!
  failVisualTask(item.db, { taskId: second.task.id, attemptId: second.attempt.id, leaseToken: second.leaseToken, code: 'two', message: 'retry two', retryable: true }, new Date('2026-08-23T11:01:10Z'))
  const third = claimVisualTask(item.db, { packageId: item.package.id }, new Date('2026-08-23T11:02:00Z'))!; await submitClaim(item.db, third, 'stub', 2)
  for (let index = 0; index < 2; index += 1) { const claim = claimVisualTask(item.db, { packageId: item.package.id }, new Date(`2026-08-23T11:0${3 + index}:00Z`))!; await submitClaim(item.db, claim, 'stub', 3 + index) }
  const before = item.db.prepare('SELECT id, task_id, attempt_no, status, imported_sha256 FROM visual_asset_attempts ORDER BY id').all()
  assert.equal(before.length, 5)
  item.db.close()
  const raw = new DatabaseSync(file)
  raw.exec('DROP TABLE visual_delivery_artifacts; DROP TABLE visual_retry_requests; DELETE FROM schema_migrations WHERE version IN (5, 6);')
  raw.close()
  for (let pass = 0; pass < 2; pass += 1) {
    const migrated = openFactoryDatabase({ path: file })
    assert.equal(databaseHealth(migrated, file).schemaVersion, 7)
    assert.deepEqual(migrated.prepare('SELECT id, task_id, attempt_no, status, imported_sha256 FROM visual_asset_attempts ORDER BY id').all(), before)
    assert.equal(Number((migrated.prepare('SELECT COUNT(*) AS count FROM visual_delivery_artifacts').get() as { count: number }).count), 0)
    assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='visual_retry_requests'").get(), 'v6 visual_retry_requests 表已创建')
    migrated.close()
  }
})

test('only the current waiting attempt can be reviewed; decisions are validated, idempotent and conflict-safe', async () => {
  const item = fixture()
  const first = claimVisualTask(item.db, { packageId: item.package.id }, new Date('2026-08-23T12:00:00Z'))!
  failVisualTask(item.db, { taskId: first.task.id, attemptId: first.attempt.id, leaseToken: first.leaseToken, code: 'retry', message: 'first failed', retryable: true }, new Date('2026-08-23T12:00:10Z'))
  const second = claimVisualTask(item.db, { packageId: item.package.id }, new Date('2026-08-23T12:01:00Z'))!
  const submitted = await submitClaim(item.db, second, 'openai', 1)
  assert.throws(() => decideVisualAttempt(item.db, { attemptId: first.attempt.id, decision: 'approved' }), visualError('not-current-attempt'))
  assert.throws(() => decideVisualAttempt(item.db, { attemptId: second.attempt.id, decision: 'rejected', note: '  ' }), visualError('review-note-required'))
  const note = '<img src=x onerror=reviewAttack()> 请调整构图'
  const rejected = decideVisualAttempt(item.db, { attemptId: second.attempt.id, decision: 'rejected', note })
  assert.equal(rejected.taskState, 'rejected')
  assert.equal(decideVisualAttempt(item.db, { attemptId: second.attempt.id, decision: 'rejected', note: '不会覆盖' }).idempotent, true)
  assert.throws(() => decideVisualAttempt(item.db, { attemptId: second.attempt.id, decision: 'approved' }), visualError('decision-conflict'))
  const oldFile = path.join(vault, submitted.relativePath)
  const old = { sha: sha256(readFileSync(oldFile)), mtime: String(statSync(oldFile, { bigint: true }).mtimeNs) }
  const retry = retryVisualTask(item.db, second.task.id)
  assert.equal(retry.previousNote, note)
  // 统一重试：legacy 路径同样创建 visual_retry_requests 审计记录
  const audit = item.db.prepare('SELECT purpose, idempotency_key FROM visual_retry_requests WHERE task_id=?').get(second.task.id) as { purpose: string; idempotency_key: string }
  assert.equal(audit.purpose, 'reject_rerun')
  assert.equal(audit.idempotency_key, 'auto:' + second.task.id + ':' + second.attempt.id)
  const third = claimVisualTask(item.db, { packageId: item.package.id }, new Date('2026-08-23T12:02:00Z'))!
  assert.equal(third.attempt.attemptNo, 3)
  assert.equal(third.previousNote, note)
  assert.deepEqual({ sha: sha256(readFileSync(oldFile)), mtime: String(statSync(oldFile, { bigint: true }).mtimeNs) }, old)
  assert.equal((item.db.prepare("SELECT decision FROM approvals WHERE subject_kind='visual_attempt' AND subject_id=?").get(second.attempt.id) as { decision: string }).decision, 'rejected')
  item.db.close()
})

test('all approved stub images stay test-only; preview is derived, immutable and idempotent while production is blocked', async () => {
  const item = fixture({ malicious: true })
  const originals = artifactSnapshot(item.package.artifacts)
  await generateAll(item.db, item.package.id, 'stub')
  approveAll(item.db, item.package.id)
  const status = visualStatus(item.db, item.package.id).batches[0]
  assert.equal(status.status, 'visual_approved_test')
  assert.equal(status.approvedCount, status.requiredCount)
  assert.equal(status.readiness.visualApproved, true)
  assert.equal(status.readiness.testOnly, true)
  assert.equal(status.readiness.readyForPublication, false)
  assert.throws(() => createVisualDelivery(item.db, { packageId: item.package.id, mode: 'production' }), visualError('production-gate'))
  const first = createVisualDelivery(item.db, { packageId: item.package.id, mode: 'preview' }, new Date('2026-08-23T13:00:00Z'))
  const again = createVisualDelivery(item.db, { packageId: item.package.id, mode: 'preview' }, new Date('2026-08-24T13:00:00Z'))
  assert.equal(first.created, true)
  assert.equal(again.created, false)
  assert.equal(again.delivery.id, first.delivery.id)
  assert.equal(again.artifacts.find((artifact) => artifact.format === 'zip')?.sha256, first.artifacts.find((artifact) => artifact.format === 'zip')?.sha256)
  assert.equal(first.delivery.manifest.testOnly, true)
  assert.equal(first.delivery.manifest.readyForPublication, false)
  const html = readVisualDeliveryFile(item.db, first.delivery.id, 'wechat-visual.html').content.toString('utf8')
  assert.match(html, /TEST ONLY/)
  assert.match(html, /src="assets\/inline-one\.png"/)
  assert.doesNotMatch(html, /<script|onerror=/)
  assert.match(html, /&lt;\/figcaption&gt;&lt;script&gt;captionAttack\(\)&lt;\/script&gt;/)
  assert.deepEqual(artifactSnapshot(item.package.artifacts), originals, '原8个产物 hash/mtime 不变')
  assert.equal(Number((item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE '%publish%'").get() as { count: number }).count), 0)
  item.db.close()
})

test('real-provider production delivery unlocks platform readiness without any publish job', async () => {
  const item = fixture()
  await generateAll(item.db, item.package.id, 'openai')
  approveAll(item.db, item.package.id)
  const created = createVisualDelivery(item.db, { packageId: item.package.id, mode: 'production' }, new Date('2026-08-23T14:00:00Z'))
  assert.equal(created.delivery.manifest.testOnly, false)
  assert.equal(created.delivery.manifest.readyForPublication, true)
  const status = visualStatus(item.db, item.package.id).batches[0].readiness
  assert.deepEqual(status.readyByPlatform, { wechat: true, telegram: true, x: true, xiaohongshu: true })
  assert.equal(status.readyForPublication, true)
  assert.equal(Number((item.db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE '%publish%'").get() as { count: number }).count), 0)
  item.db.close()
})

test('legacy xiaohongshu preview preserves declared slot numbers and cannot claim production completeness', async () => {
  const item = fixture({ legacy: true })
  await generateAll(item.db, item.package.id, 'stub')
  approveAll(item.db, item.package.id)
  const preview = createVisualDelivery(item.db, { packageId: item.package.id, mode: 'preview' }, new Date('2026-08-23T15:00:00Z'))
  const manifest = JSON.parse(readVisualDeliveryFile(item.db, preview.delivery.id, 'xiaohongshu/manifest.json').content.toString('utf8')) as { legacyContract: boolean; missingSlots: number[]; completeForProduction: boolean }
  const assets = JSON.parse(readVisualDeliveryFile(item.db, preview.delivery.id, 'xiaohongshu/assets.json').content.toString('utf8')) as Array<{ file: string; order: number }>
  assert.equal(manifest.legacyContract, true)
  assert.deepEqual(manifest.missingSlots, [1])
  assert.equal(manifest.completeForProduction, false)
  assert.deepEqual(assets.map((asset) => [asset.order, asset.file]), [[2, '02-carousel-one.png']])
  assert.throws(() => createVisualDelivery(item.db, { packageId: item.package.id, mode: 'production' }), visualError('production-gate'))
  assert.match(visualStatus(item.db, item.package.id).batches[0].readiness.blockers.join(' '), /legacy-contract-v1/)
  item.db.close()
})

test('contract v2 enforces unique slots, required roles, role ratios and declared asset references', () => {
  const item = fixture()
  const valid = submission(item.package.id, V2_ASSETS)
  assert.equal(validateDraftSubmission(valid, item.card, 2).ok, true)
  const duplicate = structuredClone(valid)
  duplicate.assets[1].order = 1
  duplicate.assets[2].aspectRatio = '16:9'
  duplicate.assets = duplicate.assets.filter((asset) => asset.role !== 'xhs-carousel')
  duplicate.variants.xiaohongshu.body += ' asset://unknown-three'
  const errors = validateDraftSubmission(duplicate, item.card, 2).errors.join('\n')
  assert.match(errors, /平台\/order 重复/)
  assert.match(errors, /比例与 role 不匹配/)
  assert.match(errors, /xhs-carousel/)
  assert.match(errors, /未知 assetId/)
  item.db.close()
})

test('unknown asset and URL/path-like asset references are rejected before delivery rendering', async () => {
  const item = fixture()
  await generateAll(item.db, item.package.id, 'stub')
  approveAll(item.db, item.package.id)
  const artifact = item.db.prepare("SELECT relative_path FROM draft_artifacts WHERE package_id=? AND relative_path LIKE '%/package.json'").get(item.package.id) as { relative_path: string }
  const absolute = path.join(vault, artifact.relative_path)
  const forged = JSON.parse(readFileSync(absolute, 'utf8')) as DraftSubmission
  ;(forged.variants.wechat.blocks[2] as { assetId: string }).assetId = 'https://evil.example/x.png'
  const data = Buffer.from(JSON.stringify(forged, null, 2) + '\n')
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(absolute, data))
  item.db.prepare("UPDATE draft_artifacts SET sha256=?, bytes=? WHERE package_id=? AND relative_path LIKE '%/package.json'").run(sha256(data), data.byteLength, item.package.id)
  assert.throws(() => createVisualDelivery(item.db, { packageId: item.package.id, mode: 'preview' }), visualError('asset-injection'))
  item.db.close()
})

function zipNames(data: Buffer): string[] {
  const names: string[] = []
  let offset = 0
  while (data.readUInt32LE(offset) === 0x04034b50) {
    const size = data.readUInt32LE(offset + 18); const nameLength = data.readUInt16LE(offset + 26); const extraLength = data.readUInt16LE(offset + 28)
    names.push(data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'))
    assert.equal(data.readUInt16LE(offset + 10), 0); assert.equal(data.readUInt16LE(offset + 12), 0x21)
    offset += 30 + nameLength + extraLength + size
  }
  return names
}

test('deterministic ZIP has safe sorted entries and stable SHA', async () => {
  const directA = deterministicZip([{ path: 'b/file.txt', data: Buffer.from('b') }, { path: 'a.txt', data: Buffer.from('a') }])
  const directB = deterministicZip([{ path: 'a.txt', data: Buffer.from('a') }, { path: 'b/file.txt', data: Buffer.from('b') }])
  assert.equal(sha256(directA), sha256(directB))
  assert.deepEqual(zipNames(directA), ['a.txt', 'b/file.txt'])
  assert.throws(() => deterministicZip([{ path: '../escape', data: Buffer.alloc(0) }]), /不安全/)
  assert.throws(() => deterministicZip([{ path: '.DS_Store', data: Buffer.alloc(0) }]), /不安全/)
  const item = fixture(); await generateAll(item.db, item.package.id, 'stub'); approveAll(item.db, item.package.id)
  const delivery = createVisualDelivery(item.db, { packageId: item.package.id, mode: 'preview' })
  const zip = readVisualDeliveryZip(item.db, delivery.delivery.id).content
  const names = zipNames(zip)
  assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right, 'en')))
  assert.ok(names.every((name) => !name.startsWith('/') && !name.split('/').includes('..') && !name.includes('.DS_Store') && !name.includes('/._')))
  item.db.close()
})

test('delivery output refuses a symlinked allowed-directory ancestor', async () => {
  const item = fixture(); await generateAll(item.db, item.package.id, 'stub'); approveAll(item.db, item.package.id)
  const outside = path.join(root, 'delivery-outside'); mkdirSync(outside)
  const dateRoot = path.join(vault, 'deliveries', 'factory', '2026-09-01'); mkdirSync(dateRoot, { recursive: true })
  symlinkSync(outside, path.join(dateRoot, item.package.id), 'dir')
  assert.throws(() => createVisualDelivery(item.db, { packageId: item.package.id, mode: 'preview' }, new Date('2026-09-01T10:00:00Z')), visualError('unsafe-path'))
  assert.deepEqual(await (await import('node:fs/promises')).readdir(outside), [])
  item.db.close()
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

test('HTTP review/delivery endpoints persist state and page source contains escaped M5B controls without auto-publish', async () => {
  const item = fixture({ dbPath: process.env.SPARKOS_DB_PATH })
  await generateAll(item.db, item.package.id, 'stub')
  const status = visualStatus(item.db, item.package.id).batches[0]
  const first = status.tasks[0].attempts.at(-1)!
  item.db.close()
  assert.equal((await http('POST', '/sparkos/visual/decision', { attemptId: first.id, decision: 'rejected' })).status, 400)
  assert.equal((await http('POST', '/sparkos/visual/decision', { attemptId: first.id, decision: 'rejected', note: '<script>reviewXss()</script>' })).status, 200)
  const retry = await http('POST', '/sparkos/visual/retry', { taskId: status.tasks[0].id })
  assert.equal(retry.status, 409, 'stub 测试图不得经 legacy 路径重试（统一资格门）')
  assert.match(retry.body.toString('utf8'), /stub-cannot-retry/)
  const db = openFactoryDatabase()
  const stored = db.prepare("SELECT decision, note FROM approvals WHERE subject_kind='visual_attempt' AND subject_id=?").get(first.id) as { decision: string; note: string }
  assert.equal(stored.decision, 'rejected'); assert.equal(stored.note, '<script>reviewXss()</script>')
  const page = await http('GET', '/sparkos/app')
  assert.equal(page.status, 200)
  const html = page.body.toString('utf8')
  assert.match(html, /批准图片/); assert.match(html, /驳回图片/); assert.match(html, /按意见重试/); assert.match(html, /测试图片，不可发布/)
  assert.match(html, /esc\(t\.reviewNote\)/); assert.doesNotMatch(html, /<script>reviewXss\(\)<\/script>/)
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE '%publish%'").get() as { count: number }).count), 0)
  db.close()
})

test('HTTP delivery list, safe file read and ZIP download expose only derived artifacts', async () => {
  const item = fixture({ dbPath: process.env.SPARKOS_DB_PATH })
  await generateAll(item.db, item.package.id, 'openai')
  approveAll(item.db, item.package.id)
  item.db.close()
  const created = await http('POST', '/sparkos/visual/delivery', { packageId: item.package.id, mode: 'production' })
  assert.equal(created.status, 201)
  const body = JSON.parse(created.body.toString('utf8')) as { value: { delivery: { id: string } } }
  const deliveryId = body.value.delivery.id
  const list = await http('GET', `/sparkos/visual/deliveries?packageId=${item.package.id}`)
  assert.equal(list.status, 200)
  assert.equal((JSON.parse(list.body.toString('utf8')) as { value: Array<{ id: string }> }).value[0].id, deliveryId)
  const html = await http('GET', `/sparkos/visual/delivery?deliveryId=${deliveryId}&file=wechat-visual.html`)
  assert.equal(html.status, 200); assert.equal(html.headers['x-content-type-options'], 'nosniff'); assert.match(html.body.toString('utf8'), /assets\/inline-one\.png/)
  assert.equal((await http('GET', `/sparkos/visual/delivery?deliveryId=${deliveryId}&file=../package.json`)).status, 400)
  const zip = await http('GET', `/sparkos/visual/download?deliveryId=${deliveryId}`)
  assert.equal(zip.status, 200); assert.equal(zip.headers['content-type'], 'application/zip'); assert.match(zip.headers['content-disposition'], /visual-delivery-v\d{3}\.zip/)
})
