import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DraftAssetPlan, DraftSubmission } from '../src/creation/drafts.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-visual-'))
const vault = path.join(root, 'vault')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_DB_PATH = path.join(vault, 'data', 'sparkos.db')
after(() => rmSync(root, { recursive: true, force: true }))

const { databaseHealth, openFactoryDatabase } = await import('../src/storage/database.ts')
const { generateDailyRanking } = await import('../src/intel/ranking.ts')
const { generateEditorialPlan, decideEditorialCard } = await import('../src/editorial/planner.ts')
const { ensureDraftRequest, submitDraftPackage, decideDraftPackage, reviseDraftRequest } = await import('../src/creation/drafts.ts')
const {
  claimVisualTask,
  failVisualTask,
  heartbeatVisualTask,
  queueVisualBatch,
  recoverExpiredVisualTasks,
  submitVisualAttachment,
  visualStatus,
  VisualPipelineError,
} = await import('../src/visual/service.ts')
const { buildFactorySnapshot } = await import('../src/factory/service.ts')
const { handleSparkosHttp } = await import('../src/server/routes.ts')
const { registerVisualTools } = await import('../src/tools/visual.ts')

const evidenceUrl = 'https://official.example/visual'
let fixtureNo = 0

const DEFAULT_ASSETS: DraftAssetPlan[] = [
  { id: 'cover-main', kind: 'cover', prompt: '可靠内容工厂的编辑工作台，无文字', altText: '内容工厂封面', aspectRatio: '2.35:1', placement: '微信公众号封面' },
  { id: 'inline-flow', kind: 'inline', prompt: '从证据到审核的流程图，无小字', altText: '内容流程图', aspectRatio: '16:9', placement: '微信正文第一节后' },
  { id: 'carousel-proof', kind: 'carousel', prompt: '事实、推断、观点三层卡片', altText: '事实边界卡片', aspectRatio: '3:4', placement: '小红书第二张' },
  { id: 'square-detail', kind: 'carousel', prompt: '安全附件回交流程方形图', altText: '附件回交流程', aspectRatio: '1:1', placement: '小红书第三张' },
]

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function cluster(suffix: string): IntelCluster {
  return {
    clusterId: `c-20260823-${suffix.padStart(3, '0')}`,
    topicKey: `t-visual-${suffix}`,
    date: '20260823',
    topic: `视觉任务可靠附件测试 ${suffix}`,
    coreFacts: ['产品已发布', '附件服务已有正式接口'],
    heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: [evidenceUrl], evidence: [{ url: evidenceUrl, sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://visual'], credibility: 'high', risks: ['样本仍然有限'],
    platforms: ['wechat', 'telegram', 'x', 'xiaohongshu'], angleSuggestions: ['从可靠回交切入'],
    eventKeys: [`event-${suffix}-1`, `event-${suffix}-2`, `event-${suffix}-3`],
    judgment: {
      confirmedFacts: ['产品已发布'], inferences: ['可能改善内容流程'],
      editorialView: '视觉生成必须保留人工审核和不可变证据链。',
      counterArguments: ['自动化也会增加状态管理成本'], uncertainties: ['样本仍然有限'],
    },
  }
}

function submission(packageId: string, assets = DEFAULT_ASSETS): DraftSubmission {
  const paragraph = '这是围绕已确认事实展开的完整分析段落，明确区分事实、推断和观点，并解释可靠附件、任务租约、不可变文件与人工审核如何共同保护内容生产。'.repeat(5)
  return {
    packageId,
    editorialAngle: '从视觉附件可靠回交切入',
    keyMessage: '生成只是中间态，验证和人工审核才构成交付。',
    factBoundary: '正式接口属于已确认事实；长期影响仍是推断，样本仍然有限。',
    factClaims: [
      { text: '产品已发布', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '附件服务已有正式接口', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '可能改善内容流程', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: {
        title: '视觉生产为什么需要可靠回交', dek: '从生成到人工审核，每一步都必须可以验证。',
        blocks: [
          { type: 'heading', level: 2, text: '先说结论' },
          { type: 'paragraph', text: paragraph },
          { type: 'image', assetId: 'inline-flow', caption: '可靠视觉流程' },
          { type: 'heading', level: 2, text: '边界与恢复' },
          { type: 'paragraph', text: paragraph },
          { type: 'paragraph', text: '样本仍然有限。' + paragraph },
        ],
      },
      telegram: { title: '视觉任务可靠回交', body: paragraph + paragraph },
      x: { posts: ['1/3 图片生成不是终点。', '2/3 附件必须重读校验。', '3/3 未经人工视觉审核不得发布。'] },
      xiaohongshu: { title: '视觉回交避坑指南', body: paragraph + paragraph, hashtags: ['视觉生产', '内容创作', '工作流'] },
    },
    assets: assets.map((asset) => ({ ...asset })),
  }
}

function approvedFixture(options: { approve?: boolean; assets?: DraftAssetPlan[]; dbPath?: string } = {}) {
  fixtureNo += 1
  const db = openFactoryDatabase({ path: options.dbPath ?? ':memory:' })
  generateDailyRanking(db, [cluster(String(fixtureNo))], '2026-08-23')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-23')
  const card = plan.cards.find((item) => item.topicKey === `t-visual-${fixtureNo}`) ?? plan.cards[0]
  decideEditorialCard(db, card.id, 'approved')
  const draft = ensureDraftRequest(db, card.id).package
  const submitted = submitDraftPackage(db, submission(draft.id, options.assets), new Date('2026-08-23T08:00:00Z'))
  assert.equal(submitted.validation.ok, true)
  const value = options.approve === false ? submitted.package : decideDraftPackage(db, draft.id, 'approved', '内容审核通过', new Date('2026-08-23T08:01:00Z'))
  return { db, package: value }
}

function artifactFingerprint(artifacts: Array<{ relativePath: string }>): Record<string, { sha256: string; bytes: number; mtimeNs: string }> {
  return Object.fromEntries(artifacts.map((artifact) => {
    const file = path.join(vault, artifact.relativePath)
    const stat = statSync(file, { bigint: true })
    const content = readFileSync(file)
    return [artifact.relativePath, { sha256: sha256(content), bytes: content.byteLength, mtimeNs: String(stat.mtimeNs) }]
  }))
}

function rasterBytes(width: number, height: number, mediaType: string = 'image/png', size = 64): Buffer {
  const data = Buffer.alloc(size)
  if (mediaType === 'image/png') {
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data)
    data.writeUInt32BE(width, 16)
    data.writeUInt32BE(height, 20)
  } else if (mediaType === 'image/jpeg') {
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(data)
  } else if (mediaType === 'image/webp') {
    data.write('RIFF', 0, 'ascii'); data.write('WEBP', 8, 'ascii')
  } else if (mediaType === 'image/gif') {
    data.write('GIF89a', 0, 'ascii')
  } else if (mediaType === 'image/svg+xml') {
    data.write('<svg xmlns="http://www.w3.org/2000/svg">', 0, 'utf8')
  }
  return data
}

function attachment(data: Buffer, mediaType: string, width: number, height: number, name = 'generated.png') {
  const ref = {
    attachmentId: `sha256:${sha256(data)}`,
    mediaType,
    bytes: data.byteLength,
    width,
    height,
    name,
  }
  const reader = {
    async readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
      return { ref: ref as unknown as ImageAttachmentRef, data }
    },
  }
  return { ref, reader }
}

function expectVisualCode(error: unknown, code: string): boolean {
  return error instanceof VisualPipelineError && error.code === code
}

test('schema v3 to v4 migration is additive, idempotent, and preserves v1/v2 states', () => {
  const file = path.join(root, 'legacy-v3.db')
  const legacy = new DatabaseSync(file)
  legacy.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
    INSERT INTO schema_migrations VALUES (1, '2026-08-22T00:00:00Z'), (2, '2026-08-22T00:00:00Z'), (3, '2026-08-22T00:00:00Z');
    CREATE TABLE workflow_jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL) STRICT;
    CREATE TABLE draft_packages(id TEXT PRIMARY KEY, status TEXT NOT NULL) STRICT;
    INSERT INTO draft_packages VALUES ('dp-1111111111111111', 'rejected'), ('dp-2222222222222222', 'approved');
  `)
  legacy.close()
  for (let pass = 0; pass < 2; pass += 1) {
    const db = openFactoryDatabase({ path: file })
    assert.equal(databaseHealth(db, file).schemaVersion, 4)
    assert.deepEqual((db.prepare('SELECT id, status FROM draft_packages ORDER BY id').all() as Array<{ id: string; status: string }>).map((row) => ({ ...row })), [
      { id: 'dp-1111111111111111', status: 'rejected' },
      { id: 'dp-2222222222222222', status: 'approved' },
    ])
    assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=4').get() as { count: number }).count), 1)
    for (const table of ['visual_batches', 'visual_asset_tasks', 'visual_asset_attempts', 'visual_asset_events']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
    }
    db.close()
  }
})

test('queue rejects unapproved drafts, freezes approved assets, maps all dimensions, and is idempotent', () => {
  const pending = approvedFixture({ approve: false })
  assert.throws(() => queueVisualBatch(pending.db, pending.package.id), (error) => expectVisualCode(error, 'package-not-approved'))
  pending.db.close()

  const { db, package: draftPackage } = approvedFixture()
  const before = artifactFingerprint(draftPackage.artifacts)
  const first = queueVisualBatch(db, draftPackage.id, new Date('2026-08-23T09:00:00Z'))
  const again = queueVisualBatch(db, draftPackage.id, new Date('2026-08-23T09:01:00Z'))
  assert.equal(first.created, true)
  assert.equal(again.created, false)
  assert.equal(first.batch.id, again.batch.id)
  assert.equal(first.tasks.length, DEFAULT_ASSETS.length)
  assert.deepEqual(Object.fromEntries(first.tasks.map((task) => [task.aspectRatio, [task.targetWidth, task.targetHeight]])), {
    '2.35:1': [900, 383], '16:9': [1280, 720], '3:4': [1080, 1440], '1:1': [1080, 1080],
  })
  assert.match(first.batch.sourceAssetsSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(artifactFingerprint(draftPackage.artifacts), before)
  db.close()
})

test('queue detects disk or manifest hash tampering before creating tasks', () => {
  const { db, package: draftPackage } = approvedFixture()
  const assetsFile = path.join(vault, draftPackage.artifacts.find((item) => item.relativePath.endsWith('/assets.json'))!.relativePath)
  writeFileSync(assetsFile, readFileSync(assetsFile, 'utf8') + ' ')
  assert.throws(() => queueVisualBatch(db, draftPackage.id), (error) => expectVisualCode(error, 'artifact-integrity-failed'))
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM visual_batches').get() as { count: number }).count), 0)
  db.close()
})

test('claim is exclusive, stores only lease hash, creates a visual.generate job, and heartbeat authenticates', () => {
  const dbFile = path.join(root, `claim-${fixtureNo + 1}.db`)
  const fixture = approvedFixture({ dbPath: dbFile })
  const queued = queueVisualBatch(fixture.db, fixture.package.id, new Date('2026-08-23T10:00:00Z'))
  const keep = queued.tasks[0].id
  fixture.db.prepare("UPDATE visual_asset_tasks SET state='failed' WHERE id<>?").run(keep)
  fixture.db.close()
  const firstDb = openFactoryDatabase({ path: dbFile })
  const secondDb = openFactoryDatabase({ path: dbFile })
  const claim = claimVisualTask(firstDb, { packageId: fixture.package.id, leaseSeconds: 60 }, new Date('2026-08-23T10:01:00Z'))!
  assert.equal(claimVisualTask(secondDb, { packageId: fixture.package.id }, new Date('2026-08-23T10:01:00Z')), null)
  const stored = firstDb.prepare('SELECT lease_token_hash FROM visual_asset_tasks WHERE id=?').get(claim.task.id) as { lease_token_hash: string }
  assert.notEqual(stored.lease_token_hash, claim.leaseToken)
  assert.equal(stored.lease_token_hash, sha256(claim.leaseToken))
  assert.equal((firstDb.prepare('SELECT kind FROM workflow_jobs WHERE id=?').get(claim.attempt.jobId) as { kind: string }).kind, 'visual.generate')
  assert.throws(() => heartbeatVisualTask(firstDb, claim.task.id, claim.attempt.id, '0'.repeat(64), new Date('2026-08-23T10:01:20Z')), (error) => expectVisualCode(error, 'lease-invalid'))
  const heartbeat = heartbeatVisualTask(firstDb, claim.task.id, claim.attempt.id, claim.leaseToken, new Date('2026-08-23T10:01:20Z'), 120)
  assert.equal(heartbeat.leaseExpiresAt, '2026-08-23T10:03:20.000Z')
  firstDb.close(); secondDb.close()
})

test('expired leases retry monotonically and maxAttempts produces a durable failed history', () => {
  const { db, package: draftPackage } = approvedFixture()
  const queued = queueVisualBatch(db, draftPackage.id, new Date('2026-08-23T11:00:00Z'))
  const keep = queued.tasks[0].id
  db.prepare("UPDATE visual_asset_tasks SET state='failed' WHERE id<>?").run(keep)
  const first = claimVisualTask(db, { packageId: draftPackage.id, leaseSeconds: 60 }, new Date('2026-08-23T11:01:00Z'))!
  assert.deepEqual(recoverExpiredVisualTasks(db, new Date('2026-08-23T11:02:00Z')), { retried: 1, failed: 0 })
  db.prepare('UPDATE visual_asset_tasks SET max_attempts=2 WHERE id=?').run(first.task.id)
  const second = claimVisualTask(db, { packageId: draftPackage.id, leaseSeconds: 60 }, new Date('2026-08-23T11:02:01Z'))!
  assert.equal(second.attempt.attemptNo, 2)
  assert.equal(second.previousNote, '[lease-expired] worker lease expired')
  assert.deepEqual(recoverExpiredVisualTasks(db, new Date('2026-08-23T11:03:01Z')), { retried: 0, failed: 1 })
  assert.equal((db.prepare('SELECT state FROM visual_asset_tasks WHERE id=?').get(first.task.id) as { state: string }).state, 'failed')
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM visual_asset_attempts WHERE task_id=?').get(first.task.id) as { count: number }).count), 2)
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM visual_asset_events WHERE task_id=?').get(first.task.id) as { count: number }).count), 5)
  db.close()
})

test('explicit fail preserves attempts and obeys retryable/maxAttempts', () => {
  const { db, package: draftPackage } = approvedFixture()
  const queued = queueVisualBatch(db, draftPackage.id)
  db.prepare("UPDATE visual_asset_tasks SET state='failed' WHERE id<>?").run(queued.tasks[0].id)
  const first = claimVisualTask(db, { packageId: draftPackage.id }, new Date('2026-08-23T12:00:00Z'))!
  assert.equal(failVisualTask(db, { taskId: first.task.id, attemptId: first.attempt.id, leaseToken: first.leaseToken, code: 'provider-timeout', message: 'provider timed out', retryable: true }, new Date('2026-08-23T12:00:10Z')).state, 'retry')
  const second = claimVisualTask(db, { packageId: draftPackage.id }, new Date('2026-08-23T12:00:11Z'))!
  assert.equal(failVisualTask(db, { taskId: second.task.id, attemptId: second.attempt.id, leaseToken: second.leaseToken, code: 'content-filter', message: 'blocked', retryable: false }, new Date('2026-08-23T12:00:20Z')).state, 'failed')
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM visual_asset_attempts WHERE task_id=?').get(first.task.id) as { count: number }).count), 2)
  db.close()
})

test('official attachment round-trip is immutable, auditable, idempotent, and stops at visual approval', async () => {
  const { db, package: draftPackage } = approvedFixture()
  const originals = artifactFingerprint(draftPackage.artifacts)
  queueVisualBatch(db, draftPackage.id, new Date('2026-08-23T13:00:00Z'))
  const claim = claimVisualTask(db, { packageId: draftPackage.id }, new Date('2026-08-23T13:01:00Z'))!
  const data = rasterBytes(claim.task.targetWidth, claim.task.targetHeight)
  const image = attachment(data, 'image/png', claim.task.targetWidth, claim.task.targetHeight)
  const input = {
    taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken,
    attachment: image.ref, provider: 'test-provider', model: 'test-model', sourceTool: 'image_generate',
    sourceCallId: 'call-001', promptEffective: claim.task.prompt, seedRequested: 7, seedEffective: true,
    generatedAt: '2026-08-23T13:01:10Z',
  }
  const result = await submitVisualAttachment(db, image.reader, input, { now: new Date('2026-08-23T13:01:20Z') })
  assert.equal(result.state, 'waiting_visual_approval')
  assert.match(result.relativePath, new RegExp(`^visual/factory/\\d{4}-\\d{2}-\\d{2}/${draftPackage.id}/${claim.task.assetId}/attempt-001/[a-f0-9]{16}\\.png$`))
  assert.equal(readFileSync(path.join(vault, result.relativePath)).compare(data), 0)
  assert.deepEqual(await submitVisualAttachment(db, undefined, { ...input, leaseToken: '0'.repeat(64) }), result, 'same attachment is idempotent even after lease closes')
  const different = attachment(Buffer.concat([data, Buffer.from([1])]), 'image/png', claim.task.targetWidth, claim.task.targetHeight)
  await assert.rejects(() => submitVisualAttachment(db, different.reader, { ...input, attachment: different.ref }), (error) => expectVisualCode(error, 'submission-conflict'))
  const attempt = db.prepare('SELECT provider, model, source_tool, imported_sha256, status FROM visual_asset_attempts WHERE id=?').get(claim.attempt.id) as Record<string, unknown>
  assert.deepEqual({ ...attempt }, { provider: 'test-provider', model: 'test-model', source_tool: 'image_generate', imported_sha256: sha256(data), status: 'waiting_visual_approval' })
  assert.deepEqual((db.prepare('SELECT to_state FROM visual_asset_events WHERE task_id=? ORDER BY id').all(claim.task.id) as Array<{ to_state: string }>).map((row) => row.to_state), ['queued', 'generating', 'generated', 'waiting_visual_approval'])
  assert.equal(visualStatus(db, draftPackage.id).batches[0].readiness.readyForPublication, false)
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM workflow_jobs WHERE kind LIKE '%publish%'").get() as { count: number }).count), 0)
  assert.deepEqual(artifactFingerprint(draftPackage.artifacts), originals)
  db.close()
})

test('submit rejects paths/URLs/base64 and explicitly degrades without attachments service', async () => {
  const { db, package: draftPackage } = approvedFixture()
  queueVisualBatch(db, draftPackage.id)
  const claim = claimVisualTask(db, { packageId: draftPackage.id }, new Date('2026-08-23T14:00:00Z'))!
  const data = rasterBytes(claim.task.targetWidth, claim.task.targetHeight)
  const image = attachment(data, 'image/png', claim.task.targetWidth, claim.task.targetHeight)
  const base = { taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref, sourceTool: 'image_generate' }
  for (const forbidden of ['path', 'url', 'base64']) {
    await assert.rejects(() => submitVisualAttachment(db, image.reader, { ...base, attachment: { ...image.ref, [forbidden]: 'forbidden' } }), (error) => expectVisualCode(error, 'bad-request'))
  }
  await assert.rejects(() => submitVisualAttachment(db, undefined, base, { now: new Date('2026-08-23T14:00:10Z') }), (error) => expectVisualCode(error, 'attachment-service-unavailable'))
  assert.equal((db.prepare('SELECT state FROM visual_asset_tasks WHERE id=?').get(claim.task.id) as { state: string }).state, 'generating')
  db.close()
})

test('immutable storage refuses a symlinked system-derived asset directory', async () => {
  const { db, package: draftPackage } = approvedFixture()
  queueVisualBatch(db, draftPackage.id)
  const claim = claimVisualTask(db, { packageId: draftPackage.id }, new Date('2026-08-23T14:30:00Z'))!
  const outside = path.join(root, `outside-${claim.task.id}`)
  const packageDir = path.join(vault, 'visual', 'factory', claim.task.createdAt.slice(0, 10), draftPackage.id)
  mkdirSync(outside, { recursive: true })
  mkdirSync(packageDir, { recursive: true })
  symlinkSync(outside, path.join(packageDir, claim.task.assetId), 'dir')
  const data = rasterBytes(claim.task.targetWidth, claim.task.targetHeight)
  const image = attachment(data, 'image/png', claim.task.targetWidth, claim.task.targetHeight)
  await assert.rejects(
    () => submitVisualAttachment(db, image.reader, { taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref, sourceTool: 'image_generate' }, { now: new Date('2026-08-23T14:30:10Z') }),
    (error) => expectVisualCode(error, 'unsafe-path'),
  )
  assert.equal(existsSync(path.join(outside, `${sha256(data).slice(0, 16)}.png`)), false)
  db.close()
})

test('submit rejects mismatched metadata, corrupt or forged media, GIF/SVG, oversize, and wrong dimensions', async () => {
  const cases: Array<{ name: string; expected: string; make(claim: NonNullable<ReturnType<typeof claimVisualTask>>): { input: ReturnType<typeof attachment>['ref']; stored: ReturnType<typeof attachment> } }> = [
    { name: 'metadata', expected: 'attachment-metadata-mismatch', make: (claim) => { const stored = attachment(rasterBytes(claim.task.targetWidth, claim.task.targetHeight), 'image/png', claim.task.targetWidth, claim.task.targetHeight); return { stored, input: { ...stored.ref, bytes: stored.ref.bytes + 1 } } } },
    { name: 'corrupt', expected: 'attachment-invalid', make: (claim) => { const stored = attachment(Buffer.from('not-an-image'), 'image/png', claim.task.targetWidth, claim.task.targetHeight); return { stored, input: stored.ref } } },
    { name: 'forged-mime', expected: 'attachment-invalid', make: (claim) => { const stored = attachment(rasterBytes(claim.task.targetWidth, claim.task.targetHeight), 'image/jpeg', claim.task.targetWidth, claim.task.targetHeight); return { stored, input: stored.ref } } },
    { name: 'gif', expected: 'unsupported-image', make: (claim) => { const stored = attachment(rasterBytes(claim.task.targetWidth, claim.task.targetHeight, 'image/gif'), 'image/gif', claim.task.targetWidth, claim.task.targetHeight); return { stored, input: stored.ref } } },
    { name: 'svg', expected: 'unsupported-image', make: (claim) => { const stored = attachment(rasterBytes(claim.task.targetWidth, claim.task.targetHeight, 'image/svg+xml'), 'image/svg+xml', claim.task.targetWidth, claim.task.targetHeight); return { stored, input: stored.ref } } },
    { name: 'oversize', expected: 'image-too-large', make: (claim) => { const stored = attachment(rasterBytes(claim.task.targetWidth, claim.task.targetHeight, 'image/png', 5 * 1024 * 1024 + 1), 'image/png', claim.task.targetWidth, claim.task.targetHeight); return { stored, input: stored.ref } } },
    { name: 'dimensions', expected: 'dimension-mismatch', make: (claim) => { const stored = attachment(rasterBytes(claim.task.targetWidth + 1, claim.task.targetHeight), 'image/png', claim.task.targetWidth + 1, claim.task.targetHeight); return { stored, input: stored.ref } } },
  ]
  for (const item of cases) {
    const fixture = approvedFixture()
    queueVisualBatch(fixture.db, fixture.package.id)
    const claim = claimVisualTask(fixture.db, { packageId: fixture.package.id }, new Date('2026-08-23T15:00:00Z'))!
    const sample = item.make(claim)
    await assert.rejects(
      () => submitVisualAttachment(fixture.db, sample.stored.reader, { taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: sample.input, sourceTool: 'image_generate' }, { now: new Date('2026-08-23T15:00:10Z') }),
      (error) => expectVisualCode(error, item.expected), item.name,
    )
    fixture.db.close()
  }
})

test('rejected v1 cannot queue while approved v2 remains isolated and retry writes attempt-002', async () => {
  fixtureNo += 1
  const db = openFactoryDatabase({ path: ':memory:' })
  generateDailyRanking(db, [cluster(String(fixtureNo))], '2026-08-23')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-23')
  const card = plan.cards.find((item) => item.topicKey === `t-visual-${fixtureNo}`) ?? plan.cards[0]
  decideEditorialCard(db, card.id, 'approved')
  const v1 = ensureDraftRequest(db, card.id).package
  submitDraftPackage(db, submission(v1.id), new Date('2026-08-23T16:00:00Z'))
  decideDraftPackage(db, v1.id, 'rejected', '请调整视觉叙事', new Date('2026-08-23T16:01:00Z'))
  const v2 = reviseDraftRequest(db, v1.id).package
  submitDraftPackage(db, submission(v2.id), new Date('2026-08-23T16:02:00Z'))
  decideDraftPackage(db, v2.id, 'approved', undefined, new Date('2026-08-23T16:03:00Z'))
  assert.throws(() => queueVisualBatch(db, v1.id), (error) => expectVisualCode(error, 'package-not-approved'))
  const queued = queueVisualBatch(db, v2.id)
  db.prepare("UPDATE visual_asset_tasks SET state='failed' WHERE id<>?").run(queued.tasks[0].id)
  const first = claimVisualTask(db, { packageId: v2.id }, new Date('2026-08-23T16:04:00Z'))!
  failVisualTask(db, { taskId: first.task.id, attemptId: first.attempt.id, leaseToken: first.leaseToken, code: 'retry-me', message: 'try again', retryable: true }, new Date('2026-08-23T16:04:10Z'))
  const second = claimVisualTask(db, { packageId: v2.id }, new Date('2026-08-23T16:04:11Z'))!
  const data = rasterBytes(second.task.targetWidth, second.task.targetHeight)
  const image = attachment(data, 'image/png', second.task.targetWidth, second.task.targetHeight)
  const result = await submitVisualAttachment(db, image.reader, { taskId: second.task.id, attemptId: second.attempt.id, leaseToken: second.leaseToken, attachment: image.ref, sourceTool: 'image_generate' }, { now: new Date('2026-08-23T16:04:20Z') })
  assert.match(result.relativePath, new RegExp(`/${v2.id}/`))
  assert.doesNotMatch(result.relativePath, new RegExp(`/${v1.id}/`))
  assert.match(result.relativePath, /attempt-002/)
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS count FROM visual_asset_attempts WHERE task_id=?').get(second.task.id) as { count: number }).count), 2)
  db.close()
})

interface MockResponse {
  status: number
  headers: Record<string, string>
  body: Buffer
}

async function http(method: string, url: string, body?: unknown): Promise<MockResponse> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload) as unknown as IncomingMessage
  Object.assign(req, { method, url })
  const result: MockResponse = { status: 0, headers: {}, body: Buffer.alloc(0) }
  const res = {
    writeHead(status: number, headers: Record<string, string>) { result.status = status; result.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])) },
    end(chunk?: string | Buffer) { result.body = chunk === undefined ? Buffer.alloc(0) : Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk) },
  } as unknown as ServerResponse
  await handleSparkosHttp(req, res)
  return result
}

test('HTTP queue/status/asset and factory snapshot expose controlled visual state and safe preview headers', async () => {
  const fixture = approvedFixture({ dbPath: process.env.SPARKOS_DB_PATH })
  fixture.db.close()
  const queuedResponse = await http('POST', '/sparkos/visual/queue', { packageId: fixture.package.id })
  assert.equal(queuedResponse.status, 201)
  assert.equal((await http('POST', '/sparkos/visual/queue', { packageId: fixture.package.id, path: '/tmp/forbidden' })).status, 400)
  const db = openFactoryDatabase()
  const claim = claimVisualTask(db, { packageId: fixture.package.id }, new Date('2026-08-23T17:00:00Z'))!
  const data = rasterBytes(claim.task.targetWidth, claim.task.targetHeight)
  const image = attachment(data, 'image/png', claim.task.targetWidth, claim.task.targetHeight)
  await submitVisualAttachment(db, image.reader, { taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref, sourceTool: 'image_generate' }, { now: new Date('2026-08-23T17:00:10Z') })
  db.close()

  const status = await http('GET', `/sparkos/visual/status?packageId=${fixture.package.id}`)
  assert.equal(status.status, 200)
  assert.equal(JSON.parse(status.body.toString('utf8')).value.batches[0].packageId, fixture.package.id)
  const preview = await http('GET', `/sparkos/visual/asset?attemptId=${claim.attempt.id}`)
  assert.equal(preview.status, 200)
  assert.equal(preview.headers['content-type'], 'image/png')
  assert.equal(preview.headers['content-length'], String(data.byteLength))
  assert.equal(preview.headers['x-content-type-options'], 'nosniff')
  assert.equal(preview.headers['cross-origin-resource-policy'], 'same-origin')
  assert.equal(preview.body.compare(data), 0)
  assert.equal((await http('GET', '/sparkos/visual/asset?attemptId=../../etc/passwd')).status, 404)
  assert.equal((await http('GET', `/sparkos/visual/asset?attemptId=${claim.attempt.id}&path=/tmp/forbidden`)).status, 400)
  assert.equal(buildFactorySnapshot().visual.batches[0].packageId, fixture.package.id)
})

test('all six visual tools register even when attachments service is absent', () => {
  const definitions: Array<{ name: string; description: string }> = []
  registerVisualTools({ tools: { register(definition: { name: string; description: string }) { definitions.push(definition) } } } as unknown as Context)
  assert.deepEqual(definitions.map((item) => item.name), [
    'sparkos_visual_queue', 'sparkos_visual_claim', 'sparkos_visual_heartbeat',
    'sparkos_visual_fail', 'sparkos_visual_submit', 'sparkos_visual_status',
  ])
  assert.match(definitions.find((item) => item.name === 'sparkos_visual_submit')!.description, /images\[0\].*完整 attachment ref/)
})
