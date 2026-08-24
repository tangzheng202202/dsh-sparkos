/**
 * 工作流语义收口回归测试：
 * 一、全局 dryRun：8 个 action 全部零写入（文件集合/内容 SHA/mtime/SQLite 均不变）。
 * 二、并发声明：写动作不得声明并发安全；写路径事务级序列化；条件 UPDATE 无虚假 event。
 * 三、统一视觉 retry：legacy/agent 工具/受控 HTTP 同一状态机；replace_stub_with_production 正式路径。
 * 四、发布台账：publication_intents 不可被 claimNextJob 领取；无平台 API 调用。
 * 全程隔离 fixture（tmp VAULT + tmp/in-memory SQLite）；不触碰生产草稿、视觉任务、
 * approval、delivery 或图片；不调用 image_generate（附件走内存 stub reader）。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DraftAssetPlan, DraftSubmission } from '../src/creation/drafts.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-sem-'))
const vault = path.join(root, 'vault')
const briefDir = path.join(root, 'daily_brief')
mkdirSync(path.join(briefDir, 'drafts'), { recursive: true })
writeFileSync(path.join(briefDir, 'daily_data_2026-08-24.json'), JSON.stringify({ date: '2026-08-24', must_reads: [] }))
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_CONTENTOS_ROOT = root
process.env.SPARKOS_DAILY_BRIEF_DIR = briefDir
process.env.SPARKOS_DB_PATH = path.join(vault, 'data', 'sparkos.db')
after(() => rmSync(root, { recursive: true, force: true }))

const { openFactoryDatabase } = await import('../src/storage/database.ts')
const { generateDailyRanking } = await import('../src/intel/ranking.ts')
const { generateEditorialPlan, decideEditorialCard } = await import('../src/editorial/planner.ts')
const { ensureDraftRequest, submitDraftPackage, decideDraftPackage } = await import('../src/creation/drafts.ts')
const { claimVisualTask, queueVisualBatch, submitVisualAttachment, visualStatus, VisualPipelineError } = await import('../src/visual/service.ts')
const { createVisualDelivery } = await import('../src/visual/delivery.ts')
const { decideVisualAttempt, requestVisualRetry, retryVisualTask, createPublishTask } = await import('../src/visual/review.ts')
const { claimNextJob, createJob } = await import('../src/storage/jobs.ts')
const { runSparkosCommand, isWriteInvocation, registerRunTool, SUBCOMMANDS } = await import('../src/tools/run.ts')

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/* ===================== 一、全局 dryRun ===================== */

interface FileStamp { sha: string; mtime: string }

function snapshotTree(dir: string): Map<string, FileStamp> {
  const out = new Map<string, FileStamp>()
  const walk = (current: string): void => {
    if (!existsSync(current)) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const st = statSync(full, { bigint: true })
        out.set(full, { sha: sha256(readFileSync(full)), mtime: String(st.mtimeNs) })
      }
    }
  }
  walk(dir)
  return out
}

function assertTreeUnchanged(before: Map<string, FileStamp>, label: string): void {
  const after = snapshotTree(root)
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), label + ' 文件集合不得变化')
  for (const [file, stamp] of before) {
    const now = after.get(file)!
    assert.equal(now.sha, stamp.sha, label + ' 内容不得变化：' + file)
    assert.equal(now.mtime, stamp.mtime, label + ' mtime 不得变化：' + file)
  }
  for (const suffix of ['', '-wal', '-shm']) {
    assert.equal(existsSync(process.env.SPARKOS_DB_PATH! + suffix), false, label + ' 不得创建 SQLite 文件' + suffix)
  }
}

test('一、dryRun 对全部 8 个 action 零写入（分派先于 initVault/SQLite/任何写函数）', async () => {
  const daily = {
    date: '2026-08-24',
    must_reads: [{ event_id: 'sem-dry-1', title: '语义收口', fresh_hours: 4, primary_line: 'L01' }],
    drafts: [], suggestions: [], distill_candidates: [],
  }
  const clusterDraft = {
    clusterId: 'c-20260824-001', date: '20260824', topic: '语义收口测试', eventKeys: ['sem-dry-1'],
    heat: 'medium', novelty: 'medium', credibility: 'medium', sourceCount: 1,
    evidenceUrls: ['https://example.com/a'],
  }
  const invocations: Array<[string, Record<string, unknown>]> = [
    ['brief', {}],
    ['brief', { daily, commit: true }],
    ['topics', {}],
    ['topics', { editorial: 'midweek' }],
    ['draft', {}],
    ['draft', { pending: true }],
    ['draft', { request: 'dp-1111111111111111' }],
    ['draft', { revise: 'dp-1111111111111111' }],
    ['draft', { submitPackage: { packageId: 'dp-1111111111111111' } }],
    ['draft', { packages: true }],
    ['distill', {}],
    ['sources', {}],
    ['publish', {}],
    ['advise', {}],
    ['intel', {}],
    ['intel', { fusion: true, analyze: true, clusters: true, rank: true, jobs: true, dispatch: true }],
    ['intel', { submitCluster: clusterDraft }],
  ]
  for (const [action, payload] of invocations) {
    const before = snapshotTree(root)
    const result = await runSparkosCommand({ action, payload, dryRun: true })
    assert.ok(result.text.includes('[dryRun]'), action + ' 应返回明确的 dryRun 预览')
    assert.ok(result.text.includes('将运行') || result.text.includes('实际执行时'), action + ' 应说明将执行动作')
    assertTreeUnchanged(before, action + ' ' + JSON.stringify(payload).slice(0, 40))
  }
  // dryRun 与普通执行走不同文本：不得悄悄执行普通读取分支冒充 dryRun
  const readBack = await runSparkosCommand({ action: 'distill', payload: {}, dryRun: true })
  assert.ok(!readBack.text.includes('===== 蒸馏审核队列'), 'dryRun 不得执行普通读取分支')
})

test('一、dryRun 返回参数校验结果（brief 五守卫 / draft id 形状 / submitCluster 校验）', async () => {
  const guard = await runSparkosCommand({
    action: 'brief', dryRun: true,
    payload: { daily: { date: '2026-08-24', must_reads: [{ event_id: '', title: '缺 id', fresh_hours: 4 }] } },
  })
  assert.match(guard.text, /校验结果：ok=false/)
  const badId = await runSparkosCommand({ action: 'draft', payload: { request: 'not-a-dp-id' }, dryRun: true })
  assert.match(badId.text, /不合法/)
  const badCluster = await runSparkosCommand({
    action: 'intel', dryRun: true,
    payload: { submitCluster: { clusterId: 'bad', date: '20260824', topic: 'x', eventKeys: ['e'], evidenceUrls: ['javascript:attack()'] } },
  })
  assert.match(badCluster.text, /校验失败/)
})

/* ===================== 二、并发声明 ===================== */

test('二、写动作不得声明并发安全（isConcurrencySafe 按参数判定）', () => {
  const reads: Array<[string, Record<string, unknown>]> = [
    ['brief', {}], ['topics', {}], ['draft', { pending: true }], ['draft', { packages: true }],
    ['distill', {}], ['sources', {}], ['publish', {}], ['advise', {}],
    ['intel', { clusters: true }], ['intel', { jobs: true }],
  ]
  for (const [action, payload] of reads) assert.equal(isWriteInvocation(action, payload), false, action)
  const writes: Array<[string, Record<string, unknown>]> = [
    ['brief', { daily: {} }], ['topics', { editorial: 'weekly' }],
    ['draft', { request: 'dp-1111111111111111' }], ['draft', { revise: 'dp-1111111111111111' }],
    ['draft', { submitPackage: {} }], ['intel', { fusion: true }], ['intel', { rank: true }], ['intel', {}],
  ]
  for (const [action, payload] of writes) assert.equal(isWriteInvocation(action, payload), true, action)
  // 注册到宿主的工具确实使用该判定
  let captured: { isConcurrencySafe?: (args: Record<string, unknown>) => boolean } | undefined
  registerRunTool({ tools: { register: (t: unknown) => { captured = t as typeof captured } } } as never)
  assert.ok(captured?.isConcurrencySafe, '工具应声明 isConcurrencySafe')
  assert.equal(captured!.isConcurrencySafe({ action: 'topics', payload: { editorial: 'midweek' } }), false, '写调用不安全')
  assert.equal(captured!.isConcurrencySafe({ action: 'advise', payload: {} }), true, '只读调用安全')
  assert.equal(captured!.isConcurrencySafe({ action: 'brief', payload: { daily: {} }, dryRun: true }), true, 'dryRun 零写入安全')
})

/* ===================== 视觉 fixture（隔离） ===================== */

const evidenceUrl = 'https://official.example/sem'
let fixtureNo = 0

const V2_ASSETS: DraftAssetPlan[] = [
  { id: 'cover-main', kind: 'cover', prompt: '封面提示词：温暖晨光下的城市街区', altText: '公众号封面', aspectRatio: '2.35:1', placement: '微信公众号封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
  { id: 'inline-one', kind: 'inline', prompt: '正文提示词：数据流程图', altText: '正文流程图', aspectRatio: '16:9', placement: '微信正文第一节后', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
  { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图提示词', altText: '小红书首图', aspectRatio: '3:4', placement: '小红书第1张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
  { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播提示词', altText: '小红书第二张', aspectRatio: '3:4', placement: '小红书第2张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
]

function cluster(suffix: string): IntelCluster {
  return {
    clusterId: 'c-20260824-' + suffix, topicKey: 't-sem-' + suffix, date: '20260824', topic: '语义收口 ' + suffix,
    coreFacts: ['重试由人工发起'], heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: [evidenceUrl], evidence: [{ url: evidenceUrl, sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://sem'], credibility: 'high', risks: [], platforms: ['wechat', 'telegram', 'x', 'xiaohongshu'],
    angleSuggestions: [], eventKeys: [suffix + '-1', suffix + '-2'],
    judgment: { confirmedFacts: ['重试由人工发起'], inferences: ['可能提升审核效率'], editorialView: '重试必须可追溯。', counterArguments: [], uncertainties: [] },
  }
}

function submission(packageId: string): DraftSubmission {
  const paragraph = '这是围绕已确认事实展开的完整正文，明确区分事实、推断和观点，并说明人工重试、视觉生成与发布准备之间的边界。'.repeat(6)
  return {
    packageId, editorialAngle: '语义收口', keyMessage: '被驳回的图片只能由人工按意见发起重试。',
    factBoundary: '功能实现属于事实；长期影响仍待观察。',
    factClaims: [
      { text: '重试由人工发起', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '审核意见可追溯', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '可能提升审核效率', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: { title: '为什么重试要人工', dek: '可靠附件只是起点。', blocks: [
        { type: 'heading', level: 2, text: '先说结论' }, { type: 'paragraph', text: paragraph },
        { type: 'image', assetId: 'inline-one', caption: '审核流程图' },
        { type: 'heading', level: 2, text: '交付边界' }, { type: 'paragraph', text: paragraph }, { type: 'paragraph', text: paragraph },
      ] },
      telegram: { title: '语义收口', body: paragraph + paragraph },
      x: { posts: ['人工重试需要可追溯。'] },
      xiaohongshu: { title: '重试避坑', body: paragraph + paragraph + ' asset://xhs-cover', hashtags: ['视觉生产', '内容创作', '审核'] },
    },
    assets: V2_ASSETS.map((asset) => ({ ...asset })),
  }
}

function fixture(options: { dbPath?: string } = {}) {
  fixtureNo += 1
  const db = openFactoryDatabase({ path: options.dbPath ?? ':memory:' })
  const suffix = String(fixtureNo).padStart(3, '0')
  generateDailyRanking(db, [cluster(suffix)], '2026-08-24')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-24')
  const card = plan.cards.find((item) => item.topicKey === 't-sem-' + suffix) ?? plan.cards[0]
  decideEditorialCard(db, card.id, 'approved')
  const draft = ensureDraftRequest(db, card.id).package
  const submitted = submitDraftPackage(db, submission(draft.id), new Date('2026-08-24T08:00:00Z'))
  assert.equal(submitted.validation.ok, true, submitted.validation.errors.join('; '))
  const approved = decideDraftPackage(db, draft.id, 'approved', undefined, new Date('2026-08-24T08:01:00Z'))
  const queued = queueVisualBatch(db, approved.id, new Date('2026-08-24T08:02:00Z'))
  return { db, queued }
}

function png(width: number, height: number): Buffer {
  // 结构完整的 minimal PNG：签名 + IHDR chunk（长度 13 / 类型 IHDR / 尺寸 / CRC）
  const chunk = Buffer.alloc(21)
  chunk.writeUInt32BE(13, 0)
  chunk.write('IHDR', 4, 'ascii')
  chunk.writeUInt32BE(width, 8); chunk.writeUInt32BE(height, 12)
  chunk[16] = 8; chunk[17] = 2; chunk[18] = 0; chunk[19] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk, Buffer.alloc(4)])
}

function attachment(data: Buffer, width: number, height: number) {
  const ref = { attachmentId: 'sha256:' + sha256(data), mediaType: 'image/png', bytes: data.byteLength, width, height, name: 'generated.png' }
  return {
    ref,
    reader: { async readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> { return { ref: ref as unknown as ImageAttachmentRef, data } } },
  }
}

async function submitClaim(db: ReturnType<typeof openFactoryDatabase>, claim: NonNullable<ReturnType<typeof claimVisualTask>>, provider: string, second: number) {
  const image = attachment(png(claim.task.targetWidth, claim.task.targetHeight), claim.task.targetWidth, claim.task.targetHeight)
  return submitVisualAttachment(db, image.reader, {
    taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref,
    provider, model: provider === 'stub' ? 'stub-v1' : 'image-model', sourceTool: 'image_generate', promptEffective: claim.authoritativePrompt,
  }, { now: new Date('2026-08-24T09:' + String(second).padStart(2, '0') + ':00Z') })
}

async function rejectFirst(db: ReturnType<typeof openFactoryDatabase>, packageId: string, provider = 'openai', note = '构图需要重做：主体放大，去掉左下角杂物') {
  const claim = claimVisualTask(db, { packageId }, new Date('2026-08-24T09:00:00Z'))!
  await submitClaim(db, claim, provider, 1)
  const task = visualStatus(db, packageId).batches[0].tasks[0]
  const attempt = task.attempts.find((item) => item.attemptNo === task.currentAttempt)!
  decideVisualAttempt(db, { attemptId: attempt.id, decision: 'rejected', note }, new Date('2026-08-24T10:00:00Z'))
  return { task, attempt, note, assetId: task.assetId, packageId }
}

function retryPayload(taskId: string, attemptId: string, packageId: string, assetId: string, key: string, extra: Record<string, unknown> = {}) {
  return { packageId, taskId, currentAttemptId: attemptId, assetId, idempotencyKey: key, ...extra }
}

/* ===================== 二（续）：序列化与虚假 event ===================== */

test('二、写路径事务级序列化：连接 A 持有 IMMEDIATE 锁时连接 B 的重试写入被阻塞', async () => {
  const dbPath = path.join(root, 'serialize.db')
  const item = fixture({ dbPath })
  const pkg = item.queued.batch.packageId
  const rejected = await rejectFirst(item.db, pkg, 'openai')
  item.db.close()
  const a = openFactoryDatabase({ path: dbPath })
  const b = openFactoryDatabase({ path: dbPath })
  a.exec('BEGIN IMMEDIATE')
  try {
    assert.throws(() => requestVisualRetry(b, retryPayload(rejected.task.id, rejected.attempt.id, pkg, rejected.assetId, 'sem:serialize:1')))
  } finally {
    a.exec('ROLLBACK')
  }
  // 锁释放后同一请求成功
  const ok = requestVisualRetry(b, retryPayload(rejected.task.id, rejected.attempt.id, pkg, rejected.assetId, 'sem:serialize:1'))
  assert.equal(ok.state, 'retry')
  a.close(); b.close()
})

test('二、条件 UPDATE 检查 changes：状态冲突不写入虚假 event', async () => {
  const item = fixture()
  const pkg = item.queued.batch.packageId
  const rejected = await rejectFirst(item.db, pkg, 'openai')
  const first = requestVisualRetry(item.db, retryPayload(rejected.task.id, rejected.attempt.id, pkg, rejected.assetId, 'sem:conflict:1'))
  assert.equal(first.idempotent, false)
  // 状态已前移（retry），第二次不同幂等键请求必须 409，且 retry event 仍然只有一条
  assert.throws(
    () => requestVisualRetry(item.db, retryPayload(rejected.task.id, rejected.attempt.id, pkg, rejected.assetId, 'sem:conflict:2')),
    (error) => error instanceof VisualPipelineError && error.httpStatus === 409,
  )
  const events = item.db.prepare("SELECT COUNT(*) AS count FROM visual_asset_events WHERE task_id=? AND to_state='retry'").get(rejected.task.id) as { count: number }
  assert.equal(Number(events.count), 1, '冲突请求不得写入第二条 retry event')
  item.db.close()
})

/* ===================== 三、统一视觉 retry ===================== */

test('三、legacy {taskId} / sparkos_visual_retry / 受控 HTTP 进入同一状态机并全部留审计', async () => {
  const item = fixture()
  const pkg = item.queued.batch.packageId
  const rejected = await rejectFirst(item.db, pkg, 'openai')
  // 旧 attempt 图片不可变：sha/mtime 前后不变
  const oldFile = path.join(vault, rejected.attempt.importedRelativePath!)
  const old = { sha: sha256(readFileSync(oldFile)), mtime: String(statSync(oldFile, { bigint: true }).mtimeNs) }
  // legacy 入口（HTTP legacy {taskId} 与 sparkos_visual_retry 工具都调 retryVisualTask）
  const legacy = retryVisualTask(item.db, rejected.task.id)
  assert.equal(legacy.state, 'retry')
  assert.equal(legacy.previousNote, rejected.note)
  const audit = item.db.prepare('SELECT purpose, idempotency_key, status FROM visual_retry_requests WHERE task_id=?').get(rejected.task.id) as { purpose: string; idempotency_key: string; status: string }
  assert.equal(audit.purpose, 'reject_rerun')
  assert.equal(audit.idempotency_key, 'auto:' + rejected.task.id + ':' + rejected.attempt.id, '确定性幂等键')
  assert.equal(audit.status, 'created')
  // 重放同一路径：确定性幂等键 → idempotent，不产生第二条审计
  const replay = retryVisualTask(item.db, rejected.task.id)
  assert.equal(replay.state, 'retry')
  assert.equal(Number((item.db.prepare('SELECT COUNT(*) AS count FROM visual_retry_requests WHERE task_id=?').get(rejected.task.id) as { count: number }).count), 1)
  // 旧 attempt、approval、图片全部保留
  assert.equal(Number((item.db.prepare("SELECT COUNT(*) AS count FROM visual_asset_attempts WHERE task_id=?").get(rejected.task.id) as { count: number }).count), 1)
  assert.equal((item.db.prepare("SELECT decision FROM approvals WHERE subject_kind='visual_attempt' AND subject_id=?").get(rejected.attempt.id) as { decision: string }).decision, 'rejected')
  assert.deepEqual({ sha: sha256(readFileSync(oldFile)), mtime: String(statSync(oldFile, { bigint: true }).mtimeNs) }, old)
  item.db.close()
})

test('三、replace_stub_with_production：显式 purpose + 人工确认 + 审计；stub 重交被拒；历史全保留', async () => {
  const item = fixture()
  const pkg = item.queued.batch.packageId
  const rejected = await rejectFirst(item.db, pkg, 'stub', '测试图构图不合格，需要真实出图')
  const payloadBase = retryPayload(rejected.task.id, rejected.attempt.id, pkg, rejected.assetId, 'sem:stub:1')

  // 1) 默认目的：stub 不得重试（Agent 工具与受控路径同门）
  assert.throws(() => requestVisualRetry(item.db, payloadBase), (e) => e instanceof VisualPipelineError && e.code === 'stub-cannot-retry')
  assert.throws(() => retryVisualTask(item.db, rejected.task.id), (e) => e instanceof VisualPipelineError && e.code === 'stub-cannot-retry')

  // 2) 显式 purpose 但缺人工确认 → 400
  assert.throws(
    () => requestVisualRetry(item.db, { ...payloadBase, purpose: 'replace_stub_with_production' }),
    (e) => e instanceof VisualPipelineError && e.code === 'human-confirmation-required',
  )

  // 3) purpose + 人工确认 → 成功，审计带 purpose/human_note
  const replaced = requestVisualRetry(item.db, { ...payloadBase, purpose: 'replace_stub_with_production', humanConfirmation: '人工确认：用真实 Provider 重出封面替换测试图' })
  assert.equal(replaced.purpose, 'replace_stub_with_production')
  const audit = item.db.prepare('SELECT purpose, human_note FROM visual_retry_requests WHERE task_id=?').get(rejected.task.id) as { purpose: string; human_note: string }
  assert.equal(audit.purpose, 'replace_stub_with_production')
  assert.match(audit.human_note!, /人工确认/)

  // 4) 新 attempt 仍交 stub → 生产闸门前置拒绝
  const next = claimVisualTask(item.db, { packageId: pkg }, new Date('2026-08-24T11:00:00Z'))!
  assert.equal(next.task.id, rejected.task.id)
  assert.equal(next.attempt.attemptNo, 2)
  assert.equal(next.attempt.id !== rejected.attempt.id, true, '新 attempt 是独立行')
  await assert.rejects(
    submitClaim(item.db, next, 'stub', 2),
    (e) => e instanceof VisualPipelineError && e.code === 'replace-stub-requires-production',
  )
  // 5) 真实 Provider 提交恢复正轨
  await submitClaim(item.db, next, 'openai', 3)
  const afterState = visualStatus(item.db, pkg).batches[0].tasks.find((t) => t.id === rejected.task.id)
  assert.ok(afterState)
  assert.equal(afterState!.state, 'waiting_visual_approval', 'state=' + String(afterState?.state))
  // 6) 旧 attempt/approval/event 全保留
  const task = visualStatus(item.db, pkg).batches[0].tasks[0]
  assert.equal(task.attempts.length, 2)
  assert.equal(task.attempts[0]?.approval?.decision, 'rejected', String(task.attempts[0]?.approval?.decision))
  const events = item.db.prepare('SELECT to_state FROM visual_asset_events WHERE task_id=? ORDER BY id').all(rejected.task.id) as Array<{ to_state: string }>
  assert.equal(events.filter((e) => e.to_state === 'retry').length, 1)
  item.db.close()
})

/* ===================== 四、发布台账不可领取 ===================== */

test('四、claimNextJob 显式排除历史 publish job；发布记录只进 publication_intents；无平台调用', async () => {
  const dbPath = path.join(root, 'publish.db')
  const item = fixture({ dbPath })
  const pkg = item.queued.batch.packageId
  // 历史遗留：一个 queued 状态的 kind=publish job（只保留审计，不删除）
  const history = createJob(item.db, { kind: 'publish', input: { packageId: pkg }, idempotencyKey: 'publish:' + pkg, priority: 10 })
  assert.equal(history.job.status, 'queued')
  const real = createJob(item.db, { kind: 'creation', input: {}, idempotencyKey: 'sem:real:1', priority: 1 })
  // 领取必须命中真实任务而非高优先级的 publish 历史 job
  const claimed = claimNextJob(item.db, 'worker-sem')
  assert.ok(claimed)
  assert.equal(claimed.id, real.job.id, 'claimNextJob 不得领取 publish job')
  assert.notEqual(claimed.id, history.job.id)
  item.db.close()

  // 就绪包创建发布记录：只写台账，不创建任何 workflow job，无平台 API 调用痕迹
  const ready = fixture({ dbPath })
  const readyPkg = ready.queued.batch.packageId
  let second = 1
  while (true) {
    const claim = claimVisualTask(ready.db, { packageId: readyPkg }, new Date('2026-08-24T09:' + String(second).padStart(2, '0') + ':00Z'))
    if (!claim) break
    const image = attachment(png(claim.task.targetWidth, claim.task.targetHeight), claim.task.targetWidth, claim.task.targetHeight)
    await submitVisualAttachment(ready.db, image.reader, { taskId: claim.task.id, attemptId: claim.attempt.id, leaseToken: claim.leaseToken, attachment: image.ref, provider: 'openai', model: 'image-model', sourceTool: 'image_generate' }, { now: new Date('2026-08-24T09:' + String(second).padStart(2, '0') + ':10Z') })
    second += 1
  }
  for (const task of visualStatus(ready.db, readyPkg).batches[0].tasks) {
    const attempt = task.attempts.find((a) => a.attemptNo === task.currentAttempt)!
    decideVisualAttempt(ready.db, { attemptId: attempt.id, decision: 'approved' })
  }
  createVisualDelivery(ready.db, { packageId: readyPkg, mode: 'production' }, new Date('2026-08-24T11:00:00Z'))
  const jobsBefore = Number((ready.db.prepare('SELECT COUNT(*) AS count FROM workflow_jobs').get() as { count: number }).count)
  const result = createPublishTask(ready.db, readyPkg, new Date('2026-08-24T12:00:00Z'))
  assert.equal(result.created, true)
  assert.equal(result.status, 'recorded')
  const jobsAfter = Number((ready.db.prepare('SELECT COUNT(*) AS count FROM workflow_jobs').get() as { count: number }).count)
  assert.equal(jobsAfter, jobsBefore, '创建发布记录不得创建任何 workflow job（无平台 API 调用）')
  assert.equal(Number((ready.db.prepare('SELECT COUNT(*) AS count FROM publication_intents WHERE package_id=?').get(readyPkg) as { count: number }).count), 1)
  // 台账不可被 Worker 领取（含优先级最高的历史 publish job 场景）
  assert.equal(claimNextJob(ready.db, 'worker-sem-2'), null, 'claimNextJob 不得领取发布台账/历史 publish job')
  ready.db.close()
})

test('附：8 个子命令常量与导出完整（防拼写回归）', () => {
  assert.deepEqual([...SUBCOMMANDS], ['brief', 'topics', 'draft', 'distill', 'sources', 'publish', 'advise', 'intel'])
})
