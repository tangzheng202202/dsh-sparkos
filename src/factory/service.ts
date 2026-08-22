/** Factory orchestration façade used by tools and the workbench. */

import { createHash } from 'node:crypto'
import { databaseHealth, defaultFactoryDbPath, openFactoryDatabase } from '../storage/database.ts'
import { createJob, listJobs, recoverExpiredJobs, startJob, transitionJob } from '../storage/jobs.ts'
import { latestClusters } from '../intel/cluster.ts'
import { defaultIntelConfig } from '../intel/ingest.ts'
import { generateDailyRanking, latestDailyRanking } from '../intel/ranking.ts'
import type { DailyRanking } from '../intel/ranking.ts'
import { decideEditorialCard, editorialInputFingerprint, generateEditorialPlan, latestEditorialPlan } from '../editorial/planner.ts'
import type { EditorialDecision, EditorialMode, EditorialPlan } from '../editorial/planner.ts'
import {
  decideDraftPackage,
  ensureDraftRequest,
  listDraftPackageSummaries,
  pendingDraftRequests,
  reviseDraftRequest,
  submitDraftPackage,
} from '../creation/drafts.ts'
import type { DraftSubmission } from '../creation/drafts.ts'
import { visualStatus } from '../visual/service.ts'

function dateFromStamp(stamp: string): string {
  return stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8)
}

export function runLatestRanking(): { ranking: DailyRanking; jobId: string; reused: boolean } {
  const latest = latestClusters(defaultIntelConfig())
  if (!latest || latest.clusters.length === 0) throw new Error('暂无已分析情报簇：先执行 intel analyze 并 submitCluster')
  const date = dateFromStamp(latest.date)
  const fingerprint = createHash('sha256').update(JSON.stringify(latest.clusters)).digest('hex').slice(0, 12)
  const db = openFactoryDatabase()
  try {
    recoverExpiredJobs(db)
    const created = createJob(db, {
      kind: 'intel.daily-ranking',
      input: { date, clusters: latest.clusters.length },
      idempotencyKey: `intel.daily-ranking:${date}:${fingerprint}`,
      priority: 50,
    })
    if (!created.created && created.job.status === 'succeeded') {
      const ranking = latestDailyRanking(db)
      if (!ranking) throw new Error('排名任务已完成但数据库无排名快照')
      return { ranking, jobId: created.job.id, reused: true }
    }
    if (!created.created && created.job.status === 'failed') {
      transitionJob(db, created.job.id, 'queued', { note: 'manual retry' })
    }
    const started = startJob(db, created.job.id, 'sparkos-inline')
    try {
      const ranking = generateDailyRanking(db, latest.clusters, date)
      transitionJob(db, started.id, 'succeeded', {
        output: {
          top5: ranking.top5.length,
          persistent: ranking.persistent.length,
          creationCandidates: ranking.creationCandidates.length,
        },
      })
      return { ranking, jobId: started.id, reused: false }
    } catch (error) {
      transitionJob(db, started.id, 'failed', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  } finally {
    db.close()
  }
}

export function runEditorialPlanning(
  mode: EditorialMode,
  periodEnd?: string,
): { plan: EditorialPlan; jobId: string; reused: boolean } {
  const db = openFactoryDatabase()
  try {
    recoverExpiredJobs(db)
    const latest = db.prepare('SELECT MAX(snapshot_date) AS date FROM topic_rank_snapshots').get() as { date: string | null }
    const end = periodEnd ?? latest.date
    if (!end) throw new Error('暂无每日排名：先完成情报簇分析并执行 intel rank')
    const fingerprint = editorialInputFingerprint(db, mode, end)
    const created = createJob(db, {
      kind: `editorial.${mode}`,
      input: { mode, periodEnd: end },
      idempotencyKey: `editorial.${mode}:${end}:${fingerprint}`,
      priority: 40,
    })
    if (!created.created && (created.job.status === 'succeeded' || created.job.status === 'waiting_approval')) {
      const plan = generateEditorialPlan(db, mode, end)
      return { plan, jobId: created.job.id, reused: true }
    }
    if (!created.created && created.job.status === 'failed') transitionJob(db, created.job.id, 'queued', { note: 'manual retry' })
    const started = startJob(db, created.job.id, 'sparkos-inline')
    try {
      const plan = generateEditorialPlan(db, mode, end)
      transitionJob(db, started.id, plan.cards.length === 0 ? 'succeeded' : 'waiting_approval', {
        output: { runId: plan.id, selected: plan.cards.length, periodEnd: plan.periodEnd },
      })
      return { plan, jobId: started.id, reused: false }
    } catch (error) {
      transitionJob(db, started.id, 'failed', { error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  } finally {
    db.close()
  }
}

export function reviewEditorialCard(
  cardId: string,
  decision: Exclude<EditorialDecision, 'pending'>,
  note?: string,
): ReturnType<typeof decideEditorialCard> {
  const db = openFactoryDatabase()
  try {
    const card = decideEditorialCard(db, cardId, decision, note)
    if (decision === 'approved') ensureDraftRequest(db, cardId)
    const run = db.prepare(`
      SELECT r.id, r.status FROM editorial_runs r
      JOIN editorial_cards c ON c.run_id = r.id WHERE c.id = ?
    `).get(cardId) as { id: string; status: EditorialPlan['status'] }
    if (run.status !== 'pending_approval') {
      const job = db.prepare(`
        SELECT id FROM workflow_jobs
        WHERE status = 'waiting_approval' AND json_extract(output_json, '$.runId') = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(run.id) as { id: string } | undefined
      if (job) transitionJob(db, job.id, 'succeeded', { note: `editorial run ${run.status}` })
    }
    return card
  } finally {
    db.close()
  }
}

export function requestDraftPackage(cardId: string): ReturnType<typeof ensureDraftRequest> {
  const db = openFactoryDatabase()
  try { return ensureDraftRequest(db, cardId) } finally { db.close() }
}

export function requestDraftRevision(packageId: string): ReturnType<typeof reviseDraftRequest> {
  const db = openFactoryDatabase()
  try { return reviseDraftRequest(db, packageId) } finally { db.close() }
}

export function listPendingDraftRequests(limit = 10): ReturnType<typeof pendingDraftRequests> {
  const db = openFactoryDatabase()
  try { return pendingDraftRequests(db, limit) } finally { db.close() }
}

export function runDraftSubmission(submission: DraftSubmission): ReturnType<typeof submitDraftPackage> {
  const db = openFactoryDatabase()
  try { return submitDraftPackage(db, submission) } finally { db.close() }
}

export function reviewDraftPackage(packageId: string, decision: 'approved' | 'rejected', note?: string): ReturnType<typeof decideDraftPackage> {
  const db = openFactoryDatabase()
  try { return decideDraftPackage(db, packageId, decision, note) } finally { db.close() }
}

export interface FactorySnapshot {
  database: ReturnType<typeof databaseHealth>
  jobs: ReturnType<typeof listJobs>
  ranking: DailyRanking | null
  editorial: EditorialPlan | null
  drafts: ReturnType<typeof listDraftPackageSummaries>
  visual: ReturnType<typeof visualStatus>
}

export function buildFactorySnapshot(): FactorySnapshot {
  const dbPath = defaultFactoryDbPath()
  const db = openFactoryDatabase({ path: dbPath })
  try {
    return {
      database: databaseHealth(db, dbPath),
      jobs: listJobs(db, 10),
      ranking: latestDailyRanking(db),
      editorial: latestEditorialPlan(db),
      drafts: listDraftPackageSummaries(db, 10),
      visual: visualStatus(db),
    }
  } finally {
    db.close()
  }
}
