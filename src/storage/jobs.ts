/** Recoverable workflow job state machine. */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type JobStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancelled'

export interface WorkflowJob<TInput = Record<string, unknown>, TOutput = unknown> {
  id: string
  kind: string
  idempotencyKey: string | null
  status: JobStatus
  priority: number
  input: TInput
  output: TOutput | null
  error: string | null
  attempts: number
  maxAttempts: number
  runAfter: string
  workerId: string | null
  leaseExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

interface JobRow {
  id: string
  kind: string
  idempotency_key: string | null
  status: JobStatus
  priority: number
  input_json: string
  output_json: string | null
  error: string | null
  attempts: number
  max_attempts: number
  run_after: string
  worker_id: string | null
  lease_expires_at: string | null
  created_at: string
  updated_at: string
}

function fromRow(row: JobRow): WorkflowJob {
  return {
    id: row.id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    priority: Number(row.priority),
    input: JSON.parse(row.input_json) as Record<string, unknown>,
    output: row.output_json === null ? null : JSON.parse(row.output_json) as unknown,
    error: row.error,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: row.run_after,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function addEvent(db: DatabaseSync, jobId: string, from: JobStatus | null, to: JobStatus, note: string | null, at: string): void {
  db.prepare('INSERT INTO workflow_job_events(job_id, at, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)')
    .run(jobId, at, from, to, note)
}

export interface CreateJobInput {
  kind: string
  input?: Record<string, unknown>
  idempotencyKey?: string
  priority?: number
  maxAttempts?: number
  runAfter?: Date
  now?: Date
}

export function createJob(db: DatabaseSync, spec: CreateJobInput): { job: WorkflowJob; created: boolean } {
  if (spec.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM workflow_jobs WHERE idempotency_key = ?').get(spec.idempotencyKey) as JobRow | undefined
    if (existing) return { job: fromRow(existing), created: false }
  }
  const now = (spec.now ?? new Date()).toISOString()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO workflow_jobs(
      id, kind, idempotency_key, status, priority, input_json, attempts,
      max_attempts, run_after, created_at, updated_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?)
  `).run(
    id,
    spec.kind,
    spec.idempotencyKey ?? null,
    spec.priority ?? 0,
    JSON.stringify(spec.input ?? {}),
    spec.maxAttempts ?? 3,
    (spec.runAfter ?? spec.now ?? new Date()).toISOString(),
    now,
    now,
  )
  addEvent(db, id, null, 'queued', 'created', now)
  return { job: getJob(db, id)!, created: true }
}

export function getJob(db: DatabaseSync, id: string): WorkflowJob | null {
  const row = db.prepare('SELECT * FROM workflow_jobs WHERE id = ?').get(id) as JobRow | undefined
  return row ? fromRow(row) : null
}

export function listJobs(db: DatabaseSync, limit = 20): WorkflowJob[] {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
  return (db.prepare(`SELECT * FROM workflow_jobs ORDER BY created_at DESC LIMIT ${safeLimit}`).all() as unknown as JobRow[]).map(fromRow)
}

const ALLOWED: Record<JobStatus, ReadonlySet<JobStatus>> = {
  queued: new Set(['running', 'cancelled']),
  running: new Set(['queued', 'waiting_approval', 'succeeded', 'failed', 'cancelled']),
  waiting_approval: new Set(['queued', 'succeeded', 'cancelled']),
  succeeded: new Set(),
  failed: new Set(['queued', 'cancelled']),
  cancelled: new Set(),
}

export interface TransitionOptions {
  output?: unknown
  error?: string | null
  note?: string
  workerId?: string | null
  leaseExpiresAt?: string | null
  now?: Date
}

export function transitionJob(db: DatabaseSync, id: string, to: JobStatus, opts: TransitionOptions = {}): WorkflowJob {
  const current = getJob(db, id)
  if (!current) throw new Error('job not found: ' + id)
  if (!ALLOWED[current.status].has(to)) throw new Error(`invalid job transition: ${current.status} -> ${to}`)
  const at = (opts.now ?? new Date()).toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const updated = db.prepare(`
      UPDATE workflow_jobs
      SET status = ?, output_json = ?, error = ?, worker_id = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = ?
    `).run(
      to,
      opts.output === undefined ? null : JSON.stringify(opts.output),
      opts.error ?? null,
      opts.workerId ?? (to === 'running' ? current.workerId : null),
      opts.leaseExpiresAt ?? null,
      at,
      id,
      current.status,
    )
    // 条件 UPDATE 必须检查 changes：并发状态下 changes=0 时不得写入虚假 event。
    if (Number(updated.changes) !== 1) throw new Error(`job transition conflict: ${id} ${current.status} -> ${to}`)
    addEvent(db, id, current.status, to, opts.note ?? null, at)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getJob(db, id)!
}

export function claimNextJob(db: DatabaseSync, workerId: string, now = new Date(), leaseSeconds = 300): WorkflowJob | null {
  const nowIso = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    // 发布台账（kind='publish'，含历史 job）绝不进入可执行队列；Worker 只领取真实工作流任务。
    const row = db.prepare(`
      SELECT * FROM workflow_jobs
      WHERE status = 'queued' AND run_after <= ? AND attempts < max_attempts AND kind != 'publish'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(nowIso) as JobRow | undefined
    if (!row) {
      db.exec('COMMIT')
      return null
    }
    const lease = new Date(now.getTime() + Math.max(1, leaseSeconds) * 1000).toISOString()
    const updated = db.prepare(`
      UPDATE workflow_jobs
      SET status = 'running', attempts = attempts + 1, worker_id = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(workerId, lease, nowIso, row.id)
    if (Number(updated.changes) !== 1) throw new Error('job claim conflict: ' + row.id)
    addEvent(db, row.id, 'queued', 'running', 'claimed by ' + workerId, nowIso)
    db.exec('COMMIT')
    return getJob(db, row.id)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Claim a known queued job without racing another worker. */
export function startJob(db: DatabaseSync, id: string, workerId: string, now = new Date(), leaseSeconds = 300): WorkflowJob {
  const nowIso = now.toISOString()
  const lease = new Date(now.getTime() + Math.max(1, leaseSeconds) * 1000).toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare("SELECT * FROM workflow_jobs WHERE id = ? AND status = 'queued'").get(id) as JobRow | undefined
    if (!row) throw new Error('queued job not found: ' + id)
    if (row.attempts >= row.max_attempts) throw new Error('job attempts exhausted: ' + id)
    const updated = db.prepare(`
      UPDATE workflow_jobs
      SET status = 'running', attempts = attempts + 1, worker_id = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `).run(workerId, lease, nowIso, id)
    if (Number(updated.changes) !== 1) throw new Error('job start conflict: ' + id)
    addEvent(db, id, 'queued', 'running', 'started by ' + workerId, nowIso)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getJob(db, id)!
}

export function heartbeatJob(db: DatabaseSync, id: string, workerId: string, now = new Date(), leaseSeconds = 300): WorkflowJob {
  const lease = new Date(now.getTime() + Math.max(1, leaseSeconds) * 1000).toISOString()
  const result = db.prepare(`
    UPDATE workflow_jobs SET lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND worker_id = ?
  `).run(lease, now.toISOString(), id, workerId)
  if (Number(result.changes) !== 1) throw new Error('job lease not owned: ' + id)
  return getJob(db, id)!
}

/** Requeue expired jobs while attempts remain; otherwise mark them failed. */
export function recoverExpiredJobs(db: DatabaseSync, now = new Date()): { requeued: number; failed: number } {
  const rows = db.prepare(`
    SELECT * FROM workflow_jobs
    WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
  `).all(now.toISOString()) as unknown as JobRow[]
  let requeued = 0
  let failed = 0
  for (const row of rows) {
    const to: JobStatus = row.attempts < row.max_attempts ? 'queued' : 'failed'
    transitionJob(db, row.id, to, {
      error: to === 'failed' ? 'worker lease expired; attempts exhausted' : null,
      note: 'worker lease expired',
      now,
    })
    if (to === 'queued') requeued++
    else failed++
  }
  return { requeued, failed }
}
