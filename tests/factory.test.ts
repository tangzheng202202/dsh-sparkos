import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-factory-'))
const vault = path.join(root, 'vault')
const clustersDir = path.join(vault, 'ops-intel', 'clusters')
mkdirSync(clustersDir, { recursive: true })
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_DB_PATH = path.join(vault, 'data', 'factory.db')
process.env.SPARKOS_ALPHA_ARCHIVE = path.join(root, 'alpha')
process.env.SPARKOS_HERMES_ARCHIVE = path.join(root, 'hermes')

writeFileSync(path.join(clustersDir, 'clusters-20260822.json'), JSON.stringify([{
  clusterId: 'c-20260822-001', topicKey: 't-factory-integration', date: '20260822', topic: '内容工厂集成测试',
  coreFacts: ['事实'], heat: 'high', novelty: 'high', sourceCount: 2,
  evidenceUrls: ['https://official.example/item'],
  evidence: [{ url: 'https://official.example/item', sourceType: 'official', verified: true }],
  knowledgeCards: ['obs://001'], credibility: 'high', risks: [], platforms: ['wechat'],
  angleSuggestions: ['测试角度'], eventKeys: ['e1', 'e2'],
  judgment: { confirmedFacts: ['事实'], inferences: [], editorialView: '判断', counterArguments: [], uncertainties: [] },
}], null, 2))

after(() => rmSync(root, { recursive: true, force: true }))

test('factory service runs a tracked ranking job and reuses identical input', async () => {
  const { runLatestRanking, buildFactorySnapshot } = await import('../src/factory/service.ts')
  const first = runLatestRanking()
  assert.equal(first.reused, false)
  assert.equal(first.ranking.top5[0].topic, '内容工厂集成测试')
  const second = runLatestRanking()
  assert.equal(second.reused, true)
  assert.equal(second.jobId, first.jobId)
  const snapshot = buildFactorySnapshot()
  assert.equal(snapshot.jobs[0].status, 'succeeded')
  assert.equal(snapshot.database.jobs.succeeded, 1)
})
