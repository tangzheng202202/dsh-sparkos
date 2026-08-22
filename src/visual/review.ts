/** M5B human visual review, retry, aggregate status and publication gates. */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  PublicationReadiness,
  VisualAttemptApproval,
  VisualBatchStatus,
  VisualTaskState,
} from './types.ts'
import { VisualPipelineError } from './errors.ts'

const ATTEMPT_ID = /^va-[a-f0-9]{20}$/
const TASK_ID = /^vt-[a-f0-9]{20}$/

interface ReviewTaskRow {
  id: string
  batch_id: string
  package_id: string
  asset_id: string
  state: string
  current_attempt: number
  max_attempts: number
  last_error: string | null
}

interface ReviewAttemptRow {
  id: string
  task_id: string
  attempt_no: number
  status: string
  provider: string | null
  imported_relative_path: string | null
}

interface ApprovalRow {
  decision: VisualAttemptApproval['decision']
  note: string | null
  decided_at: string | null
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function attemptApproval(db: DatabaseSync, attemptId: string): VisualAttemptApproval {
  const row = db.prepare(`
    SELECT decision, note, decided_at FROM approvals
    WHERE subject_kind='visual_attempt' AND subject_id=?
  `).get(attemptId) as ApprovalRow | undefined
  return row
    ? { decision: row.decision, note: row.note, decidedAt: row.decided_at }
    : { decision: 'pending', note: null, decidedAt: null }
}

function requiredAssetIds(db: DatabaseSync, packageId: string): Set<string> {
  const row = db.prepare('SELECT contract_version, submission_json FROM draft_packages WHERE id=?').get(packageId) as {
    contract_version: number
    submission_json: string | null
  } | undefined
  const submission = parseJsonObject(row?.submission_json ?? null)
  const rawAssets = Array.isArray(submission?.assets) ? submission.assets : []
  const ids = rawAssets.flatMap((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
    const asset = raw as { id?: unknown; required?: unknown }
    if (typeof asset.id !== 'string') return []
    return Number(row?.contract_version ?? 1) >= 2 && asset.required === false ? [] : [asset.id]
  })
  return new Set(ids)
}

interface Aggregate {
  status: VisualBatchStatus
  approvedCount: number
  requiredCount: number
  rejectedCount: number
  visualApproved: boolean
  testOnly: boolean
}

export function visualReviewAggregate(db: DatabaseSync, batchId: string): Aggregate {
  const batch = db.prepare('SELECT package_id, status, required_count FROM visual_batches WHERE id=?').get(batchId) as {
    package_id: string
    status: VisualBatchStatus
    required_count: number
  } | undefined
  if (!batch) throw new VisualPipelineError('not-found', '视觉批次不存在', 404)
  const required = requiredAssetIds(db, batch.package_id)
  const rows = db.prepare(`
    SELECT t.asset_id, t.state, t.current_attempt, a.id AS attempt_id, a.provider, a.imported_relative_path,
           p.decision
    FROM visual_asset_tasks t
    LEFT JOIN visual_asset_attempts a ON a.task_id=t.id AND a.attempt_no=t.current_attempt
    LEFT JOIN approvals p ON p.subject_kind='visual_attempt' AND p.subject_id=a.id
    WHERE t.batch_id=? ORDER BY t.asset_id
  `).all(batchId) as Array<{
    asset_id: string
    state: string
    current_attempt: number
    attempt_id: string | null
    provider: string | null
    imported_relative_path: string | null
    decision: VisualAttemptApproval['decision'] | null
  }>
  const requiredRows = required.size === 0 ? rows : rows.filter((row) => required.has(row.asset_id))
  // A decision belongs to an immutable attempt. Once its task enters retry the
  // old decision remains audit history, but it must no longer decide the live
  // task or batch aggregate.
  const approvedCount = requiredRows.filter((row) => row.state === 'waiting_visual_approval' && row.decision === 'approved').length
  const rejectedCount = requiredRows.filter((row) => row.state === 'waiting_visual_approval' && row.decision === 'rejected').length
  const visualApproved = requiredRows.length > 0 && approvedCount === requiredRows.length
  const testOnly = rows.some((row) => row.imported_relative_path !== null && row.provider === 'stub')
  let status: VisualBatchStatus
  if (visualApproved) status = testOnly ? 'visual_approved_test' : 'visual_approved'
  else if (rejectedCount > 0) status = 'rejected'
  else if (approvedCount > 0) status = 'partially_approved'
  else status = batch.status
  return {
    status,
    approvedCount,
    requiredCount: requiredRows.length || Number(batch.required_count),
    rejectedCount,
    visualApproved,
    testOnly,
  }
}

function refreshStoredBatch(db: DatabaseSync, batchId: string, at: string): Aggregate {
  const aggregate = visualReviewAggregate(db, batchId)
  const storedStatus = aggregate.visualApproved ? 'approved'
    : aggregate.rejectedCount > 0 ? 'rejected'
      : aggregate.approvedCount > 0 ? 'waiting_visual_approval'
        : null
  if (storedStatus !== null) {
    db.prepare('UPDATE visual_batches SET status=?, approved_count=?, updated_at=? WHERE id=?')
      .run(storedStatus, aggregate.approvedCount, at, batchId)
  } else {
    db.prepare('UPDATE visual_batches SET approved_count=?, updated_at=? WHERE id=?')
      .run(aggregate.approvedCount, at, batchId)
  }
  return { ...aggregate, status: aggregate.visualApproved ? (aggregate.testOnly ? 'visual_approved_test' : 'visual_approved') : aggregate.status }
}

export interface VisualDecisionResult {
  taskId: string
  attemptId: string
  decision: 'approved' | 'rejected'
  note: string | null
  idempotent: boolean
  taskState: 'approved' | 'rejected'
  batchStatus: VisualBatchStatus
  approvedCount: number
  requiredCount: number
}

export function decideVisualAttempt(
  db: DatabaseSync,
  input: { attemptId: string; decision: 'approved' | 'rejected'; note?: string },
  now = new Date(),
): VisualDecisionResult {
  if (!ATTEMPT_ID.test(input.attemptId) || (input.decision !== 'approved' && input.decision !== 'rejected')) {
    throw new VisualPipelineError('bad-request', 'attemptId 或 decision 不合法', 400)
  }
  const note = input.note?.trim() || null
  if (note !== null && note.length > 2000) throw new VisualPipelineError('bad-request', 'note 不得超过 2000 字', 400)
  if (input.decision === 'rejected' && note === null) throw new VisualPipelineError('review-note-required', '驳回图片必须填写审核意见', 400)
  const joined = db.prepare(`
    SELECT t.*, a.id AS attempt_id, a.task_id AS attempt_task_id, a.attempt_no, a.status AS attempt_status,
           a.provider, a.imported_relative_path
    FROM visual_asset_attempts a JOIN visual_asset_tasks t ON t.id=a.task_id WHERE a.id=?
  `).get(input.attemptId) as (ReviewTaskRow & {
    attempt_id: string
    attempt_task_id: string
    attempt_no: number
    attempt_status: string
    provider: string | null
    imported_relative_path: string | null
  }) | undefined
  if (!joined) throw new VisualPipelineError('not-found', '视觉 attempt 不存在', 404)
  if (Number(joined.current_attempt) !== Number(joined.attempt_no)) throw new VisualPipelineError('not-current-attempt', '只能审核任务的当前 attempt', 409)
  const existing = attemptApproval(db, input.attemptId)
  if (existing.decision !== 'pending') {
    if (existing.decision !== input.decision) throw new VisualPipelineError('decision-conflict', '该 attempt 已有不同审核决定，拒绝覆盖', 409)
    const aggregate = visualReviewAggregate(db, joined.batch_id)
    return {
      taskId: joined.id, attemptId: joined.attempt_id, decision: input.decision,
      note: existing.note, idempotent: true, taskState: input.decision,
      batchStatus: aggregate.status, approvedCount: aggregate.approvedCount, requiredCount: aggregate.requiredCount,
    }
  }
  if (joined.state !== 'waiting_visual_approval' || joined.attempt_status !== 'waiting_visual_approval' || joined.imported_relative_path === null) {
    throw new VisualPipelineError('invalid-state', '视觉任务不在 waiting_visual_approval', 409)
  }
  const at = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      INSERT INTO approvals(id, subject_kind, subject_id, decision, note, created_at, decided_at)
      VALUES (?, 'visual_attempt', ?, ?, ?, ?, ?)
      ON CONFLICT(subject_kind, subject_id) DO UPDATE SET
        decision=excluded.decision, note=excluded.note, decided_at=excluded.decided_at
      WHERE approvals.decision='pending'
    `).run(randomUUID(), input.attemptId, input.decision, note, at, at)
    const stored = attemptApproval(db, input.attemptId)
    if (stored.decision !== input.decision) throw new VisualPipelineError('decision-conflict', '审核决定发生并发冲突', 409)
    db.prepare(`
      INSERT INTO visual_asset_events(task_id, attempt_id, from_state, to_state, reason, created_at)
      VALUES (?, ?, 'waiting_visual_approval', ?, ?, ?)
    `).run(joined.id, joined.attempt_id, input.decision, note ?? `human visual ${input.decision}`, at)
    const aggregate = refreshStoredBatch(db, joined.batch_id, at)
    db.exec('COMMIT')
    return {
      taskId: joined.id, attemptId: joined.attempt_id, decision: input.decision,
      note, idempotent: false, taskState: input.decision,
      batchStatus: aggregate.status, approvedCount: aggregate.approvedCount, requiredCount: aggregate.requiredCount,
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export interface VisualRetryResult {
  taskId: string
  previousAttemptId: string
  state: 'retry'
  previousNote: string
}

export function retryVisualTask(db: DatabaseSync, taskId: string, now = new Date()): VisualRetryResult {
  if (!TASK_ID.test(taskId)) throw new VisualPipelineError('bad-request', 'taskId 不合法', 400)
  const row = db.prepare(`
    SELECT t.*, a.id AS attempt_id, a.status AS attempt_status, p.decision, p.note AS review_note
    FROM visual_asset_tasks t
    LEFT JOIN visual_asset_attempts a ON a.task_id=t.id AND a.attempt_no=t.current_attempt
    LEFT JOIN approvals p ON p.subject_kind='visual_attempt' AND p.subject_id=a.id
    WHERE t.id=?
  `).get(taskId) as (ReviewTaskRow & {
    attempt_id: string | null
    attempt_status: string | null
    decision: VisualAttemptApproval['decision'] | null
    review_note: string | null
  }) | undefined
  if (!row || row.attempt_id === null) throw new VisualPipelineError('not-found', '视觉任务或当前 attempt 不存在', 404)
  if (row.decision === 'approved') throw new VisualPipelineError('approved-cannot-retry', '已批准视觉任务不得重试', 409)
  const rejectedNote = row.decision === 'rejected' ? row.review_note?.trim() : null
  const failedNote = row.state === 'failed' ? row.last_error?.trim() : null
  const previousNote = rejectedNote || failedNote
  if (!previousNote) throw new VisualPipelineError('retry-note-required', '只有带驳回或失败意见的任务可以重试', 409)
  if (row.decision !== 'rejected' && row.state !== 'failed') throw new VisualPipelineError('invalid-state', '只允许 rejected 或可恢复 failed 任务重试', 409)
  const at = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const updated = db.prepare(`
      UPDATE visual_asset_tasks SET state='retry', lease_token_hash=NULL, lease_expires_at=NULL,
        last_error=?, max_attempts=CASE WHEN max_attempts <= current_attempt THEN current_attempt + 1 ELSE max_attempts END,
        updated_at=? WHERE id=? AND current_attempt=?
    `).run(previousNote, at, row.id, row.current_attempt)
    if (Number(updated.changes) !== 1) throw new VisualPipelineError('retry-conflict', '视觉任务重试发生并发冲突', 409)
    db.prepare(`
      INSERT INTO visual_asset_events(task_id, attempt_id, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, 'retry', ?, ?)
    `).run(row.id, row.attempt_id, row.decision === 'rejected' ? 'rejected' : 'failed', previousNote, at)
    db.prepare("UPDATE visual_batches SET status='queued', updated_at=? WHERE id=?").run(at, row.batch_id)
    refreshStoredBatch(db, row.batch_id, at)
    db.exec('COMMIT')
    return { taskId: row.id, previousAttemptId: row.attempt_id, state: 'retry', previousNote }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function hasProductionDelivery(db: DatabaseSync, packageId: string, platform: 'wechat' | 'xiaohongshu'): boolean {
  const row = db.prepare(`
    SELECT 1 FROM visual_delivery_artifacts
    WHERE package_id=? AND mode='production' AND platform=? LIMIT 1
  `).get(packageId, platform)
  return row !== undefined
}

function contractV2Complete(db: DatabaseSync, packageId: string): { complete: boolean; legacy: boolean; missing: string[] } {
  const row = db.prepare('SELECT contract_version, submission_json FROM draft_packages WHERE id=?').get(packageId) as {
    contract_version: number
    submission_json: string | null
  } | undefined
  if (!row) return { complete: false, legacy: false, missing: ['draft-package-missing'] }
  const submission = parseJsonObject(row.submission_json)
  const assets = Array.isArray(submission?.assets) ? submission.assets.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item)) : []
  if (Number(row.contract_version) < 2) {
    return { complete: false, legacy: true, missing: ['legacy-contract-v1-cannot-prove-xiaohongshu-complete'] }
  }
  const missing: string[] = []
  if (!assets.some((asset) => asset.role === 'wechat-cover' && asset.required === true)) missing.push('wechat-cover')
  if (!assets.some((asset) => asset.role === 'wechat-inline' && asset.required === true)) missing.push('wechat-inline')
  if (!assets.some((asset) => asset.role === 'xhs-cover' && asset.required === true && asset.order === 1)) missing.push('xiaohongshu-order-1')
  if (!assets.some((asset) => asset.role === 'xhs-carousel' && asset.required === true && typeof asset.order === 'number' && asset.order >= 2)) missing.push('xiaohongshu-carousel-order-2+')
  return { complete: missing.length === 0, legacy: false, missing }
}

export function publicationReadiness(db: DatabaseSync, batchId: string): PublicationReadiness {
  const batch = db.prepare(`
    SELECT b.package_id, p.status AS package_status FROM visual_batches b
    JOIN draft_packages p ON p.id=b.package_id WHERE b.id=?
  `).get(batchId) as { package_id: string; package_status: string } | undefined
  if (!batch) throw new VisualPipelineError('not-found', '视觉批次不存在', 404)
  const aggregate = visualReviewAggregate(db, batchId)
  const contract = contractV2Complete(db, batch.package_id)
  const wechatDelivery = hasProductionDelivery(db, batch.package_id, 'wechat')
  const xhsDelivery = hasProductionDelivery(db, batch.package_id, 'xiaohongshu')
  const textApproved = batch.package_status === 'approved'
  const readyByPlatform = {
    wechat: textApproved && wechatDelivery && !aggregate.testOnly,
    telegram: textApproved,
    x: textApproved,
    xiaohongshu: textApproved && xhsDelivery && contract.complete && !aggregate.testOnly,
  }
  const blockers: string[] = []
  if (!textApproved) blockers.push('draft-package-not-approved')
  if (!aggregate.visualApproved) blockers.push('required-visual-assets-not-approved')
  if (aggregate.testOnly) blockers.push('stub-visual-assets-test-only')
  if (!wechatDelivery) blockers.push('wechat-production-delivery-missing')
  if (contract.legacy) blockers.push(...contract.missing)
  else if (!contract.complete) blockers.push(...contract.missing.map((item) => `contract-v2-missing:${item}`))
  if (!xhsDelivery) blockers.push('xiaohongshu-production-delivery-missing')
  const deliveryReady = textApproved && aggregate.visualApproved && !aggregate.testOnly && contract.complete
  const readyForPublication = !aggregate.testOnly && Object.values(readyByPlatform).every(Boolean)
  return {
    visualApproved: aggregate.visualApproved,
    testOnly: aggregate.testOnly,
    deliveryReady,
    readyByPlatform,
    readyForPublication,
    blockers: [...new Set(blockers)],
  }
}

export function logicalTaskState(db: DatabaseSync, taskId: string, attemptId: string | null, pipelineState: string): VisualTaskState {
  if (attemptId === null) return pipelineState as VisualTaskState
  const approval = attemptApproval(db, attemptId)
  return approval.decision === 'approved' || approval.decision === 'rejected'
    ? approval.decision
    : pipelineState as VisualTaskState
}
