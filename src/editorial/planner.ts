/**
 * Wednesday/Saturday editorial planning over explainable ranking history.
 *
 * This layer is deliberately deterministic: agents enrich intelligence clusters,
 * while the planner selects traceable A/B-grade candidates and opens a human gate.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ClusterEvidence, EvidenceGrade, IntelCluster } from '../intel/cluster.ts'

export type EditorialMode = 'midweek' | 'weekly'
export type TrendPattern = 'persistent' | 'accelerating' | 'resurfacing' | 'reversal' | 'structural' | 'emerging'
export type EditorialDecision = 'pending' | 'approved' | 'rejected'

export interface EditorialCard {
  id: string
  rank: number
  topicKey: string
  title: string
  trendPattern: TrendPattern
  coreThesis: string
  whyNow: string
  facts: string[]
  evidence: ClusterEvidence[]
  counterArguments: string[]
  knowledgeCards: string[]
  platforms: string[]
  contentFormat: string
  risks: string[]
  verificationGrade: 'A' | 'B'
  expectedValue: number
  decision: EditorialDecision
  decidedAt?: string
}

export interface EditorialPlan {
  id: string
  mode: EditorialMode
  periodStart: string
  periodEnd: string
  status: 'pending_approval' | 'approved' | 'archived'
  generatedAt: string
  summary: {
    windowDays: number
    rankedTopics: number
    evidenceEligible: number
    selected: number
    note: string
  }
  cards: EditorialCard[]
}

interface HistoryRow {
  snapshot_date: string
  topic_key: string
  topic: string
  rank: number
  heat_score: number
  overall_score: number
  velocity_score: number
  consecutive_top_days: number
  verification_grade: EvidenceGrade
  eligible_for_creation: number
  cluster_json: string
}

interface CardRow {
  id: string
  rank: number
  topic_key: string
  title: string
  trend_pattern: TrendPattern
  core_thesis: string
  why_now: string
  facts_json: string
  evidence_json: string
  counter_arguments_json: string
  knowledge_cards_json: string
  platforms_json: string
  content_format: string
  risks_json: string
  verification_grade: 'A' | 'B'
  expected_value: number
  decision: EditorialDecision
  decided_at: string | null
}

interface RunRow {
  id: string
  mode: EditorialMode
  period_start: string
  period_end: string
  input_fingerprint: string
  status: EditorialPlan['status']
  generated_at: string
  summary_json: string
}

function addDays(date: string, days: number): string {
  const value = new Date(date + 'T00:00:00Z')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function parseArray<T>(json: string): T[] {
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value) ? value as T[] : []
  } catch { return [] }
}

function parseCluster(json: string): IntelCluster {
  return JSON.parse(json) as IntelCluster
}

function reversalSignal(cluster: IntelCluster): boolean {
  if ((cluster.evidence ?? []).some((item) => item.contradicts === true)) return true
  const text = [
    ...(cluster.judgment?.uncertainties ?? []),
    ...(cluster.judgment?.counterArguments ?? []),
    ...cluster.risks,
  ].join(' ')
  return /(反转|辟谣|撤回|更正|争议|冲突|证伪|误读)/.test(text)
}

function trendOf(mode: EditorialMode, rows: HistoryRow[], cluster: IntelCluster): TrendPattern {
  const chronological = [...rows].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  const latest = chronological.at(-1)!
  const first = chronological[0]
  const spanDays = Math.round((Date.parse(latest.snapshot_date) - Date.parse(first.snapshot_date)) / 86400000) + 1
  const hasGap = chronological.length >= 2 && spanDays > chronological.length
  if (reversalSignal(cluster)) return 'reversal'
  if (mode === 'weekly' && chronological.length >= 4 && cluster.knowledgeCards.length > 0) return 'structural'
  if (latest.consecutive_top_days >= 3 || chronological.length >= 3) return 'persistent'
  if (latest.velocity_score >= 70 || latest.heat_score - first.heat_score >= 12) return 'accelerating'
  if (hasGap) return 'resurfacing'
  return 'emerging'
}

const WHY_NOW: Record<TrendPattern, string> = {
  persistent: '连续多日进入热榜，讨论尚未衰减，适合从“发生了什么”推进到“意味着什么”。',
  accelerating: '热度与传播速度正在抬升，当前发布能兼顾时效与信息完整度。',
  resurfacing: '话题在沉寂后重新升温，需要解释本轮回潮与上一轮的差异。',
  reversal: '事实或舆论出现分歧，读者需要证据边界、争议双方与仍未确认部分。',
  structural: '一周内持续出现且可连接既有知识卡，已从单点新闻演化为结构性议题。',
  emerging: '新议题刚形成可核验证据链，适合抢占清晰、克制的第一轮解读。',
}

const CONTENT_FORMAT: Record<TrendPattern, string> = {
  persistent: '纵深解读 / 时间线复盘',
  accelerating: '快评 + 关键事实卡',
  resurfacing: '前后对照 / 二次解读',
  reversal: '事实核查 / 双方观点拆解',
  structural: '框架长文 / 知识卡图解',
  emerging: '趋势速览 / 入门解释',
}

function thesisOf(cluster: IntelCluster): string {
  return cluster.judgment?.editorialView?.trim()
    || cluster.angleSuggestions[0]?.trim()
    || `围绕“${cluster.topic}”梳理已确认事实、影响边界与下一步观察点。`
}

function evidenceOf(cluster: IntelCluster): ClusterEvidence[] {
  if ((cluster.evidence ?? []).length > 0) return cluster.evidence ?? []
  return cluster.evidenceUrls.map((url) => ({ url, sourceType: 'unknown', verified: false }))
}

function expectedValue(rows: HistoryRow[], cluster: IntelCluster, pattern: TrendPattern): number {
  const latest = [...rows].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0]
  const patternBonus: Record<TrendPattern, number> = {
    structural: 12, persistent: 10, accelerating: 8, reversal: 7, resurfacing: 5, emerging: 3,
  }
  const judgmentBonus = cluster.judgment?.editorialView ? 5 : 0
  const knowledgeBonus = Math.min(6, cluster.knowledgeCards.length * 2)
  const riskPenalty = Math.min(15, cluster.risks.length * 3)
  return Math.round(Math.max(0, Math.min(100, latest.overall_score + patternBonus[pattern] + judgmentBonus + knowledgeBonus - riskPenalty)) * 100) / 100
}

function loadRows(db: DatabaseSync, start: string, end: string): HistoryRow[] {
  return db.prepare(`
    SELECT r.snapshot_date, r.topic_key, r.topic, r.rank, r.heat_score,
      r.overall_score, r.velocity_score, r.consecutive_top_days,
      r.verification_grade, r.eligible_for_creation, c.cluster_json
    FROM topic_rank_snapshots r
    JOIN topic_clusters c
      ON c.topic_key = r.topic_key AND c.observed_date = r.snapshot_date
    WHERE r.snapshot_date BETWEEN ? AND ?
    ORDER BY r.snapshot_date, r.rank
  `).all(start, end) as HistoryRow[]
}

export function editorialInputFingerprint(db: DatabaseSync, mode: EditorialMode, periodEnd: string): string {
  const windowDays = mode === 'midweek' ? 4 : 7
  const rows = loadRows(db, addDays(periodEnd, -(windowDays - 1)), periodEnd)
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)
}

function cardFromRow(row: CardRow): EditorialCard {
  return {
    id: row.id, rank: Number(row.rank), topicKey: row.topic_key, title: row.title,
    trendPattern: row.trend_pattern, coreThesis: row.core_thesis, whyNow: row.why_now,
    facts: parseArray<string>(row.facts_json), evidence: parseArray<ClusterEvidence>(row.evidence_json),
    counterArguments: parseArray<string>(row.counter_arguments_json),
    knowledgeCards: parseArray<string>(row.knowledge_cards_json), platforms: parseArray<string>(row.platforms_json),
    contentFormat: row.content_format, risks: parseArray<string>(row.risks_json),
    verificationGrade: row.verification_grade, expectedValue: Number(row.expected_value), decision: row.decision,
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
  }
}

function planFromRun(db: DatabaseSync, run: RunRow): EditorialPlan {
  const cards = (db.prepare('SELECT * FROM editorial_cards WHERE run_id = ? ORDER BY rank').all(run.id) as CardRow[]).map(cardFromRow)
  return {
    id: run.id, mode: run.mode, periodStart: run.period_start, periodEnd: run.period_end,
    status: run.status, generatedAt: run.generated_at,
    summary: JSON.parse(run.summary_json) as EditorialPlan['summary'], cards,
  }
}

export function generateEditorialPlan(
  db: DatabaseSync,
  mode: EditorialMode,
  periodEnd: string,
  now = new Date(),
): EditorialPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) throw new Error('editorial period end must be YYYY-MM-DD')
  const windowDays = mode === 'midweek' ? 4 : 7
  const periodStart = addDays(periodEnd, -(windowDays - 1))
  const rows = loadRows(db, periodStart, periodEnd)
  if (rows.length === 0) throw new Error(`选题窗口 ${periodStart}..${periodEnd} 暂无排名快照`)
  const inputFingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)
  const existing = db.prepare(`
    SELECT * FROM editorial_runs WHERE mode = ? AND period_end = ? AND input_fingerprint = ?
  `).get(mode, periodEnd, inputFingerprint) as RunRow | undefined
  if (existing) return planFromRun(db, existing)

  const grouped = new Map<string, HistoryRow[]>()
  for (const row of rows) grouped.set(row.topic_key, [...(grouped.get(row.topic_key) ?? []), row])
  const eligible = [...grouped.entries()].filter(([, history]) => {
    const latest = [...history].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0]
    return latest.eligible_for_creation === 1 && (latest.verification_grade === 'A' || latest.verification_grade === 'B')
  })

  const candidates = eligible.map(([topicKey, history]) => {
    const latest = [...history].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0]
    const cluster = parseCluster(latest.cluster_json)
    const pattern = trendOf(mode, history, cluster)
    const value = expectedValue(history, cluster, pattern)
    return { topicKey, history, latest, cluster, pattern, value }
  }).sort((a, b) => b.value - a.value || a.latest.rank - b.latest.rank).slice(0, 5)

  const generatedAt = now.toISOString()
  const runId = 'er-' + createHash('sha256').update(`${mode}:${periodEnd}:${inputFingerprint}`).digest('hex').slice(0, 16)
  const summary: EditorialPlan['summary'] = {
    windowDays,
    rankedTopics: grouped.size,
    evidenceEligible: eligible.length,
    selected: candidates.length,
    note: candidates.length < 5 ? `仅 ${candidates.length} 个话题通过 A/B 证据闸门，不用低可信话题补足名额。` : '5 个话题均通过 A/B 证据闸门，等待人工审批。',
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      INSERT INTO editorial_runs(id, mode, period_start, period_end, input_fingerprint, status, generated_at, summary_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, mode, periodStart, periodEnd, inputFingerprint, candidates.length === 0 ? 'archived' : 'pending_approval', generatedAt, JSON.stringify(summary))
    const insert = db.prepare(`
      INSERT INTO editorial_cards(
        id, run_id, rank, topic_key, title, trend_pattern, core_thesis, why_now,
        facts_json, evidence_json, counter_arguments_json, knowledge_cards_json,
        platforms_json, content_format, risks_json, verification_grade,
        expected_value, decision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `)
    const approval = db.prepare(`
      INSERT INTO approvals(id, subject_kind, subject_id, decision, created_at)
      VALUES (?, 'editorial_card', ?, 'pending', ?)
      ON CONFLICT(subject_kind, subject_id) DO NOTHING
    `)
    for (let index = 0; index < candidates.length; index++) {
      const item = candidates[index]
      const cardId = 'ec-' + createHash('sha256').update(`${runId}:${item.topicKey}`).digest('hex').slice(0, 16)
      insert.run(
        cardId, runId, index + 1, item.topicKey, item.cluster.topic, item.pattern,
        thesisOf(item.cluster), WHY_NOW[item.pattern], JSON.stringify(item.cluster.coreFacts),
        JSON.stringify(evidenceOf(item.cluster)), JSON.stringify(item.cluster.judgment?.counterArguments ?? []),
        JSON.stringify(item.cluster.knowledgeCards), JSON.stringify(item.cluster.platforms),
        CONTENT_FORMAT[item.pattern], JSON.stringify(item.cluster.risks), item.latest.verification_grade,
        item.value, generatedAt,
      )
      approval.run(randomUUID(), cardId, generatedAt)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return planFromRun(db, db.prepare('SELECT * FROM editorial_runs WHERE id = ?').get(runId) as RunRow)
}

export function latestEditorialPlan(db: DatabaseSync, mode?: EditorialMode): EditorialPlan | null {
  const run = (mode
    ? db.prepare('SELECT * FROM editorial_runs WHERE mode = ? ORDER BY period_end DESC, generated_at DESC LIMIT 1').get(mode)
    : db.prepare('SELECT * FROM editorial_runs ORDER BY period_end DESC, generated_at DESC LIMIT 1').get()) as RunRow | undefined
  return run ? planFromRun(db, run) : null
}

export function editorialCardById(db: DatabaseSync, cardId: string): EditorialCard | null {
  const row = db.prepare('SELECT * FROM editorial_cards WHERE id = ?').get(cardId) as CardRow | undefined
  return row ? cardFromRow(row) : null
}

export function decideEditorialCard(
  db: DatabaseSync,
  cardId: string,
  decision: Exclude<EditorialDecision, 'pending'>,
  note?: string,
  now = new Date(),
): EditorialCard {
  if (!/^ec-[a-f0-9]{16}$/.test(cardId)) throw new Error('选题卡 id 不合法')
  const row = db.prepare('SELECT run_id FROM editorial_cards WHERE id = ?').get(cardId) as { run_id: string } | undefined
  if (!row) throw new Error('选题卡不存在：' + cardId)
  const at = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE editorial_cards SET decision = ?, decided_at = ? WHERE id = ?').run(decision, at, cardId)
    db.prepare(`
      UPDATE approvals SET decision = ?, note = ?, decided_at = ?
      WHERE subject_kind = 'editorial_card' AND subject_id = ?
    `).run(decision, note ?? null, at, cardId)
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN decision = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN decision = 'approved' THEN 1 ELSE 0 END) AS approved
      FROM editorial_cards WHERE run_id = ?
    `).get(row.run_id) as { pending: number; approved: number }
    const status: EditorialPlan['status'] = Number(counts.pending) > 0
      ? 'pending_approval'
      : Number(counts.approved) > 0 ? 'approved' : 'archived'
    db.prepare('UPDATE editorial_runs SET status = ? WHERE id = ?').run(status, row.run_id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return cardFromRow(db.prepare('SELECT * FROM editorial_cards WHERE id = ?').get(cardId) as CardRow)
}
