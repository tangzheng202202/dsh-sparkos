import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

function treeSnapshot(dir: string): Array<[string, 'dir' | 'file', number, number, string]> {
  if (!existsSync(dir)) return []
  const rows: Array<[string, 'dir' | 'file', number, number, string]> = []
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolute = path.join(current, name)
      const relative = path.relative(dir, absolute)
      const stat = statSync(absolute)
      if (stat.isDirectory()) {
        rows.push([relative, 'dir', stat.size, stat.mtimeMs, ''])
        walk(absolute)
      } else {
        rows.push([relative, 'file', stat.size, stat.mtimeMs, readFileSync(absolute).toString('base64')])
      }
    }
  }
  walk(dir)
  return rows
}

test('factory service tracks ranking and editorial approval jobs idempotently', async () => {
  const { runLatestRanking, runEditorialPlanning, reviewEditorialCard, buildFactorySnapshot } = await import('../src/factory/service.ts')
  const first = runLatestRanking()
  assert.equal(first.reused, false)
  assert.equal(first.ranking.top5[0].topic, '内容工厂集成测试')
  const second = runLatestRanking()
  assert.equal(second.reused, true)
  assert.equal(second.jobId, first.jobId)
  const editorial = runEditorialPlanning('weekly', '2026-08-22')
  assert.equal(editorial.plan.cards.length, 1)
  assert.equal(editorial.plan.status, 'pending_approval')
  assert.equal(runEditorialPlanning('weekly', '2026-08-22').reused, true)
  reviewEditorialCard(editorial.plan.cards[0].id, 'approved')
  const snapshot = buildFactorySnapshot()
  assert.equal(snapshot.editorial?.status, 'approved')
  assert.equal(snapshot.jobs.find((job) => job.kind === 'editorial.weekly')?.status, 'succeeded')
  assert.equal(snapshot.jobs.find((job) => job.kind === 'content.generate-package')?.status, 'queued')
  assert.equal(snapshot.drafts.length, 1)
  assert.equal(snapshot.drafts[0].status, 'awaiting_generation')
  assert.equal(snapshot.database.jobs.succeeded, 2)
  assert.equal(snapshot.database.jobs.queued, 1)
})

test('intel dryRun validates submitCluster and leaves every VAULT file, content and mtime unchanged', async () => {
  const { registerRunTool } = await import('../src/tools/run.ts')
  let execute: ((args: { action: string; dryRun: boolean; payload: Record<string, unknown> }) => Promise<{ text: string }>) | undefined
  registerRunTool({
    tools: {
      register(definition: { execute: typeof execute }) {
        execute = definition.execute
        return () => undefined
      },
    },
  } as never)
  assert.ok(execute)
  const cluster = JSON.parse(readFileSync(path.join(clustersDir, 'clusters-20260822.json'), 'utf8'))[0] as Record<string, unknown>
  const before = treeSnapshot(vault)
  const valid = await execute!({
    action: 'intel',
    dryRun: true,
    payload: { fusion: true, analyze: true, clusters: true, submitCluster: cluster, rank: true, jobs: true, dispatch: true },
  })
  assert.match(valid.text, /未执行 runIntelTick/)
  assert.match(valid.text, /实际执行时将运行/)
  assert.match(valid.text, /submit-cluster 校验通过/)
  assert.deepEqual(treeSnapshot(vault), before, '合法 submitCluster dryRun 必须零写入')

  const invalid = await execute!({ action: 'intel', dryRun: true, payload: { submitCluster: {} } })
  assert.match(invalid.text, /submit-cluster 校验失败/)
  assert.deepEqual(treeSnapshot(vault), before, '非法 submitCluster dryRun 也必须零写入')
})
