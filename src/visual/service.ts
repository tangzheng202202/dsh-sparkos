/** M5A visual task state machine, attachment import and immutable storage. */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { DraftAssetPlan } from '../creation/drafts.ts'
import { VAULT_ROOT } from '../vault.ts'
import type {
  SubmittedAttachmentRef,
  VisualAssetAttempt,
  VisualAssetTask,
  VisualBatch,
  VisualBatchStatus,
  VisualStatusSnapshot,
  VisualTaskState,
} from './types.ts'
import { VisualPipelineError } from './errors.ts'
import {
  attemptApproval,
  latestPublishTask,
  latestRetryRequestForTask,
  logicalTaskState,
  markRetryRequestClaimed,
  publicationReadiness,
  visualRetryEligibility,
  visualReviewAggregate,
} from './review.ts'

const PACKAGE_ID = /^dp-[a-f0-9]{16}$/
const TASK_ID = /^vt-[a-f0-9]{20}$/
const ATTEMPT_ID = /^va-[a-f0-9]{20}$/
const ASSET_ID = /^[a-z0-9][a-z0-9._-]{2,48}$/i
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000
const DEFAULT_LEASE_SECONDS = 300

const TARGETS = {
  '2.35:1': { width: 900, height: 383, preset: 'wechat_cover' },
  '16:9': { width: 1280, height: 720, preset: 'article' },
  '3:4': { width: 1080, height: 1440, preset: 'xhs_34' },
  '1:1': { width: 1080, height: 1080, preset: 'xhs_square' },
} as const

type VisualAspect = keyof typeof TARGETS

export { VisualPipelineError } from './errors.ts'

interface BatchRow {
  id: string
  package_id: string
  revision: number
  source_assets_sha256: string
  status: VisualBatchStatus
  required_count: number
  approved_count: number
  created_at: string
  updated_at: string
}

interface TaskRow {
  id: string
  batch_id: string
  package_id: string
  asset_id: string
  kind: VisualAssetTask['kind']
  placement: string
  prompt: string
  alt_text: string
  aspect_ratio: VisualAspect
  target_width: number
  target_height: number
  state: VisualTaskState
  idempotency_key: string
  current_attempt: number
  max_attempts: number
  lease_token_hash: string | null
  lease_expires_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

interface AttemptRow {
  id: string
  task_id: string
  job_id: string
  attempt_no: number
  source_attachment_id: string | null
  source_media_type: string | null
  source_bytes: number | null
  source_width: number | null
  source_height: number | null
  provider: string | null
  model: string | null
  source_tool: string | null
  source_call_id: string | null
  prompt_original: string
  prompt_effective: string | null
  negative_prompt: string | null
  seed_requested: number | null
  seed_effective: number | null
  revised_prompt: string | null
  content_filter: string | null
  imported_relative_path: string | null
  imported_sha256: string | null
  validation_json: string
  status: VisualAssetAttempt['status']
  generated_at: string | null
  imported_at: string | null
  created_at: string
  updated_at: string
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function deterministicId(prefix: string, value: string, length = 20): string {
  return `${prefix}-${sha256(value).slice(0, length)}`
}

function batchFromRow(row: BatchRow): VisualBatch {
  return {
    id: row.id,
    packageId: row.package_id,
    revision: Number(row.revision),
    sourceAssetsSha256: row.source_assets_sha256,
    status: row.status,
    requiredCount: Number(row.required_count),
    approvedCount: Number(row.approved_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function taskFromRow(row: TaskRow): VisualAssetTask {
  return {
    id: row.id,
    batchId: row.batch_id,
    packageId: row.package_id,
    assetId: row.asset_id,
    kind: row.kind,
    placement: row.placement,
    prompt: row.prompt,
    altText: row.alt_text,
    aspectRatio: row.aspect_ratio,
    targetWidth: Number(row.target_width),
    targetHeight: Number(row.target_height),
    state: row.state,
    idempotencyKey: row.idempotency_key,
    currentAttempt: Number(row.current_attempt),
    maxAttempts: Number(row.max_attempts),
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function attemptFromRow(row: AttemptRow): VisualAssetAttempt {
  return {
    id: row.id,
    taskId: row.task_id,
    jobId: row.job_id,
    attemptNo: Number(row.attempt_no),
    sourceAttachmentId: row.source_attachment_id,
    sourceMediaType: row.source_media_type,
    sourceBytes: row.source_bytes === null ? null : Number(row.source_bytes),
    sourceWidth: row.source_width === null ? null : Number(row.source_width),
    sourceHeight: row.source_height === null ? null : Number(row.source_height),
    provider: row.provider,
    model: row.model,
    sourceTool: row.source_tool,
    sourceCallId: row.source_call_id,
    promptOriginal: row.prompt_original,
    promptEffective: row.prompt_effective,
    negativePrompt: row.negative_prompt,
    seedRequested: row.seed_requested === null ? null : Number(row.seed_requested),
    seedEffective: row.seed_effective === null ? null : row.seed_effective === 1,
    revisedPrompt: row.revised_prompt,
    contentFilter: row.content_filter,
    importedRelativePath: row.imported_relative_path,
    importedSha256: row.imported_sha256,
    validation: JSON.parse(row.validation_json) as Record<string, unknown>,
    status: row.status,
    generatedAt: row.generated_at,
    importedAt: row.imported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function visualEvent(
  db: DatabaseSync,
  taskId: string,
  attemptId: string | null,
  from: VisualTaskState | null,
  to: VisualTaskState,
  reason: string,
  at: string,
): void {
  db.prepare(`
    INSERT INTO visual_asset_events(task_id, attempt_id, from_state, to_state, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, attemptId, from, to, reason, at)
}

function safeExistingFile(relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new VisualPipelineError('artifact-integrity-failed', '草稿产物路径不得为绝对路径')
  const root = path.resolve(VAULT_ROOT)
  const absolute = path.resolve(root, relativePath)
  if (!absolute.startsWith(root + path.sep)) throw new VisualPipelineError('artifact-integrity-failed', '草稿产物路径越界')
  let info
  try { info = lstatSync(absolute) } catch (error) {
    throw new VisualPipelineError('artifact-integrity-failed', '草稿产物缺失：' + relativePath, 422, { cause: error })
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new VisualPipelineError('artifact-integrity-failed', '草稿产物必须是普通文件：' + relativePath)
  const canonical = realpathSync(absolute)
  if (!canonical.startsWith(realpathSync(root) + path.sep)) throw new VisualPipelineError('artifact-integrity-failed', '草稿产物真实路径越界')
  return absolute
}

interface VerifiedPackage {
  packageId: string
  revision: number
  createdAt: string
  assets: DraftAssetPlan[]
  assetsSha256: string
}

function validateAssets(value: unknown, contractVersion: number): DraftAssetPlan[] {
  if (!Array.isArray(value) || value.length === 0) throw new VisualPipelineError('invalid-assets', 'assets.json 必须是非空数组')
  const seen = new Set<string>()
  return value.map((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new VisualPipelineError('invalid-assets', `assets[${index}] 必须是对象`)
    const asset = raw as Partial<DraftAssetPlan>
    if (typeof asset.id !== 'string' || !ASSET_ID.test(asset.id) || seen.has(asset.id)) throw new VisualPipelineError('invalid-assets', `assets[${index}].id 不合法或重复`)
    seen.add(asset.id)
    if (asset.kind !== 'cover' && asset.kind !== 'inline' && asset.kind !== 'carousel') throw new VisualPipelineError('invalid-assets', `assets[${index}].kind 不合法`)
    if (typeof asset.prompt !== 'string' || asset.prompt.trim() === '') throw new VisualPipelineError('invalid-assets', `assets[${index}].prompt 必填`)
    if (typeof asset.altText !== 'string' || asset.altText.trim() === '') throw new VisualPipelineError('invalid-assets', `assets[${index}].altText 必填`)
    if (typeof asset.placement !== 'string' || asset.placement.trim() === '') throw new VisualPipelineError('invalid-assets', `assets[${index}].placement 必填`)
    if (typeof asset.aspectRatio !== 'string' || !(asset.aspectRatio in TARGETS)) throw new VisualPipelineError('invalid-assets', `assets[${index}].aspectRatio 不合法`)
    const base: DraftAssetPlan = {
      id: asset.id,
      kind: asset.kind,
      prompt: asset.prompt.trim(),
      altText: asset.altText.trim(),
      aspectRatio: asset.aspectRatio as VisualAspect,
      placement: asset.placement.trim(),
    }
    if (contractVersion >= 2) {
      if (!Array.isArray(asset.platforms) || asset.platforms.some((platform) => !['wechat', 'telegram', 'x', 'xiaohongshu'].includes(platform))) {
        throw new VisualPipelineError('invalid-assets', `assets[${index}].platforms 不合法`)
      }
      if (!Number.isSafeInteger(asset.order) || Number(asset.order) < 1 || typeof asset.required !== 'boolean' || typeof asset.role !== 'string') {
        throw new VisualPipelineError('invalid-assets', `assets[${index}] contract v2 字段不合法`)
      }
      base.platforms = [...asset.platforms]
      base.order = Number(asset.order)
      base.required = asset.required
      base.role = asset.role
    }
    return base
  })
}

function verifyApprovedPackage(db: DatabaseSync, packageId: string): VerifiedPackage {
  if (!PACKAGE_ID.test(packageId)) throw new VisualPipelineError('bad-request', 'packageId 不合法', 400)
  const draft = db.prepare('SELECT id, revision, status, contract_version, artifact_dir, created_at FROM draft_packages WHERE id = ?').get(packageId) as {
    id: string; revision: number; status: string; contract_version: number; artifact_dir: string | null; created_at: string
  } | undefined
  if (!draft) throw new VisualPipelineError('not-found', '草稿包不存在：' + packageId, 404)
  if (draft.status !== 'approved') throw new VisualPipelineError('package-not-approved', '只有已批准草稿包可以创建视觉任务')
  if (draft.artifact_dir === null || path.isAbsolute(draft.artifact_dir)
    || path.basename(draft.artifact_dir) !== packageId
    || !/^drafts[/\\]factory[/\\]\d{4}-\d{2}-\d{2}[/\\]dp-[a-f0-9]{16}$/.test(draft.artifact_dir)) {
    throw new VisualPipelineError('artifact-integrity-failed', '草稿包 artifact_dir 不合法')
  }
  const rows = db.prepare(`
    SELECT relative_path, sha256, bytes FROM draft_artifacts WHERE package_id = ? ORDER BY relative_path
  `).all(packageId) as Array<{ relative_path: string; sha256: string; bytes: number }>
  if (rows.length !== 8) throw new VisualPipelineError('artifact-integrity-failed', `草稿包应有 8 个产物，实际 ${rows.length} 个`)
  const expectedNames = new Set(['wechat.html', 'wechat.md', 'telegram.md', 'x-thread.md', 'xiaohongshu.md', 'assets.json', 'package.json', 'manifest.json'])
  const byName = new Map<string, { relative_path: string; sha256: string; bytes: number; data: Buffer }>()
  for (const row of rows) {
    const name = path.basename(row.relative_path)
    if (!expectedNames.has(name) || path.dirname(row.relative_path) !== draft.artifact_dir || byName.has(name)) {
      throw new VisualPipelineError('artifact-integrity-failed', '草稿包产物文件名、目录不合法或重复：' + name)
    }
    const absolute = safeExistingFile(row.relative_path)
    const data = readFileSync(absolute)
    if (data.byteLength !== Number(row.bytes) || sha256(data) !== row.sha256) {
      throw new VisualPipelineError('artifact-integrity-failed', '草稿产物与 SQLite 哈希不一致：' + name)
    }
    byName.set(name, { ...row, data })
  }
  for (const required of ['assets.json', 'package.json', 'manifest.json']) {
    if (!byName.has(required)) throw new VisualPipelineError('artifact-integrity-failed', '草稿包缺少：' + required)
  }
  let manifest: { packageId?: unknown; artifacts?: unknown }
  try { manifest = JSON.parse(byName.get('manifest.json')!.data.toString('utf8')) as typeof manifest } catch (error) {
    throw new VisualPipelineError('artifact-integrity-failed', 'manifest.json 不是合法 JSON', 422, { cause: error })
  }
  if (manifest.packageId !== packageId || !Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 7) {
    throw new VisualPipelineError('artifact-integrity-failed', 'manifest.json 包标识或产物数量不合法')
  }
  const declared = new Set<string>()
  for (const raw of manifest.artifacts) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new VisualPipelineError('artifact-integrity-failed', 'manifest artifact 不合法')
    const item = raw as { file?: unknown; sha256?: unknown; bytes?: unknown }
    if (typeof item.file !== 'string' || path.basename(item.file) !== item.file || item.file === 'manifest.json' || declared.has(item.file)) {
      throw new VisualPipelineError('artifact-integrity-failed', 'manifest 文件名不合法或重复')
    }
    declared.add(item.file)
    const stored = byName.get(item.file)
    if (!stored || item.sha256 !== stored.sha256 || item.bytes !== Number(stored.bytes)) {
      throw new VisualPipelineError('artifact-integrity-failed', 'manifest 与磁盘/SQLite 不一致：' + item.file)
    }
  }
  if ([...byName.keys()].some((name) => name !== 'manifest.json' && !declared.has(name))) {
    throw new VisualPipelineError('artifact-integrity-failed', 'manifest 未覆盖全部草稿产物')
  }
  const assetsData = byName.get('assets.json')!.data
  let assetsRaw: unknown
  let packageRaw: unknown
  try {
    assetsRaw = JSON.parse(assetsData.toString('utf8'))
    packageRaw = JSON.parse(byName.get('package.json')!.data.toString('utf8'))
  } catch (error) {
    throw new VisualPipelineError('artifact-integrity-failed', 'package/assets JSON 无法解析', 422, { cause: error })
  }
  const assets = validateAssets(assetsRaw, Number(draft.contract_version))
  const packageAssets = packageRaw !== null && typeof packageRaw === 'object' && !Array.isArray(packageRaw)
    ? (packageRaw as { assets?: unknown }).assets : undefined
  if (!isDeepStrictEqual(packageAssets, assetsRaw)) throw new VisualPipelineError('artifact-integrity-failed', 'package.json 与 assets.json 的视觉计划不一致')
  return { packageId, revision: Number(draft.revision), createdAt: draft.created_at, assets, assetsSha256: sha256(assetsData) }
}

export function queueVisualBatch(db: DatabaseSync, packageId: string, now = new Date()): { batch: VisualBatch; tasks: VisualAssetTask[]; created: boolean } {
  const verified = verifyApprovedPackage(db, packageId)
  const at = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const currentDraft = db.prepare('SELECT status FROM draft_packages WHERE id = ?').get(packageId) as { status: string } | undefined
    if (currentDraft?.status !== 'approved') throw new VisualPipelineError('package-not-approved', '草稿包在创建视觉任务前不再是 approved')
    const existing = db.prepare('SELECT * FROM visual_batches WHERE package_id = ?').get(packageId) as BatchRow | undefined
    if (existing) {
      if (existing.source_assets_sha256 !== verified.assetsSha256) throw new VisualPipelineError('conflict', '已存在视觉批次，但 assets.json 哈希不同', 409)
      const tasks = (db.prepare('SELECT * FROM visual_asset_tasks WHERE batch_id = ? ORDER BY asset_id').all(existing.id) as unknown as TaskRow[]).map(taskFromRow)
      const expectedTaskIds = verified.assets.map((asset) => deterministicId('vt', `visual-task:${packageId}:${asset.id}:${verified.assetsSha256}`)).sort()
      if (tasks.length !== verified.assets.length || !isDeepStrictEqual(tasks.map((task) => task.id).sort(), expectedTaskIds)) {
        throw new VisualPipelineError('conflict', '已存在视觉批次，但任务集合与冻结 assets.json 不一致', 409)
      }
      for (const asset of verified.assets) {
        const task = tasks.find((candidate) => candidate.assetId === asset.id)
        const target = TARGETS[asset.aspectRatio as VisualAspect]
        const idempotencyKey = `visual-task:${packageId}:${asset.id}:${verified.assetsSha256}`
        if (task === undefined || task.batchId !== existing.id || task.packageId !== packageId
          || task.kind !== asset.kind || task.placement !== asset.placement || task.prompt !== asset.prompt
          || task.altText !== asset.altText || task.aspectRatio !== asset.aspectRatio
          || task.targetWidth !== target.width || task.targetHeight !== target.height
          || task.idempotencyKey !== idempotencyKey) {
          throw new VisualPipelineError('conflict', '已存在视觉批次，但任务内容与冻结 assets.json 不一致', 409)
        }
      }
      db.exec('COMMIT')
      return { batch: batchFromRow(existing), tasks, created: false }
    }
    const batchId = deterministicId('vb', `${packageId}:${verified.assetsSha256}`)
    db.prepare(`
      INSERT INTO visual_batches(id, package_id, revision, source_assets_sha256, status, required_count, approved_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?)
    `).run(batchId, packageId, verified.revision, verified.assetsSha256, verified.assets.filter((asset) => asset.required !== false).length, at, at)
    for (const asset of verified.assets) {
      const target = TARGETS[asset.aspectRatio as VisualAspect]
      const idempotencyKey = `visual-task:${packageId}:${asset.id}:${verified.assetsSha256}`
      const taskId = deterministicId('vt', idempotencyKey)
      db.prepare(`
        INSERT INTO visual_asset_tasks(
          id, batch_id, package_id, asset_id, kind, placement, prompt, alt_text, aspect_ratio,
          target_width, target_height, state, idempotency_key, current_attempt, max_attempts,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 3, ?, ?)
      `).run(
        taskId, batchId, packageId, asset.id, asset.kind, asset.placement, asset.prompt,
        asset.altText, asset.aspectRatio, target.width, target.height, idempotencyKey, at, at,
      )
      visualEvent(db, taskId, null, null, 'queued', 'created from approved immutable draft package', at)
    }
    const batch = batchFromRow(db.prepare('SELECT * FROM visual_batches WHERE id = ?').get(batchId) as unknown as BatchRow)
    const tasks = (db.prepare('SELECT * FROM visual_asset_tasks WHERE batch_id = ? ORDER BY asset_id').all(batchId) as unknown as TaskRow[]).map(taskFromRow)
    db.exec('COMMIT')
    return { batch, tasks, created: true }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function leaseHash(token: string): string {
  return sha256(token)
}

function sameHash(actual: string | null, token: string): boolean {
  if (actual === null) return false
  const expected = leaseHash(token)
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

function clampLeaseSeconds(value?: number): number {
  const seconds = value ?? DEFAULT_LEASE_SECONDS
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 900) throw new VisualPipelineError('bad-request', 'leaseSeconds 必须是 60–900 的整数', 400)
  return seconds
}

function refreshBatchStatus(db: DatabaseSync, batchId: string, at: string): void {
  const states = db.prepare('SELECT state, COUNT(*) AS count FROM visual_asset_tasks WHERE batch_id = ? GROUP BY state').all(batchId) as Array<{ state: VisualTaskState; count: number }>
  const counts = Object.fromEntries(states.map((row) => [row.state, Number(row.count)])) as Partial<Record<VisualTaskState, number>>
  const total = states.reduce((sum, row) => sum + Number(row.count), 0)
  let status: VisualBatchStatus
  if ((counts.waiting_visual_approval ?? 0) === total && total > 0) status = 'waiting_visual_approval'
  else if ((counts.generating ?? 0) > 0 || (counts.generated ?? 0) > 0 || (counts.waiting_visual_approval ?? 0) > 0) status = 'generating'
  else if ((counts.failed ?? 0) > 0 && (counts.queued ?? 0) === 0 && (counts.retry ?? 0) === 0) status = 'failed'
  else status = 'queued'
  db.prepare('UPDATE visual_batches SET status = ?, updated_at = ? WHERE id = ?').run(status, at, batchId)
}

function insertRunningWorkflowJob(db: DatabaseSync, task: TaskRow, attemptNo: number, attemptId: string, leaseExpiresAt: string, at: string): string {
  const jobId = randomUUID()
  const key = `visual.generate:${task.id}:${attemptNo}`
  db.prepare(`
    INSERT INTO workflow_jobs(
      id, kind, idempotency_key, status, priority, input_json, attempts, max_attempts,
      run_after, worker_id, lease_expires_at, created_at, updated_at
    ) VALUES (?, 'visual.generate', ?, 'queued', 20, ?, 0, 1, ?, NULL, NULL, ?, ?)
  `).run(jobId, key, JSON.stringify({ packageId: task.package_id, taskId: task.id, attemptId, assetId: task.asset_id }), at, at, at)
  db.prepare('INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, NULL, ?, ?)')
    .run(jobId, at, 'queued', 'visual attempt created')
  db.prepare(`
    UPDATE workflow_jobs
    SET status='running', attempts=1, worker_id=?, lease_expires_at=?, updated_at=?
    WHERE id=? AND status='queued'
  `).run(`visual:${task.id}`, leaseExpiresAt, at, jobId)
  db.prepare('INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)')
    .run(jobId, at, 'queued', 'running', 'visual attempt claimed')
  return jobId
}

export interface VisualClaim {
  batch: VisualBatch
  task: VisualAssetTask
  attempt: VisualAssetAttempt
  leaseToken: string
  imageStudioAspect: string
  previousNote: string | null
  /**
   * M6.2 authoritative prompt: original asset prompt + fixed target spec +
   * fact-boundary constraint, and for retries the reject note, optional
   * supplementary instruction and the previous attempt's provider/model.
   */
  authoritativePrompt: string
}

export function claimVisualTask(
  db: DatabaseSync,
  options: { packageId?: string; leaseSeconds?: number } = {},
  now = new Date(),
): VisualClaim | null {
  if (options.packageId !== undefined && !PACKAGE_ID.test(options.packageId)) throw new VisualPipelineError('bad-request', 'packageId 不合法', 400)
  const leaseSeconds = clampLeaseSeconds(options.leaseSeconds)
  recoverExpiredVisualTasks(db, now)
  const at = now.toISOString()
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const sql = `
      SELECT t.* FROM visual_asset_tasks t
      JOIN visual_batches b ON b.id = t.batch_id
      WHERE t.state IN ('queued', 'retry')
        AND t.current_attempt < t.max_attempts
        ${options.packageId === undefined ? '' : 'AND t.package_id = ?'}
      ORDER BY b.created_at, t.created_at, t.asset_id
      LIMIT 1
    `
    const row = (options.packageId === undefined ? db.prepare(sql).get() : db.prepare(sql).get(options.packageId)) as TaskRow | undefined
    if (!row) {
      db.exec('COMMIT')
      return null
    }
    const from = row.state
    const attemptNo = Number(row.current_attempt) + 1
    const attemptId = deterministicId('va', `${row.id}:${attemptNo}`)
    const token = randomBytes(32).toString('hex')
    const jobId = insertRunningWorkflowJob(db, row, attemptNo, attemptId, leaseExpiresAt, at)
    const updated = db.prepare(`
      UPDATE visual_asset_tasks
      SET state='generating', current_attempt=?, lease_token_hash=?, lease_expires_at=?, last_error=NULL, updated_at=?
      WHERE id=? AND state=? AND current_attempt=?
    `).run(attemptNo, leaseHash(token), leaseExpiresAt, at, row.id, from, row.current_attempt)
    if (Number(updated.changes) !== 1) throw new VisualPipelineError('claim-conflict', '视觉任务已被其他 worker 领取', 409)
    db.prepare(`
      INSERT INTO visual_asset_attempts(
        id, task_id, job_id, attempt_no, prompt_original, validation_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 'generating', ?, ?)
    `).run(attemptId, row.id, jobId, attemptNo, row.prompt, at, at)
    visualEvent(db, row.id, attemptId, from, 'generating', 'claimed with a hashed lease token', at)
    refreshBatchStatus(db, row.batch_id, at)
    // M6.2 authoritative prompt: retries must carry the reject note and any
    // supplementary instruction verbatim so the agent cannot omit them.
    const retryRef = from === 'retry' ? latestRetryRequestForTask(db, row.id) : null
    const target = TARGETS[row.aspect_ratio]
    let authoritativePrompt = `${row.prompt}\n[固定规格] ${row.aspect_ratio}（${target.width}x${target.height}px）\n[事实边界] 不得改变事实边界；不得删除或覆盖原驳回意见与补充要求`
    if (retryRef) {
      const previous = db.prepare(`
        SELECT provider, model, attempt_no FROM visual_asset_attempts WHERE task_id=? AND attempt_no=?
      `).get(row.id, row.current_attempt) as { provider: string | null; model: string | null; attempt_no: number } | undefined
      authoritativePrompt += `\n[驳回意见] ${retryRef.rejectNote}\n[补充要求] ${retryRef.supplementaryInstruction ?? '无'}`
      if (previous) {
        authoritativePrompt += `\n[上一 attempt] #${previous.attempt_no} provider=${previous.provider ?? '—'} model=${previous.model ?? '—'}`
      }
      markRetryRequestClaimed(db, retryRef.id, at)
    }
    const task = taskFromRow(db.prepare('SELECT * FROM visual_asset_tasks WHERE id = ?').get(row.id) as unknown as TaskRow)
    const attempt = attemptFromRow(db.prepare('SELECT * FROM visual_asset_attempts WHERE id = ?').get(attemptId) as unknown as AttemptRow)
    const batch = batchFromRow(db.prepare('SELECT * FROM visual_batches WHERE id = ?').get(row.batch_id) as unknown as BatchRow)
    db.exec('COMMIT')
    return {
      batch, task, attempt, leaseToken: token, imageStudioAspect: target.preset, previousNote: row.last_error,
      authoritativePrompt,
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function activeLease(db: DatabaseSync, taskId: string, attemptId: string, token: string, now: Date): { task: TaskRow; attempt: AttemptRow } {
  if (!TASK_ID.test(taskId) || !ATTEMPT_ID.test(attemptId) || !/^[a-f0-9]{64}$/.test(token)) throw new VisualPipelineError('bad-request', 'taskId、attemptId 或 leaseToken 不合法', 400)
  const task = db.prepare('SELECT * FROM visual_asset_tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  const attempt = db.prepare('SELECT * FROM visual_asset_attempts WHERE id = ? AND task_id = ?').get(attemptId, taskId) as AttemptRow | undefined
  if (!task || !attempt) throw new VisualPipelineError('not-found', '视觉任务或 attempt 不存在', 404)
  if (task.state !== 'generating' || attempt.status !== 'generating' || Number(task.current_attempt) !== Number(attempt.attempt_no)) {
    throw new VisualPipelineError('invalid-state', '视觉任务不在当前 generating attempt')
  }
  if (!sameHash(task.lease_token_hash, token)) throw new VisualPipelineError('lease-invalid', '视觉任务租约无效', 409)
  if (task.lease_expires_at === null || task.lease_expires_at <= now.toISOString()) throw new VisualPipelineError('lease-expired', '视觉任务租约已过期', 409)
  return { task, attempt }
}

export function heartbeatVisualTask(
  db: DatabaseSync,
  taskId: string,
  attemptId: string,
  leaseToken: string,
  now = new Date(),
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): { taskId: string; attemptId: string; leaseExpiresAt: string } {
  const seconds = clampLeaseSeconds(leaseSeconds)
  const at = now.toISOString()
  const expires = new Date(now.getTime() + seconds * 1000).toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const { task, attempt } = activeLease(db, taskId, attemptId, leaseToken, now)
    db.prepare('UPDATE visual_asset_tasks SET lease_expires_at=?, updated_at=? WHERE id=?').run(expires, at, task.id)
    db.prepare('UPDATE workflow_jobs SET lease_expires_at=?, updated_at=? WHERE id=? AND status=?').run(expires, at, attempt.job_id, 'running')
    db.exec('COMMIT')
    return { taskId, attemptId, leaseExpiresAt: expires }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function finishWorkflowJob(db: DatabaseSync, jobId: string, status: 'failed' | 'waiting_approval', at: string, note: string, output?: unknown, error?: string): void {
  const current = db.prepare('SELECT status FROM workflow_jobs WHERE id = ?').get(jobId) as { status: string } | undefined
  if (!current || current.status !== 'running') throw new VisualPipelineError('job-state-conflict', '视觉 workflow job 不在 running 状态', 409)
  db.prepare(`
    UPDATE workflow_jobs SET status=?, output_json=?, error=?, worker_id=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND status='running'
  `).run(status, output === undefined ? null : JSON.stringify(output), error ?? null, at, jobId)
  db.prepare('INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)')
    .run(jobId, at, 'running', status, note)
}

export function failVisualTask(
  db: DatabaseSync,
  input: { taskId: string; attemptId: string; leaseToken: string; code: string; message: string; retryable: boolean },
  now = new Date(),
): { taskId: string; attemptId: string; state: 'retry' | 'failed' } {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(input.code) || input.message.trim() === '' || input.message.length > 2000) {
    throw new VisualPipelineError('bad-request', 'code 或 message 不合法', 400)
  }
  const at = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const { task, attempt } = activeLease(db, input.taskId, input.attemptId, input.leaseToken, now)
    const state: 'retry' | 'failed' = input.retryable && task.current_attempt < task.max_attempts ? 'retry' : 'failed'
    const error = `[${input.code}] ${input.message.trim()}`
    db.prepare(`UPDATE visual_asset_attempts SET status=?, validation_json=?, updated_at=? WHERE id=?`)
      .run(state, JSON.stringify({ ok: false, error: { code: input.code, message: input.message.trim(), retryable: input.retryable } }), at, attempt.id)
    db.prepare(`
      UPDATE visual_asset_tasks SET state=?, lease_token_hash=NULL, lease_expires_at=NULL, last_error=?, updated_at=? WHERE id=?
    `).run(state, error, at, task.id)
    finishWorkflowJob(db, attempt.job_id, 'failed', at, `visual attempt ${state}`, undefined, error)
    visualEvent(db, task.id, attempt.id, 'generating', state, error, at)
    refreshBatchStatus(db, task.batch_id, at)
    db.exec('COMMIT')
    return { taskId: task.id, attemptId: attempt.id, state }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function recoverExpiredVisualTasks(db: DatabaseSync, now = new Date()): { retried: number; failed: number } {
  const at = now.toISOString()
  let retried = 0
  let failed = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const rows = db.prepare(`
      SELECT * FROM visual_asset_tasks
      WHERE state='generating' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      ORDER BY id
    `).all(at) as unknown as TaskRow[]
    const batchIds = new Set<string>()
    for (const task of rows) {
      const attempt = db.prepare('SELECT * FROM visual_asset_attempts WHERE task_id=? AND attempt_no=?').get(task.id, task.current_attempt) as AttemptRow | undefined
      if (!attempt || attempt.status !== 'generating') continue
      const state: 'retry' | 'failed' = task.current_attempt < task.max_attempts ? 'retry' : 'failed'
      db.prepare(`UPDATE visual_asset_attempts SET status=?, validation_json=?, updated_at=? WHERE id=? AND status='generating'`)
        .run(state, JSON.stringify({ ok: false, error: { code: 'lease-expired', message: 'worker lease expired', retryable: state === 'retry' } }), at, attempt.id)
      db.prepare(`
        UPDATE visual_asset_tasks SET state=?, lease_token_hash=NULL, lease_expires_at=NULL, last_error=?, updated_at=?
        WHERE id=? AND state='generating'
      `).run(state, '[lease-expired] worker lease expired', at, task.id)
      finishWorkflowJob(db, attempt.job_id, 'failed', at, `visual attempt ${state}`, undefined, 'worker lease expired')
      visualEvent(db, task.id, attempt.id, 'generating', state, 'worker lease expired', at)
      batchIds.add(task.batch_id)
      if (state === 'retry') retried += 1
      else failed += 1
    }
    for (const batchId of batchIds) refreshBatchStatus(db, batchId, at)
    db.exec('COMMIT')
    return { retried, failed }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export interface VisualAttachmentReader {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>
}

export interface SubmitVisualInput {
  taskId: string
  attemptId: string
  leaseToken: string
  attachment: SubmittedAttachmentRef & Record<string, unknown>
  provider?: string
  model?: string
  sourceTool: string
  sourceCallId?: string
  promptEffective?: string
  negativePrompt?: string
  seedRequested?: number
  seedEffective?: boolean
  revisedPrompt?: string
  contentFilter?: string
  generatedAt?: string
}

function validateSubmittedAttachment(value: SubmittedAttachmentRef & Record<string, unknown>): void {
  const allowed = new Set(['attachmentId', 'mediaType', 'bytes', 'width', 'height', 'name'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new VisualPipelineError('bad-request', `attachment.${key} 不允许；禁止提交 path/URL/base64`, 400)
  if (!/^sha256:[a-f0-9]{64}$/.test(value.attachmentId)
    || typeof value.mediaType !== 'string'
    || !Number.isInteger(value.bytes) || value.bytes <= 0
    || !Number.isInteger(value.width) || value.width <= 0
    || !Number.isInteger(value.height) || value.height <= 0
    || (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 255))) {
    throw new VisualPipelineError('bad-request', 'attachment 必须是完整合法的 DSH 图片附件引用', 400)
  }
}

function signatureMediaType(data: Uint8Array): string | null {
  if (data.length >= 24 && Buffer.from(data.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp'
  if (data.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(data.subarray(0, 6)).toString('ascii'))) return 'image/gif'
  const prefix = Buffer.from(data.subarray(0, Math.min(data.length, 256))).toString('utf8').trimStart().toLowerCase()
  if (prefix.startsWith('<svg') || prefix.startsWith('<?xml')) return 'image/svg+xml'
  return null
}

function verifiedImage(input: SubmittedAttachmentRef, stored: StoredImageAttachment, task: TaskRow): { data: Buffer; sha: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; extension: 'png' | 'jpg' | 'webp'; validation: Record<string, unknown> } {
  const ref = stored.ref
  const declaredMatches = ref.attachmentId === input.attachmentId
    && ref.mediaType === input.mediaType
    && ref.bytes === input.bytes
    && ref.width === input.width
    && ref.height === input.height
    && (input.name === undefined || ref.name === input.name)
  if (!declaredMatches) throw new VisualPipelineError('attachment-metadata-mismatch', '提交的附件声明与附件服务验证结果不一致')
  if (ref.mediaType !== 'image/png' && ref.mediaType !== 'image/jpeg' && ref.mediaType !== 'image/webp') {
    throw new VisualPipelineError('unsupported-image', '只允许 PNG/JPEG/WebP；GIF/SVG 被拒绝')
  }
  const data = Buffer.from(stored.data)
  const sniffed = signatureMediaType(data)
  if (sniffed !== ref.mediaType) throw new VisualPipelineError('attachment-invalid', `图片签名与附件 MIME 不一致：${sniffed ?? 'unknown'} / ${ref.mediaType}`)
  if (data.byteLength !== ref.bytes) throw new VisualPipelineError('attachment-metadata-mismatch', '附件字节数与实际数据不一致')
  if (data.byteLength > MAX_IMAGE_BYTES) throw new VisualPipelineError('image-too-large', '图片超过 5MiB 上限')
  if (ref.width * ref.height > MAX_IMAGE_PIXELS) throw new VisualPipelineError('pixel-limit', '图片解码像素超过 40M 上限')
  if (ref.width !== task.target_width || ref.height !== task.target_height) {
    throw new VisualPipelineError('dimension-mismatch', `图片必须为 ${task.target_width}x${task.target_height}，实际 ${ref.width}x${ref.height}`)
  }
  const sha = sha256(data)
  if (ref.attachmentId !== `sha256:${sha}`) throw new VisualPipelineError('attachment-digest-mismatch', '附件 ID 与实际 SHA-256 不一致')
  const extension = ref.mediaType === 'image/png' ? 'png' : ref.mediaType === 'image/jpeg' ? 'jpg' : 'webp'
  return {
    data,
    sha,
    mediaType: ref.mediaType,
    extension,
    validation: {
      ok: true,
      mediaType: ref.mediaType,
      bytes: data.byteLength,
      width: ref.width,
      height: ref.height,
      pixels: ref.width * ref.height,
      sha256: sha,
      limits: { maxBytes: MAX_IMAGE_BYTES, maxPixels: MAX_IMAGE_PIXELS },
    },
  }
}

function ensureDirectoryNoSymlink(parent: string, name: string): string {
  const next = path.join(parent, name)
  if (existsSync(next)) {
    const info = lstatSync(next)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new VisualPipelineError('unsafe-path', '视觉资产目录包含 symlink 或非目录节点：' + next)
  } else {
    mkdirSync(next, { mode: 0o700 })
  }
  return next
}

function immutableDestination(task: TaskRow, attempt: AttemptRow, extension: string, sha: string): { absolute: string; relative: string } {
  const draft = task.package_id
  if (!PACKAGE_ID.test(draft) || !ASSET_ID.test(task.asset_id) || attempt.attempt_no < 1) throw new VisualPipelineError('unsafe-path', '视觉资产系统路径标识不合法')
  const created = task.created_at.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) throw new VisualPipelineError('unsafe-path', '视觉任务日期不合法')
  const root = path.resolve(VAULT_ROOT)
  if (lstatSync(root).isSymbolicLink()) throw new VisualPipelineError('unsafe-path', 'VAULT_ROOT 不得为 symlink')
  let dir = ensureDirectoryNoSymlink(root, 'visual')
  dir = ensureDirectoryNoSymlink(dir, 'factory')
  dir = ensureDirectoryNoSymlink(dir, created)
  dir = ensureDirectoryNoSymlink(dir, draft)
  dir = ensureDirectoryNoSymlink(dir, task.asset_id)
  dir = ensureDirectoryNoSymlink(dir, `attempt-${String(attempt.attempt_no).padStart(3, '0')}`)
  const canonicalRoot = realpathSync(root)
  const canonicalDir = realpathSync(dir)
  if (!canonicalDir.startsWith(canonicalRoot + path.sep)) throw new VisualPipelineError('unsafe-path', '视觉资产目录真实路径越界')
  const absolute = path.resolve(dir, `${sha.slice(0, 16)}.${extension}`)
  if (!absolute.startsWith(root + path.sep)) throw new VisualPipelineError('unsafe-path', '视觉资产目标路径越界')
  return { absolute, relative: path.relative(root, absolute) }
}

function persistImmutable(task: TaskRow, attempt: AttemptRow, data: Buffer, extension: string, sha: string): { relative: string; absolute: string; created: boolean } {
  const destination = immutableDestination(task, attempt, extension, sha)
  const otherFiles = readdirSync(path.dirname(destination.absolute)).filter((name) => !name.startsWith('.'))
  if (existsSync(destination.absolute)) {
    const info = lstatSync(destination.absolute)
    if (!info.isFile() || info.isSymbolicLink() || sha256(readFileSync(destination.absolute)) !== sha) {
      throw new VisualPipelineError('storage-conflict', '视觉资产目标已存在但内容不同', 409)
    }
    return { ...destination, created: false }
  }
  if (otherFiles.length > 0) throw new VisualPipelineError('storage-conflict', '同一 attempt 已存在不同视觉资产，拒绝覆盖', 409)
  const temporary = path.join(path.dirname(destination.absolute), `.${path.basename(destination.absolute)}-${randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, data)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    if (existsSync(destination.absolute)) throw new VisualPipelineError('storage-conflict', '视觉资产目标在提交期间被占用', 409)
    renameSync(temporary, destination.absolute)
    return { ...destination, created: true }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
    throw error
  }
}

function submissionResult(task: TaskRow, attempt: AttemptRow): SubmitVisualResult {
  return {
    taskId: task.id,
    attemptId: attempt.id,
    state: 'waiting_visual_approval',
    attachmentId: attempt.source_attachment_id!,
    relativePath: attempt.imported_relative_path!,
    sha256: attempt.imported_sha256!,
    mediaType: attempt.source_media_type!,
    bytes: Number(attempt.source_bytes),
    width: Number(attempt.source_width),
    height: Number(attempt.source_height),
  }
}

export interface SubmitVisualResult {
  taskId: string
  attemptId: string
  state: 'waiting_visual_approval'
  attachmentId: string
  relativePath: string
  sha256: string
  mediaType: string
  bytes: number
  width: number
  height: number
}

export async function submitVisualAttachment(
  db: DatabaseSync,
  attachments: VisualAttachmentReader | undefined,
  input: SubmitVisualInput,
  options: { now?: Date; signal?: AbortSignal } = {},
): Promise<SubmitVisualResult> {
  validateSubmittedAttachment(input.attachment)
  if (typeof input.sourceTool !== 'string' || !/^[a-z][a-z0-9_-]{1,63}$/.test(input.sourceTool)) throw new VisualPipelineError('bad-request', 'sourceTool 不合法', 400)
  if (input.seedRequested !== undefined && !Number.isSafeInteger(input.seedRequested)) throw new VisualPipelineError('bad-request', 'seedRequested 必须是安全整数', 400)
  if (input.generatedAt !== undefined && Number.isNaN(Date.parse(input.generatedAt))) throw new VisualPipelineError('bad-request', 'generatedAt 必须是合法时间', 400)
  const existingAttempt = db.prepare('SELECT * FROM visual_asset_attempts WHERE id=? AND task_id=?').get(input.attemptId, input.taskId) as AttemptRow | undefined
  const existingTask = db.prepare('SELECT * FROM visual_asset_tasks WHERE id=?').get(input.taskId) as TaskRow | undefined
  if (!existingAttempt || !existingTask) throw new VisualPipelineError('not-found', '视觉任务或 attempt 不存在', 404)
  if (existingAttempt.source_attachment_id !== null) {
    if (existingAttempt.source_attachment_id !== input.attachment.attachmentId) throw new VisualPipelineError('submission-conflict', '同一 attempt 已提交不同附件', 409)
    if (existingAttempt.status !== 'waiting_visual_approval') throw new VisualPipelineError('invalid-state', 'attempt 已有附件但状态不完整', 409)
    return submissionResult(existingTask, existingAttempt)
  }
  // 统一重试的正式替换路径：purpose=replace_stub_with_production 的重试要求新提交
  // 必须来自真实 Provider；仍是 stub 则直接拒绝（生产闸门同样继续拒绝 stub）。
  if (input.provider === 'stub') {
    const { latestRetryRequestForTask } = await import('./review.ts')
    const retryRequest = latestRetryRequestForTask(db, input.taskId)
    if (retryRequest !== null && (retryRequest as { purpose?: string }).purpose === 'replace_stub_with_production') {
      throw new VisualPipelineError('replace-stub-requires-production', '该任务按人工确认进入 replace_stub_with_production 重试，新提交不得再使用 stub 测试图', 422)
    }
  }
  const now = options.now ?? new Date()
  activeLease(db, input.taskId, input.attemptId, input.leaseToken, now)
  if (attachments === undefined) throw new VisualPipelineError('attachment-service-unavailable', 'DSH attachments 服务不可用，无法回读视觉附件', 503)
  let stored: StoredImageAttachment
  try {
    stored = await attachments.readImage(input.attachment as unknown as ImageAttachmentRef, options.signal)
  } catch (error) {
    throw new VisualPipelineError('attachment-invalid', 'DSH attachments 服务拒绝或无法读取该附件', 422, { cause: error })
  }
  const checkedAt = options.now ?? new Date()
  const before = activeLease(db, input.taskId, input.attemptId, input.leaseToken, checkedAt)
  const image = verifiedImage(input.attachment, stored, before.task)
  const at = checkedAt.toISOString()
  let persisted: { relative: string; absolute: string; created: boolean } | undefined
  db.exec('BEGIN IMMEDIATE')
  try {
    const { task, attempt } = activeLease(db, input.taskId, input.attemptId, input.leaseToken, checkedAt)
    persisted = persistImmutable(task, attempt, image.data, image.extension, image.sha)
    const generatedAt = input.generatedAt === undefined ? at : new Date(input.generatedAt).toISOString()
    db.prepare(`
      UPDATE visual_asset_attempts SET
        source_attachment_id=?, source_media_type=?, source_bytes=?, source_width=?, source_height=?,
        provider=?, model=?, source_tool=?, source_call_id=?, prompt_effective=?, negative_prompt=?,
        seed_requested=?, seed_effective=?, revised_prompt=?, content_filter=?, imported_relative_path=?,
        imported_sha256=?, validation_json=?, status='generated', generated_at=?, imported_at=?, updated_at=?
      WHERE id=? AND status='generating'
    `).run(
      stored.ref.attachmentId, image.mediaType, image.data.byteLength, stored.ref.width, stored.ref.height,
      input.provider ?? null, input.model ?? null, input.sourceTool, input.sourceCallId ?? null,
      input.promptEffective ?? null, input.negativePrompt ?? null, input.seedRequested ?? null,
      input.seedEffective === undefined ? null : input.seedEffective ? 1 : 0,
      input.revisedPrompt ?? null, input.contentFilter ?? null, persisted.relative, image.sha,
      JSON.stringify(image.validation), generatedAt, at, at, attempt.id,
    )
    db.prepare(`UPDATE visual_asset_tasks SET state='generated', lease_token_hash=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND state='generating'`)
      .run(at, task.id)
    visualEvent(db, task.id, attempt.id, 'generating', 'generated', 'verified attachment imported immutably', at)
    db.prepare(`UPDATE visual_asset_attempts SET status='waiting_visual_approval', updated_at=? WHERE id=? AND status='generated'`).run(at, attempt.id)
    db.prepare(`UPDATE visual_asset_tasks SET state='waiting_visual_approval', updated_at=? WHERE id=? AND state='generated'`).run(at, task.id)
    visualEvent(db, task.id, attempt.id, 'generated', 'waiting_visual_approval', 'M5A stops at human visual review gate', at)
    db.prepare(`
      INSERT INTO approvals(id, subject_kind, subject_id, decision, created_at)
      VALUES (?, 'visual_attempt', ?, 'pending', ?)
      ON CONFLICT(subject_kind, subject_id) DO NOTHING
    `).run(randomUUID(), attempt.id, at)
    finishWorkflowJob(db, attempt.job_id, 'waiting_approval', at, 'visual attachment waiting for human approval', {
      taskId: task.id, attemptId: attempt.id, attachmentId: stored.ref.attachmentId, sha256: image.sha,
    })
    refreshBatchStatus(db, task.batch_id, at)
    const finalTask = db.prepare('SELECT * FROM visual_asset_tasks WHERE id=?').get(task.id) as unknown as TaskRow
    const finalAttempt = db.prepare('SELECT * FROM visual_asset_attempts WHERE id=?').get(attempt.id) as unknown as AttemptRow
    db.exec('COMMIT')
    return submissionResult(finalTask, finalAttempt)
  } catch (error) {
    db.exec('ROLLBACK')
    if (persisted?.created === true) rmSync(persisted.absolute, { force: true })
    throw error
  }
}

/** M6.4 只读交付链接：返回该草稿包最新 manifest 交付包的下载端点；无则 null。 */
function latestDeliveryLink(db: DatabaseSync, packageId: string): string | null {
  const row = db.prepare(`
    SELECT id FROM visual_delivery_artifacts
    WHERE package_id=? AND platform='shared' AND format='manifest'
    ORDER BY version DESC LIMIT 1
  `).get(packageId) as { id: string } | undefined
  return row ? `/sparkos/visual/download?deliveryId=${row.id}` : null
}

export function visualStatus(db: DatabaseSync, packageId?: string): VisualStatusSnapshot {
  if (packageId !== undefined && !PACKAGE_ID.test(packageId)) throw new VisualPipelineError('bad-request', 'packageId 不合法', 400)
  const rows = (packageId === undefined
    ? db.prepare('SELECT * FROM visual_batches ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM visual_batches WHERE package_id=? ORDER BY created_at DESC').all(packageId)) as unknown as BatchRow[]
  return {
    batches: rows.map((row) => {
      const tasks = (db.prepare('SELECT * FROM visual_asset_tasks WHERE batch_id=? ORDER BY asset_id').all(row.id) as unknown as TaskRow[]).map((taskRow) => {
        const attempts = (db.prepare('SELECT * FROM visual_asset_attempts WHERE task_id=? ORDER BY attempt_no').all(taskRow.id) as unknown as AttemptRow[])
          .map((attemptRow) => ({ ...attemptFromRow(attemptRow), approval: attemptApproval(db, attemptRow.id) }))
        const current = attempts.find((attempt) => attempt.attemptNo === Number(taskRow.current_attempt)) ?? null
        const reviewNote = current?.approval?.note ?? taskRow.last_error
        const events = (db.prepare(`
          SELECT id, task_id, attempt_id, from_state, to_state, reason, created_at
          FROM visual_asset_events WHERE task_id=? ORDER BY id
        `).all(taskRow.id) as Array<{
          id: number; task_id: string; attempt_id: string | null; from_state: string | null
          to_state: string; reason: string | null; created_at: string
        }>).map((event) => ({
          id: Number(event.id), taskId: event.task_id, attemptId: event.attempt_id,
          fromState: event.from_state, toState: event.to_state, reason: event.reason, createdAt: event.created_at,
        }))
        return {
          ...taskFromRow(taskRow),
          state: logicalTaskState(db, taskRow.id, current?.id ?? null, taskRow.state),
          pipelineState: taskRow.state as Exclude<VisualTaskState, 'approved' | 'rejected'>,
          failureCount: attempts.filter((attempt) => attempt.status === 'failed' || attempt.status === 'retry').length,
          retryCount: attempts.filter((attempt) => attempt.status === 'retry').length,
          reviewNote,
          attempts,
          retry: visualRetryEligibility(db, taskRow.id),
          events,
        }
      })
      const pipelineCount = (state: Exclude<VisualTaskState, 'approved' | 'rejected'>): number => tasks.filter((task) => task.pipelineState === state).length
      const waiting = pipelineCount('waiting_visual_approval')
      const aggregate = visualReviewAggregate(db, row.id)
      const publication = publicationReadiness(db, row.id)
      return {
        ...batchFromRow(row), status: aggregate.status, approvedCount: aggregate.approvedCount, requiredCount: aggregate.requiredCount,
        // M6.4 只读交付下载链接（最新 manifest 交付包；无则 null）
        deliveryLink: latestDeliveryLink(db, row.package_id),
        // M6.6 最近发布任务台账（无则 null；只读展示，不自动发布）
        publishTask: latestPublishTask(db, row.package_id),
        tasks,
        readiness: {
          required: aggregate.requiredCount,
          queued: pipelineCount('queued') + pipelineCount('retry'),
          generating: pipelineCount('generating') + pipelineCount('generated'),
          waitingVisualApproval: waiting,
          failed: pipelineCount('failed'),
          readyForVisualApproval: tasks.length > 0 && waiting === tasks.length,
          ...publication,
        },
      }
    }),
  }
}

export function readVisualAsset(db: DatabaseSync, attemptId: string): { content: Buffer; mediaType: string; bytes: number; sha256: string } | null {
  if (!ATTEMPT_ID.test(attemptId)) return null
  const row = db.prepare(`
    SELECT a.imported_relative_path, a.imported_sha256, a.source_media_type, a.source_bytes, t.state
    FROM visual_asset_attempts a JOIN visual_asset_tasks t ON t.id=a.task_id WHERE a.id=?
  `).get(attemptId) as {
    imported_relative_path: string | null
    imported_sha256: string | null
    source_media_type: string | null
    source_bytes: number | null
    state: string
  } | undefined
  if (!row || row.imported_relative_path === null || row.imported_sha256 === null || row.source_media_type === null
    || !['waiting_visual_approval', 'approved', 'rejected'].includes(row.state)) return null
  const root = path.resolve(VAULT_ROOT)
  const absolute = path.resolve(root, row.imported_relative_path)
  if (!absolute.startsWith(root + path.sep)) return null
  try {
    const info = lstatSync(absolute)
    if (!info.isFile() || info.isSymbolicLink()) return null
    if (!realpathSync(absolute).startsWith(realpathSync(root) + path.sep)) return null
    const content = readFileSync(absolute)
    if (content.byteLength !== Number(row.source_bytes) || sha256(content) !== row.imported_sha256) return null
    return { content, mediaType: row.source_media_type, bytes: content.byteLength, sha256: row.imported_sha256 }
  } catch {
    return null
  }
}
