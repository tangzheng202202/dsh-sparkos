/** brief mode rejects factory tools before VAULT initialization or SQLite access. */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'sparkos-mode-tools-'))
const vault = join(root, 'vault')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_DB_PATH = join(vault, 'data', 'sparkos.db')
process.env.SPARKOS_ALPHA_ARCHIVE = join(root, 'alpha-archive')
process.env.SPARKOS_HERMES_ARCHIVE = join(root, 'hermes-archive')
delete process.env.SPARKOS_WORKBENCH_MODE
after(() => rmSync(root, { recursive: true, force: true }))

const { runSparkosCommand } = await import('../src/tools/run.ts')
const { registerVisualTools } = await import('../src/tools/visual.ts')
const { factoryEnabled } = await import('../src/server/mode.ts')

test('default brief mode rejects mixed factory calls and dry runs without creating VAULT data', async () => {
  assert.equal(factoryEnabled(), false)
  const calls = [
    { action: 'topics', payload: { editorial: 'midweek' } },
    { action: 'draft', payload: { request: 'dp-1111111111111111' } },
    { action: 'draft', payload: { revise: 'dp-1111111111111111' } },
    { action: 'draft', payload: { submitPackage: {} } },
    { action: 'draft', payload: { pending: true } },
    { action: 'draft', payload: { packages: true } },
    { action: 'intel', payload: { fusion: true, rank: true } },
    { action: 'intel', payload: { jobs: true } },
  ]
  for (const call of calls) {
    for (const dryRun of [false, true]) {
      const result = await runSparkosCommand({ ...call, dryRun })
      assert.match(result.text, /factory-disabled/, JSON.stringify(call))
      assert.equal(existsSync(vault), false, JSON.stringify(call) + ' must not initialize VAULT')
      assert.equal(existsSync(process.env.SPARKOS_DB_PATH!), false)
    }
  }
  const permitted = await runSparkosCommand({ action: 'brief', dryRun: true })
  assert.match(permitted.text, /\[dryRun\]/)
  assert.equal(existsSync(vault), false)
})

test('all seven visual tools reject brief mode before opening the factory database', async () => {
  const definitions: Array<{ name: string; execute: (args: never, execution?: never) => Promise<{ value: { ok: boolean; error?: { code: string } } }> }> = []
  registerVisualTools({ tools: { register(definition: unknown) { definitions.push(definition as typeof definitions[number]) } } } as never)
  assert.equal(definitions.length, 7)
  const argumentsByName: Record<string, Record<string, unknown>> = {
    sparkos_visual_queue: { packageId: 'dp-1111111111111111' },
    sparkos_visual_claim: {},
    sparkos_visual_heartbeat: { taskId: 'vt-1', attemptId: 'va-1', leaseToken: 'test-token' },
    sparkos_visual_fail: { taskId: 'vt-1', attemptId: 'va-1', leaseToken: 'test-token', code: 'test', message: 'test', retryable: true },
    sparkos_visual_submit: { taskId: 'vt-1', attemptId: 'va-1', leaseToken: 'test-token', attachment: { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, sourceTool: 'image_generate' },
    sparkos_visual_retry: { taskId: 'vt-1' },
    sparkos_visual_status: {},
  }
  for (const definition of definitions) {
    const result = await definition.execute(argumentsByName[definition.name] as never, {} as never)
    assert.equal(result.value.ok, false, definition.name)
    assert.equal(result.value.error?.code, 'factory-disabled', definition.name)
    assert.equal(existsSync(vault), false, definition.name + ' must not initialize VAULT')
  }
})

test('brief mode can save an intel cluster without triggering factory ranking', async () => {
  mkdirSync(process.env.SPARKOS_ALPHA_ARCHIVE!, { recursive: true })
  mkdirSync(process.env.SPARKOS_HERMES_ARCHIVE!, { recursive: true })
  const cluster = {
    clusterId: 'c-20260822-001', date: '20260822', topic: '简报情报簇',
    eventKeys: ['event-1'], heat: 'low', novelty: 'medium', credibility: 'medium',
    coreFacts: ['测试事实'], evidenceUrls: ['https://example.com/source'],
    knowledgeCards: [], risks: [], platforms: [], angleSuggestions: [],
  }
  const result = await runSparkosCommand({ action: 'intel', payload: { submitCluster: cluster } })
  assert.match(result.text, /submit-cluster OK/)
  assert.match(result.text, /简报模式未刷新工厂排名/)
  assert.equal(existsSync(join(vault, 'ops-intel', 'clusters')), true)
  assert.equal(existsSync(process.env.SPARKOS_DB_PATH!), false, 'intel submission must not create the factory database in brief mode')
})

test('explicit full mode is available by config, with environment override taking precedence', async () => {
  mkdirSync(join(vault, 'config'), { recursive: true })
  writeFileSync(join(vault, 'config', 'workbench_mode.json'), '{"mode":"full"}')
  assert.equal(factoryEnabled(), true)
  const preview = await runSparkosCommand({ action: 'topics', payload: { editorial: 'weekly' }, dryRun: true })
  assert.match(preview.text, /editorial.weekly/)
  assert.doesNotMatch(preview.text, /factory-disabled/)
  process.env.SPARKOS_WORKBENCH_MODE = 'brief'
  try {
    assert.equal(factoryEnabled(), false)
    assert.match((await runSparkosCommand({ action: 'topics', payload: { editorial: 'weekly' } })).text, /factory-disabled/)
  } finally {
    delete process.env.SPARKOS_WORKBENCH_MODE
  }
})
