import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { databaseHealth, openFactoryDatabase } from '../src/storage/database.ts'
import {
  claimNextJob,
  createJob,
  getJob,
  heartbeatJob,
  recoverExpiredJobs,
  transitionJob,
} from '../src/storage/jobs.ts'

test('SQLite migration is idempotent and creates the factory schema', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkos-db-'))
  const file = path.join(root, 'sparkos.db')
  const first = openFactoryDatabase({ path: file })
  assert.equal(databaseHealth(first, file).schemaVersion, 2)
  first.close()
  const second = openFactoryDatabase({ path: file })
  assert.equal(databaseHealth(second, file).schemaVersion, 2)
  const tables = second.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
  assert.ok(tables.some((row) => row.name === 'workflow_jobs'))
  assert.ok(tables.some((row) => row.name === 'topic_rank_snapshots'))
  assert.ok(tables.some((row) => row.name === 'editorial_runs'))
  assert.ok(tables.some((row) => row.name === 'editorial_cards'))
  second.close()
  rmSync(root, { recursive: true, force: true })
})

test('job idempotency, claim, heartbeat and valid transitions', () => {
  const db = openFactoryDatabase({ path: ':memory:' })
  const now = new Date('2026-08-22T10:00:00Z')
  const first = createJob(db, { kind: 'intel.rank', input: { date: '2026-08-22' }, idempotencyKey: 'rank:2026-08-22', now })
  const again = createJob(db, { kind: 'intel.rank', idempotencyKey: 'rank:2026-08-22', now })
  assert.equal(first.created, true)
  assert.equal(again.created, false)
  assert.equal(first.job.id, again.job.id)

  const claimed = claimNextJob(db, 'worker-1', now, 60)!
  assert.equal(claimed.status, 'running')
  assert.equal(claimed.attempts, 1)
  const heartbeat = heartbeatJob(db, claimed.id, 'worker-1', new Date('2026-08-22T10:00:30Z'), 60)
  assert.equal(heartbeat.leaseExpiresAt, '2026-08-22T10:01:30.000Z')
  const done = transitionJob(db, claimed.id, 'succeeded', { output: { count: 5 }, now: new Date('2026-08-22T10:00:40Z') })
  assert.equal(done.status, 'succeeded')
  assert.deepEqual(done.output, { count: 5 })
  assert.throws(() => transitionJob(db, done.id, 'running'), /invalid job transition/)
  db.close()
})

test('expired worker leases are requeued, then failed when attempts are exhausted', () => {
  const db = openFactoryDatabase({ path: ':memory:' })
  const t0 = new Date('2026-08-22T10:00:00Z')
  const created = createJob(db, { kind: 'intel.rank', maxAttempts: 2, now: t0 }).job
  claimNextJob(db, 'worker-1', t0, 10)
  assert.deepEqual(recoverExpiredJobs(db, new Date('2026-08-22T10:00:11Z')), { requeued: 1, failed: 0 })
  assert.equal(getJob(db, created.id)?.status, 'queued')
  claimNextJob(db, 'worker-2', new Date('2026-08-22T10:00:12Z'), 10)
  assert.deepEqual(recoverExpiredJobs(db, new Date('2026-08-22T10:00:23Z')), { requeued: 0, failed: 1 })
  assert.equal(getJob(db, created.id)?.status, 'failed')
  db.close()
})
