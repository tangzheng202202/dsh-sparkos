/**
 * Daily intelligence ranking and persistence tracking.
 *
 * Ranking is deterministic and explainable. Agents supply structured evidence
 * and judgment; this module scores, persists and exposes the result.
 */

import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ClusterEvidence, EvidenceGrade, IntelCluster } from './cluster.ts'

export interface RankBreakdown {
  volume: number
  velocity: number
  sourceDiversity: number
  authority: number
  persistence: number
  audienceFit: number
  novelty: number
  knowledgeDepth: number
  originalJudgment: number
  riskPenalty: number
}

export interface RankedTopic {
  rank: number
  topicKey: string
  clusterId: string
  topic: string
  heatScore: number
  overallScore: number
  velocityScore: number
  verificationGrade: EvidenceGrade
  eligibleForCreation: boolean
  mentionCount: number
  sourceCount: number
  consecutiveTopDays: number
  breakdown: RankBreakdown
  evidenceUrls: string[]
  angleSuggestions: string[]
  judgment?: IntelCluster['judgment']
}

export interface DailyRanking {
  date: string
  generatedAt: string
  top5: RankedTopic[]
  rising: RankedTopic[]
  persistent: RankedTopic[]
  creationCandidates: RankedTopic[]
  all: RankedTopic[]
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.round(Math.max(min, Math.min(max, value)) * 100) / 100
}

function levelScore(level: IntelCluster['heat']): number {
  return level === 'high' ? 90 : level === 'medium' ? 60 : 30
}

function normalizeTopic(topic: string): string {
  return topic
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 160)
}

export function topicKeyOf(cluster: IntelCluster): string {
  if (cluster.topicKey && /^t-[a-z0-9][a-z0-9._-]{2,80}$/i.test(cluster.topicKey)) return cluster.topicKey
  const normalized = normalizeTopic(cluster.topic || cluster.clusterId)
  return 't-' + createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export function verificationGradeOf(evidence: ClusterEvidence[], fallbackUrls: string[] = []): EvidenceGrade {
  const all: ClusterEvidence[] = evidence.length > 0
    ? evidence
    : fallbackUrls.map((url) => ({ url, sourceType: 'unknown' as const, verified: false }))
  if (all.some((item) => item.contradicts === true)) return 'D'
  const verified = all.filter((item) => item.verified === true)
  if (verified.some((item) => item.sourceType === 'primary' || item.sourceType === 'official')) return 'A'
  const reliable = verified.filter((item) => item.sourceType !== 'social' && item.sourceType !== 'unknown')
  const groups = new Set(reliable.map((item) => item.independenceGroup || hostOf(item.url)))
  if (groups.size >= 2) return 'B'
  if (verified.length >= 1) return 'C'
  return 'D'
}

function previousRows(db: DatabaseSync, topicKey: string, date: string): Array<{
  snapshot_date: string
  rank: number
  mention_count: number
  heat_score: number
}> {
  return db.prepare(`
    SELECT snapshot_date, rank, mention_count, heat_score
    FROM topic_rank_snapshots
    WHERE topic_key = ? AND snapshot_date < ?
    ORDER BY snapshot_date DESC
    LIMIT 14
  `).all(topicKey, date) as Array<{ snapshot_date: string; rank: number; mention_count: number; heat_score: number }>
}

function dayBefore(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function consecutiveTopDays(history: Array<{ snapshot_date: string; rank: number }>, date: string): number {
  let expected = dayBefore(date)
  let count = 0
  for (const row of history) {
    if (row.snapshot_date !== expected || Number(row.rank) > 10) break
    count++
    expected = dayBefore(expected)
  }
  return count
}

function syncCluster(db: DatabaseSync, cluster: IntelCluster, date: string, topicKey: string, now: string): void {
  db.prepare(`
    INSERT INTO topic_clusters(
      topic_key, observed_date, cluster_id, topic, heat, novelty, credibility,
      source_count, mention_count, cluster_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic_key, observed_date) DO UPDATE SET
      cluster_id=excluded.cluster_id, topic=excluded.topic, heat=excluded.heat,
      novelty=excluded.novelty, credibility=excluded.credibility,
      source_count=excluded.source_count, mention_count=excluded.mention_count,
      cluster_json=excluded.cluster_json, updated_at=excluded.updated_at
  `).run(
    topicKey, date, cluster.clusterId, cluster.topic, cluster.heat, cluster.novelty,
    cluster.credibility, cluster.sourceCount, cluster.eventKeys.length,
    JSON.stringify(cluster), now,
  )
  db.prepare('DELETE FROM topic_evidence WHERE topic_key = ? AND observed_date = ?').run(topicKey, date)
  for (const item of cluster.evidence ?? []) {
    const id = createHash('sha256').update([topicKey, date, item.url, item.claim ?? ''].join('\u0000')).digest('hex')
    db.prepare(`
      INSERT INTO topic_evidence(
        id, topic_key, observed_date, url, claim, source_type, independence_group,
        verified, contradicts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, topicKey, date, item.url, item.claim ?? null, item.sourceType ?? 'unknown',
      item.independenceGroup || hostOf(item.url), item.verified === true ? 1 : 0,
      item.contradicts === true ? 1 : 0, now,
    )
  }
}

function scoreCluster(db: DatabaseSync, cluster: IntelCluster, date: string): Omit<RankedTopic, 'rank'> {
  const topicKey = topicKeyOf(cluster)
  const history = previousRows(db, topicKey, date)
  const previous = history[0]
  const mentions = cluster.eventKeys.length
  const streakBeforeToday = consecutiveTopDays(history, date)
  const volume = clamp(mentions * 20)
  const velocity = previous
    ? clamp(50 + ((mentions - Number(previous.mention_count)) / Math.max(1, Number(previous.mention_count))) * 50)
    : clamp(50 + Math.min(30, mentions * 5))
  const sourceDiversity = clamp((cluster.sourceCount / 3) * 100)
  const authority = clamp(cluster.sourceAuthorityScore ?? levelScore(cluster.credibility))
  const persistence = clamp((streakBeforeToday / 3) * 100)
  const audienceFit = clamp(cluster.audienceFitScore ?? (50 + Math.min(30, cluster.platforms.length * 10) + (cluster.knowledgeCards.length > 0 ? 10 : 0)))
  const novelty = levelScore(cluster.novelty)
  const knowledgeDepth = clamp(cluster.knowledgeCards.length * 15 + cluster.coreFacts.length * 10 + Math.min(30, cluster.evidenceUrls.length * 10))
  const originalJudgment = clamp(
    cluster.judgment?.editorialView
      ? 70 + Math.min(20, cluster.judgment.inferences.length * 5) + Math.min(10, cluster.judgment.counterArguments.length * 5)
      : 20,
  )
  const grade = verificationGradeOf(cluster.evidence ?? [], cluster.evidenceUrls)
  const riskPenalty = clamp(cluster.risks.length * 5 + (grade === 'C' ? 10 : grade === 'D' ? 30 : 0), 0, 40)
  const heatScore = clamp(
    volume * 0.25 + velocity * 0.20 + sourceDiversity * 0.15 + authority * 0.15 + persistence * 0.15 + audienceFit * 0.10,
  )
  const overallScore = clamp(
    heatScore * 0.30 + novelty * 0.20 + knowledgeDepth * 0.20 + audienceFit * 0.15 + originalJudgment * 0.15 - riskPenalty,
  )
  return {
    topicKey,
    clusterId: cluster.clusterId,
    topic: cluster.topic || '(待分析)',
    heatScore,
    overallScore,
    velocityScore: velocity,
    verificationGrade: grade,
    eligibleForCreation: grade === 'A' || grade === 'B',
    mentionCount: mentions,
    sourceCount: cluster.sourceCount,
    consecutiveTopDays: streakBeforeToday + 1,
    breakdown: {
      volume, velocity, sourceDiversity, authority, persistence, audienceFit,
      novelty, knowledgeDepth, originalJudgment, riskPenalty,
    },
    evidenceUrls: cluster.evidenceUrls,
    angleSuggestions: cluster.angleSuggestions,
    judgment: cluster.judgment,
  }
}

export function generateDailyRanking(db: DatabaseSync, clusters: IntelCluster[], date: string, now = new Date()): DailyRanking {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('ranking date must be YYYY-MM-DD')
  const nowIso = now.toISOString()
  // A stable topicKey is unique per day. If an agent submits duplicate clusters,
  // keep the richer one instead of failing the transaction on a primary key.
  const unique = new Map<string, IntelCluster>()
  for (const cluster of clusters.filter((item) => item.topic.trim() !== '')) {
    const key = topicKeyOf(cluster)
    const existing = unique.get(key)
    const richness = cluster.eventKeys.length + cluster.evidenceUrls.length + cluster.coreFacts.length
    const existingRichness = existing ? existing.eventKeys.length + existing.evidenceUrls.length + existing.coreFacts.length : -1
    if (!existing || richness > existingRichness) unique.set(key, cluster)
  }
  const selectedClusters = [...unique.values()]
  const candidates = selectedClusters
    .map((cluster) => scoreCluster(db, cluster, date))
    .sort((a, b) => b.heatScore - a.heatScore || b.overallScore - a.overallScore)
    .map((item, index) => ({ ...item, rank: index + 1 }))

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM topic_rank_snapshots WHERE snapshot_date = ?').run(date)
    for (const cluster of selectedClusters) {
      syncCluster(db, cluster, date, topicKeyOf(cluster), nowIso)
    }
    const insert = db.prepare(`
      INSERT INTO topic_rank_snapshots(
        snapshot_date, topic_key, cluster_id, topic, rank, heat_score, overall_score,
        velocity_score, mention_count, source_count, consecutive_top_days,
        verification_grade, eligible_for_creation, breakdown_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of candidates) {
      insert.run(
        date, item.topicKey, item.clusterId, item.topic, item.rank, item.heatScore,
        item.overallScore, item.velocityScore, item.mentionCount, item.sourceCount,
        item.consecutiveTopDays, item.verificationGrade,
        item.eligibleForCreation ? 1 : 0, JSON.stringify(item.breakdown), nowIso,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return {
    date,
    generatedAt: nowIso,
    top5: candidates.slice(0, 5),
    rising: [...candidates].sort((a, b) => b.velocityScore - a.velocityScore || a.rank - b.rank).slice(0, 5),
    persistent: candidates.filter((item) => item.consecutiveTopDays >= 2 || (item.rank <= 10 && item.consecutiveTopDays >= 3)),
    creationCandidates: [...candidates].filter((item) => item.eligibleForCreation).sort((a, b) => b.overallScore - a.overallScore).slice(0, 5),
    all: candidates,
  }
}

interface RankRow {
  snapshot_date: string
  topic_key: string
  cluster_id: string
  topic: string
  rank: number
  heat_score: number
  overall_score: number
  velocity_score: number
  mention_count: number
  source_count: number
  consecutive_top_days: number
  verification_grade: EvidenceGrade
  eligible_for_creation: number
  breakdown_json: string
  created_at: string
}

function rowToRanked(row: RankRow): RankedTopic {
  return {
    rank: Number(row.rank), topicKey: row.topic_key, clusterId: row.cluster_id, topic: row.topic,
    heatScore: Number(row.heat_score), overallScore: Number(row.overall_score), velocityScore: Number(row.velocity_score),
    verificationGrade: row.verification_grade, eligibleForCreation: Number(row.eligible_for_creation) === 1,
    mentionCount: Number(row.mention_count), sourceCount: Number(row.source_count),
    consecutiveTopDays: Number(row.consecutive_top_days), breakdown: JSON.parse(row.breakdown_json) as RankBreakdown,
    evidenceUrls: [], angleSuggestions: [],
  }
}

export function latestDailyRanking(db: DatabaseSync): DailyRanking | null {
  const latest = db.prepare('SELECT MAX(snapshot_date) AS date FROM topic_rank_snapshots').get() as { date: string | null }
  if (!latest.date) return null
  const rows = (db.prepare('SELECT * FROM topic_rank_snapshots WHERE snapshot_date = ? ORDER BY rank').all(latest.date) as unknown as RankRow[]).map(rowToRanked)
  return {
    date: latest.date,
    generatedAt: rows.length > 0
      ? String((db.prepare('SELECT MAX(created_at) AS at FROM topic_rank_snapshots WHERE snapshot_date = ?').get(latest.date) as { at: string }).at)
      : new Date().toISOString(),
    top5: rows.slice(0, 5),
    rising: [...rows].sort((a, b) => b.velocityScore - a.velocityScore || a.rank - b.rank).slice(0, 5),
    persistent: rows.filter((item) => item.consecutiveTopDays >= 2),
    creationCandidates: [...rows].filter((item) => item.eligibleForCreation).sort((a, b) => b.overallScore - a.overallScore).slice(0, 5),
    all: rows,
  }
}
