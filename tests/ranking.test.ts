import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openFactoryDatabase } from '../src/storage/database.ts'
import { generateDailyRanking, latestDailyRanking, topicKeyOf, verificationGradeOf } from '../src/intel/ranking.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

function cluster(overrides: Partial<IntelCluster> = {}): IntelCluster {
  return {
    clusterId: 'c-20260820-001', date: '20260820', topic: 'AI Agent 内容工厂',
    coreFacts: ['事实1'], heat: 'high', novelty: 'high', sourceCount: 2,
    evidenceUrls: ['https://official.example/a', 'https://research.example/b'],
    evidence: [
      { url: 'https://official.example/a', sourceType: 'official', independenceGroup: 'official', verified: true },
      { url: 'https://research.example/b', sourceType: 'research', independenceGroup: 'research', verified: true },
    ],
    knowledgeCards: ['obs://001'], credibility: 'high', risks: [],
    platforms: ['wechat', 'telegram'], angleSuggestions: ['从工作流切入'],
    eventKeys: ['e1', 'e2', 'e3'],
    judgment: {
      confirmedFacts: ['事实1'], inferences: ['推断1'], editorialView: '独立判断',
      counterArguments: ['反方观点'], uncertainties: [],
    },
    ...overrides,
  }
}

test('cross verification grades primary as A, independent reliable sources as B, rumor as D', () => {
  assert.equal(verificationGradeOf([{ url: 'https://x/a', sourceType: 'official', verified: true }]), 'A')
  assert.equal(verificationGradeOf([
    { url: 'https://a.example/x', sourceType: 'media', independenceGroup: 'a', verified: true },
    { url: 'https://b.example/y', sourceType: 'research', independenceGroup: 'b', verified: true },
  ]), 'B')
  assert.equal(verificationGradeOf([{ url: 'https://social.example/x', sourceType: 'social' }]), 'D')
})

test('daily ranking persists top5 and only A/B topics enter creation candidates', () => {
  const db = openFactoryDatabase({ path: ':memory:' })
  const clusters = [
    cluster(),
    cluster({ clusterId: 'c-20260820-002', topic: '未核验传言', eventKeys: ['e4', 'e5', 'e6', 'e7'], evidence: [], evidenceUrls: [] }),
  ]
  const ranking = generateDailyRanking(db, clusters, '2026-08-20', new Date('2026-08-20T10:00:00Z'))
  assert.equal(ranking.top5.length, 2)
  assert.equal(ranking.creationCandidates.length, 1)
  assert.equal(ranking.creationCandidates[0].verificationGrade, 'A')
  assert.equal(latestDailyRanking(db)?.date, '2026-08-20')
  assert.match(topicKeyOf(clusters[0]), /^t-[a-f0-9]{16}$/)
  db.close()
})

test('consecutive daily top10 snapshots create a persistent leaderboard entry', () => {
  const db = openFactoryDatabase({ path: ':memory:' })
  const c1 = cluster({ topicKey: 't-agent-factory', clusterId: 'c-20260820-001' })
  const c2 = cluster({ topicKey: 't-agent-factory', clusterId: 'c-20260821-001', date: '20260821' })
  const c3 = cluster({ topicKey: 't-agent-factory', clusterId: 'c-20260822-001', date: '20260822' })
  generateDailyRanking(db, [c1], '2026-08-20')
  const day2 = generateDailyRanking(db, [c2], '2026-08-21')
  assert.equal(day2.persistent[0].consecutiveTopDays, 2)
  const day3 = generateDailyRanking(db, [c3], '2026-08-22')
  assert.equal(day3.persistent[0].consecutiveTopDays, 3)
  db.close()
})
