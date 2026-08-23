/** SparkOS V2 试运行每日基线（只读）。用法：node --experimental-strip-types scripts/trial-baseline.mjs
 * 输出 JSON：数据健康（schema/drafts/visual/jobs/approvals）+ V2 页面渲染检查
 * （受控写端点白名单 6 个允许 / queue·mutate·editorial 禁止 + 内嵌数据存在性）。
 * 绝不写入生产数据。 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { VAULT_ROOT } from '../src/vault.ts'
import { defaultFactoryDbPath, databaseHealth } from '../src/storage/database.ts'
import { visualStatus } from '../src/visual/service.ts'

const dbPath = defaultFactoryDbPath()
const report = { at: new Date().toISOString(), vaultRoot: VAULT_ROOT, dbPath, dbExists: existsSync(dbPath) }
if (!report.dbExists) {
  console.log(JSON.stringify({ ...report, error: '生产 DB 不存在' }, null, 2))
  process.exit(1)
}
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA query_only = ON')
try {
  report.schemaVersion = databaseHealth(db, dbPath).schemaVersion
  const drafts = db.prepare('SELECT status, COUNT(*) AS count FROM draft_packages GROUP BY status ORDER BY status').all()
  report.drafts = Object.fromEntries(drafts.map((row) => [row.status, Number(row.count)]))
  report.draftTotal = Number(db.prepare('SELECT COUNT(*) AS count FROM draft_packages').get().count)
  const batches = db.prepare('SELECT status, COUNT(*) AS count FROM visual_batches GROUP BY status ORDER BY status').all()
  report.visualBatches = Object.fromEntries(batches.map((row) => [row.status, Number(row.count)]))
  report.visualBatchTotal = Number(db.prepare('SELECT COUNT(*) AS count FROM visual_batches').get().count)
  const tasks = db.prepare('SELECT state, COUNT(*) AS count FROM visual_asset_tasks GROUP BY state ORDER BY state').all()
  report.visualTasks = Object.fromEntries(tasks.map((row) => [row.state, Number(row.count)]))
  report.attemptTotal = Number(db.prepare('SELECT COUNT(*) AS count FROM visual_asset_attempts').get().count)
  report.deliveryArtifacts = Number(db.prepare('SELECT COUNT(*) AS count FROM visual_delivery_artifacts').get().count)
  const jobs = db.prepare('SELECT kind, status, COUNT(*) AS count FROM workflow_jobs GROUP BY kind, status ORDER BY kind, status').all()
  report.jobs = jobs.map((row) => ({ kind: row.kind, status: row.status, count: Number(row.count) }))
  report.approvals = Number(db.prepare('SELECT COUNT(*) AS count FROM approvals').get().count)
  report.retryRequests = Number(db.prepare('SELECT COUNT(*) AS count FROM visual_retry_requests').get().count)
  // 视觉快照简况（只读）
  const snap = visualStatus(db)
  report.visualPackages = snap.batches.map((b) => ({
    packageId: b.packageId, status: b.status, approved: b.approvedCount, required: b.requiredCount,
    delivery: !!b.deliveryLink, publishTask: b.publishTask ? b.publishTask.status : null,
  }))
} finally {
  db.close()
}

// V2 页面渲染检查（生产数据只读装配）
const { buildWorkbenchData } = await import('../src/server/data.ts')
const data = buildWorkbenchData()
const html = readFileSync(new URL('../src/server/page-v2.template.html', import.meta.url), 'utf8')
const allowed = ['/sparkos/visual/decision', '/sparkos/visual/retry', '/sparkos/creation/decision', '/sparkos/creation/revise', '/sparkos/visual/delivery', '/sparkos/publish']
const forbidden = ['/sparkos/visual/queue', '/sparkos/mutate', '/sparkos/editorial/decision']
report.page = {
  embeddedData: html.includes('window._embeddedDailyData'),
  controlledWriteEndpointsPresent: allowed.map((e) => [e, html.includes(e)]),
  forbiddenWriteEndpointsAbsent: forbidden.map((e) => [e, !html.includes(e)]),
  factoryDrafts: (data.factory?.drafts || []).length,
  factoryVisualBatches: (data.factory?.visual?.batches || []).length,
  generatedAt: data.generatedAt,
}
console.log(JSON.stringify(report, null, 2))

