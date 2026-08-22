import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openFactoryDatabase } from '../src/storage/database.ts'
import { generateDailyRanking } from '../src/intel/ranking.ts'
import { decideEditorialCard, generateEditorialPlan, latestEditorialPlan } from '../src/editorial/planner.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'
import { editorialScheduleDue } from '../src/schedule.ts'

function cluster(date: string, seq: number, topicKey: string, topic: string, mentions: number, overrides: Partial<IntelCluster> = {}): IntelCluster {
  return {
    clusterId: `c-${date.replaceAll('-', '')}-${String(seq).padStart(3, '0')}`,
    topicKey, date: date.replaceAll('-', ''), topic, coreFacts: [`${topic} 已确认事实`],
    heat: 'high', novelty: 'high', sourceCount: 2,
    evidenceUrls: [`https://official.example/${topicKey}`],
    evidence: [{ url: `https://official.example/${topicKey}`, sourceType: 'official', independenceGroup: topicKey, verified: true }],
    knowledgeCards: [`obs://${topicKey}`], credibility: 'high', risks: [],
    platforms: ['wechat', 'x'], angleSuggestions: [`解释 ${topic} 的长期影响`],
    eventKeys: Array.from({ length: mentions }, (_, i) => `${topicKey}-${date}-${i}`),
    judgment: {
      confirmedFacts: [`${topic} 已确认事实`], inferences: [`${topic} 可能改变工作流`],
      editorialView: `${topic} 的关键不在单次发布，而在它带来的结构变化。`,
      counterArguments: ['短期热度可能高估长期影响'], uncertainties: ['落地速度仍待观察'],
    },
    ...overrides,
  }
}

function seedWeek() {
  const db = openFactoryDatabase({ path: ':memory:' })
  const dates = ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']
  for (let day = 0; day < dates.length; day++) {
    const date = dates[day]
    const clusters: IntelCluster[] = [
      cluster(date, 1, 't-persistent-ai', 'AI 内容工厂持续演进', 3 + day),
      cluster(date, 2, 't-open-models', '开源模型生态', 2 + day),
      cluster(date, 3, 't-ai-search', 'AI 搜索产品变化', 2 + day),
      cluster(date, 4, 't-creator-tools', '创作者工具升级', 2 + day),
    ]
    if (day >= 5) clusters.push(cluster(date, 5, 't-fast-agent', 'Agent 产品突然加速', day === 5 ? 1 : 6))
    clusters.push(cluster(date, 6, 't-rumor-only', '未核实传言', 8, { evidence: [], evidenceUrls: [], knowledgeCards: [] }))
    generateDailyRanking(db, clusters, date, new Date(date + 'T10:00:00Z'))
  }
  return db
}

test('midweek plan creates at most five traceable A/B cards and detects acceleration', () => {
  const db = seedWeek()
  const plan = generateEditorialPlan(db, 'midweek', '2026-08-22', new Date('2026-08-22T12:00:00Z'))
  assert.equal(plan.periodStart, '2026-08-19')
  assert.equal(plan.cards.length, 5)
  assert.ok(plan.cards.every((card) => card.verificationGrade === 'A' || card.verificationGrade === 'B'))
  assert.ok(plan.cards.every((card) => card.evidence.length > 0 && card.coreThesis.length > 0 && card.whyNow.length > 0))
  assert.equal(plan.cards.find((card) => card.topicKey === 't-fast-agent')?.trendPattern, 'accelerating')
  assert.ok(!plan.cards.some((card) => card.topicKey === 't-rumor-only'))
  assert.equal(generateEditorialPlan(db, 'midweek', '2026-08-22').id, plan.id, 'same window is idempotent')
  generateDailyRanking(db, [cluster('2026-08-22', 1, 't-persistent-ai', 'AI 内容工厂证据更新', 12)], '2026-08-22')
  assert.notEqual(generateEditorialPlan(db, 'midweek', '2026-08-22').id, plan.id, 'changed ranking input creates a traceable revision')
  db.close()
})

test('weekly plan recognizes structural topics and preserves counterarguments/knowledge links', () => {
  const db = seedWeek()
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-22')
  const structural = plan.cards.find((card) => card.topicKey === 't-persistent-ai')
  assert.equal(plan.periodStart, '2026-08-16')
  assert.equal(structural?.trendPattern, 'structural')
  assert.deepEqual(structural?.counterArguments, ['短期热度可能高估长期影响'])
  assert.deepEqual(structural?.knowledgeCards, ['obs://t-persistent-ai'])
  db.close()
})

test('editorial decisions update the common approval gate and finish the run', () => {
  const db = seedWeek()
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-22')
  for (const card of plan.cards) decideEditorialCard(db, card.id, 'approved', '进入创作')
  const latest = latestEditorialPlan(db, 'weekly')!
  assert.equal(latest.status, 'approved')
  assert.ok(latest.cards.every((card) => card.decision === 'approved' && card.decidedAt))
  const approvals = db.prepare("SELECT decision, note FROM approvals WHERE subject_kind = 'editorial_card'").all() as Array<{ decision: string; note: string }>
  assert.equal(approvals.length, plan.cards.length)
  assert.ok(approvals.every((row) => row.decision === 'approved' && row.note === '进入创作'))
  assert.throws(() => decideEditorialCard(db, 'bad-id', 'rejected'), /id 不合法/)
  db.close()
})

test('editorial schedule is only due at local Wednesday/Saturday 20:00', () => {
  assert.equal(editorialScheduleDue(new Date(2026, 7, 19, 20, 0)), 'midweek')
  assert.equal(editorialScheduleDue(new Date(2026, 7, 22, 20, 30)), 'weekly')
  assert.equal(editorialScheduleDue(new Date(2026, 7, 22, 19, 59)), null)
  assert.equal(editorialScheduleDue(new Date(2026, 7, 21, 20, 0)), null)
})

test('a window with no A/B evidence closes explicitly without an unresolvable approval wait', () => {
  const db = openFactoryDatabase({ path: ':memory:' })
  generateDailyRanking(db, [cluster('2026-08-22', 1, 't-rumor', '传言', 5, { evidence: [], evidenceUrls: [], knowledgeCards: [] })], '2026-08-22')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-22')
  assert.equal(plan.cards.length, 0)
  assert.equal(plan.status, 'archived')
  assert.match(plan.summary.note, /不.*补足|不用低可信/)
  db.close()
})
