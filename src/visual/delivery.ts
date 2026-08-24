/** M5B immutable, derived visual delivery packages. */

import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { DraftAssetPlan, DraftSubmission, WechatBlock } from '../creation/drafts.ts'
import { VAULT_ROOT } from '../vault.ts'
import { VisualPipelineError } from './errors.ts'
import { attemptApproval, publicationReadiness, visualReviewAggregate } from './review.ts'
import type { VisualDeliveryArtifact } from './types.ts'
import { deterministicZip } from './zip.ts'

const PACKAGE_ID = /^dp-[a-f0-9]{16}$/
const DELIVERY_ID = /^vd-[a-f0-9]{20}$/
const ASSET_ID = /^[a-z0-9][a-z0-9._-]{2,48}$/i
const MIME_EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

interface DraftRow {
  id: string
  contract_version: number
  status: string
  updated_at: string
  decided_at: string | null
}

interface DeliveryTaskRow {
  task_id: string
  batch_id: string
  asset_id: string
  kind: DraftAssetPlan['kind']
  placement: string
  prompt: string
  alt_text: string
  current_attempt: number
  attempt_id: string | null
  attempt_no: number | null
  provider: string | null
  model: string | null
  source_media_type: string | null
  source_bytes: number | null
  source_width: number | null
  source_height: number | null
  imported_relative_path: string | null
  imported_sha256: string | null
  imported_at: string | null
}

interface SourcePackage {
  draft: DraftRow
  batchId: string
  submission: DraftSubmission
  sourceSha256: string
  tasks: DeliveryTaskRow[]
}

interface PreparedAsset {
  plan: DraftAssetPlan
  task: DeliveryTaskRow
  extension: string
  data: Buffer
  approvalNote: string | null
  decidedAt: string | null
}

interface DeliveryManifest {
  deliveryId: string
  packageId: string
  batchId: string
  version: number
  mode: 'preview' | 'production'
  fingerprint: string
  generatedAt: string
  testOnly: boolean
  readyForPublication: boolean
  legacyContract: boolean
  missingSlots: number[]
  files: Array<{ path: string; sha256: string; bytes: number }>
}

interface DeliveryRow {
  id: string
  package_id: string
  batch_id: string
  version: number
  mode: 'preview' | 'production'
  platform: string
  format: string
  relative_path: string
  sha256: string
  bytes: number
  manifest_json: string
  created_at: string
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n')
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function safeMarkdown(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function ensureSafeDirectory(root: string, relative: string): string {
  const canonicalRoot = realpathSync(root)
  let current = root
  for (const part of relative.split('/')) {
    if (part === '' || part === '.' || part === '..') throw new VisualPipelineError('unsafe-path', '交付目录不合法', 422)
    current = path.join(current, part)
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 })
    const info = lstatSync(current)
    if (!info.isDirectory() || info.isSymbolicLink() || !realpathSync(current).startsWith(canonicalRoot + path.sep)) {
      throw new VisualPipelineError('unsafe-path', '交付目录包含 symlink 或越界路径', 422)
    }
  }
  return current
}

function safeVaultFile(relative: string, expectedSha: string, expectedBytes: number): Buffer {
  const integrity = (reason: string): VisualPipelineError => new VisualPipelineError('artifact-integrity-failed', reason, 422)
  if (path.isAbsolute(relative) || relative.includes('\0')) throw integrity('视觉文件路径不合法')
  const root = path.resolve(VAULT_ROOT)
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(root + path.sep)) throw integrity('视觉文件路径越界')
  // 文件系统原生错误（缺失/不可读/权限）统一归一化为 artifact-integrity-failed，不得把 ENOENT/EACCES 直接抛给调用方。
  let info: ReturnType<typeof lstatSync>
  let real: string
  let rootReal: string
  let data: Buffer
  try {
    info = lstatSync(absolute)
    real = realpathSync(absolute)
    rootReal = realpathSync(root)
    data = readFileSync(absolute)
  } catch {
    throw integrity('视觉文件缺失或不可读：' + relative)
  }
  if (!info.isFile() || info.isSymbolicLink() || !real.startsWith(rootReal + path.sep)) {
    throw integrity('视觉文件必须是 VAULT 内普通文件')
  }
  if (data.byteLength !== expectedBytes || sha256(data) !== expectedSha) throw integrity('视觉文件哈希或大小不匹配')
  return data
}

function readSource(db: DatabaseSync, packageId: string): SourcePackage {
  if (!PACKAGE_ID.test(packageId)) throw new VisualPipelineError('bad-request', 'packageId 不合法', 400)
  const draft = db.prepare('SELECT id, contract_version, status, updated_at, decided_at FROM draft_packages WHERE id=?').get(packageId) as DraftRow | undefined
  if (!draft) throw new VisualPipelineError('not-found', '草稿包不存在', 404)
  if (draft.status !== 'approved') throw new VisualPipelineError('package-not-approved', '只有 approved 草稿可以生成视觉交付包', 409)
  const packageArtifact = db.prepare(`
    SELECT relative_path, sha256, bytes FROM draft_artifacts
    WHERE package_id=? AND relative_path LIKE '%/package.json'
  `).get(packageId) as { relative_path: string; sha256: string; bytes: number } | undefined
  if (!packageArtifact || path.basename(packageArtifact.relative_path) !== 'package.json') throw new VisualPipelineError('artifact-integrity-failed', '原草稿 package.json 不存在', 422)
  const sourceData = safeVaultFile(packageArtifact.relative_path, packageArtifact.sha256, Number(packageArtifact.bytes))
  let submission: DraftSubmission
  try { submission = JSON.parse(sourceData.toString('utf8')) as DraftSubmission } catch (error) {
    throw new VisualPipelineError('artifact-integrity-failed', '原草稿 package.json 不是合法 JSON', 422, { cause: error })
  }
  if (submission.packageId !== packageId || !Array.isArray(submission.assets)) throw new VisualPipelineError('artifact-integrity-failed', '原草稿 package.json 标识不一致', 422)
  const batch = db.prepare('SELECT id FROM visual_batches WHERE package_id=?').get(packageId) as { id: string } | undefined
  if (!batch) throw new VisualPipelineError('not-found', '视觉批次不存在', 404)
  const tasks = db.prepare(`
    SELECT t.id AS task_id, t.batch_id, t.asset_id, t.kind, t.placement, t.prompt, t.alt_text,
           t.current_attempt, a.id AS attempt_id, a.attempt_no, a.provider, a.model, a.source_media_type,
           a.source_bytes, a.source_width, a.source_height, a.imported_relative_path, a.imported_sha256, a.imported_at
    FROM visual_asset_tasks t
    LEFT JOIN visual_asset_attempts a ON a.task_id=t.id AND a.attempt_no=t.current_attempt
    WHERE t.batch_id=? ORDER BY t.asset_id
  `).all(batch.id) as unknown as DeliveryTaskRow[]
  if (tasks.length !== submission.assets.length) throw new VisualPipelineError('artifact-integrity-failed', '视觉任务与原草稿 assets 数量不一致', 422)
  return { draft, batchId: batch.id, submission, sourceSha256: packageArtifact.sha256, tasks }
}

function preparedAssets(db: DatabaseSync, source: SourcePackage): PreparedAsset[] {
  const plans = new Map(source.submission.assets.map((asset) => [asset.id, asset]))
  if (plans.size !== source.submission.assets.length) throw new VisualPipelineError('artifact-integrity-failed', '原草稿 assetId 重复', 422)
  return source.tasks.map((task) => {
    if (!ASSET_ID.test(task.asset_id)) throw new VisualPipelineError('artifact-integrity-failed', 'assetId 不合法', 422)
    const plan = plans.get(task.asset_id)
    if (!plan || plan.kind !== task.kind || plan.placement !== task.placement || plan.prompt !== task.prompt || plan.altText !== task.alt_text) {
      throw new VisualPipelineError('artifact-integrity-failed', '视觉任务与原草稿结构不一致：' + task.asset_id, 422)
    }
    if (!task.attempt_id || Number(task.attempt_no) !== Number(task.current_attempt)) throw new VisualPipelineError('visual-not-approved', '视觉任务缺少当前 attempt', 409)
    const approval = attemptApproval(db, task.attempt_id)
    if (approval.decision !== 'approved') throw new VisualPipelineError('visual-not-approved', '全部视觉任务必须 approved：' + task.asset_id, 409)
    const extension = task.source_media_type === null ? undefined : MIME_EXTENSION[task.source_media_type]
    if (!extension || task.source_bytes === null || task.imported_relative_path === null || task.imported_sha256 === null) {
      throw new VisualPipelineError('artifact-integrity-failed', 'approved attempt 缺少可靠图片信息：' + task.asset_id, 422)
    }
    return {
      plan,
      task,
      extension,
      data: safeVaultFile(task.imported_relative_path, task.imported_sha256, Number(task.source_bytes)),
      approvalNote: approval.note,
      decidedAt: approval.decidedAt,
    }
  })
}

function renderWechat(submission: DraftSubmission, assets: Map<string, PreparedAsset>, testOnly: boolean): { html: Buffer; markdown: Buffer } {
  const render = (block: WechatBlock): string => {
    if (block.type === 'heading') return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`
    if (block.type === 'paragraph') return `<p>${escapeHtml(block.text).replaceAll('\n', '<br>')}</p>`
    if (block.type === 'quote') return `<blockquote>${escapeHtml(block.text)}${block.sourceUrl ? `<small>${escapeHtml(block.sourceUrl)}</small>` : ''}</blockquote>`
    if (block.type === 'list') return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    if (!ASSET_ID.test(block.assetId) || /[:/\\]/.test(block.assetId)) throw new VisualPipelineError('asset-injection', '图片块 assetId 不合法', 422)
    const asset = assets.get(block.assetId)
    if (!asset) throw new VisualPipelineError('unknown-asset', '微信正文引用未知或未批准 assetId：' + block.assetId, 422)
    const src = `assets/${asset.plan.id}.${asset.extension}`
    return `<figure><img src="${src}" alt="${escapeHtml(asset.plan.altText)}"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`
  }
  const body = submission.variants.wechat.blocks.map(render).join('')
  const banner = testOnly ? '<div class="test-only">TEST ONLY · 测试图片，不可发布</div>' : ''
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(submission.variants.wechat.title)}</title><style>body{margin:0;background:#f5f2ec;color:#2f2a24;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.article{max-width:720px;margin:auto;background:#fff;padding:32px}img{display:block;max-width:100%;height:auto}.test-only{position:sticky;top:0;padding:12px;background:#8b1e1e;color:#fff;font-weight:800;text-align:center}figcaption{color:#766b5d;text-align:center}.boundary{margin-top:32px;padding:14px;background:#f5f2ec}</style></head><body>${banner}<article class="article"><h1>${escapeHtml(submission.variants.wechat.title)}</h1><p>${escapeHtml(submission.variants.wechat.dek)}</p>${body}<div class="boundary"><b>事实边界：</b>${escapeHtml(submission.factBoundary)}</div></article></body></html>`
  const lines = [`# ${submission.variants.wechat.title}`, '', `> ${submission.variants.wechat.dek}`, '']
  for (const block of submission.variants.wechat.blocks) {
    if (block.type === 'heading') lines.push(`${'#'.repeat(block.level)} ${block.text}`, '')
    else if (block.type === 'paragraph') lines.push(block.text, '')
    else if (block.type === 'quote') lines.push(`> ${block.text}${block.sourceUrl ? `（${block.sourceUrl}）` : ''}`, '')
    else if (block.type === 'list') lines.push(...block.items.map((item) => `- ${item}`), '')
    else {
      const asset = assets.get(block.assetId)!
      lines.push(`![${safeMarkdown(block.caption)}](assets/${asset.plan.id}.${asset.extension})`, '')
    }
  }
  lines.push('---', `事实边界：${submission.factBoundary}`)
  return { html: Buffer.from(html), markdown: Buffer.from(lines.join('\n') + '\n') }
}

function legacyXhsOrder(asset: PreparedAsset, index: number): number {
  const match = asset.plan.placement.match(/第\s*(\d+)\s*张/)
  if (match) return Number(match[1])
  if (/cover|封面|首图/i.test(asset.plan.id + ' ' + asset.plan.placement)) return 1
  if (asset.plan.kind === 'carousel') return Math.max(2, index + 1)
  return index + 1
}

function xhsAssets(source: SourcePackage, assets: PreparedAsset[]): { entries: Array<PreparedAsset & { order: number }>; legacy: boolean; missing: number[] } {
  const legacy = Number(source.draft.contract_version) < 2
  const selected = assets.filter((asset) => legacy
    ? asset.plan.kind === 'carousel' || /小红书|轮播|首图/i.test(asset.plan.placement)
    : asset.plan.platforms?.includes('xiaohongshu') || asset.plan.role?.startsWith('xhs-'))
  const entries = selected.map((asset, index) => ({ ...asset, order: legacy ? legacyXhsOrder(asset, index) : Number(asset.plan.order) }))
    .sort((left, right) => left.order - right.order || left.plan.id.localeCompare(right.plan.id))
  const orders = new Set(entries.map((entry) => entry.order))
  const max = Math.max(2, ...orders)
  const missing = Array.from({ length: max }, (_, index) => index + 1).filter((order) => !orders.has(order))
  return { entries, legacy, missing }
}

function latestDeterministicTime(source: SourcePackage, assets: PreparedAsset[]): string {
  const values = [source.draft.updated_at, source.draft.decided_at, ...assets.flatMap((asset) => [asset.task.imported_at, asset.decidedAt])]
    .filter((value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
  return values.sort().at(-1) ?? '1980-01-01T00:00:00.000Z'
}

function rowFromDb(row: DeliveryRow): VisualDeliveryArtifact {
  return {
    id: row.id, packageId: row.package_id, batchId: row.batch_id, version: Number(row.version), mode: row.mode,
    platform: row.platform, format: row.format, relativePath: row.relative_path, sha256: row.sha256,
    bytes: Number(row.bytes), manifest: JSON.parse(row.manifest_json) as Record<string, unknown>, createdAt: row.created_at,
  }
}

export function createVisualDelivery(
  db: DatabaseSync,
  input: { packageId: string; mode: 'preview' | 'production' },
  now = new Date(),
): { delivery: VisualDeliveryArtifact; artifacts: VisualDeliveryArtifact[]; created: boolean } {
  if (input.mode !== 'preview' && input.mode !== 'production') throw new VisualPipelineError('bad-request', 'mode 必须是 preview 或 production', 400)
  const source = readSource(db, input.packageId)
  const aggregate = visualReviewAggregate(db, source.batchId)
  if (!aggregate.visualApproved) throw new VisualPipelineError('visual-not-approved', 'required 视觉任务尚未全部批准', 409)
  const assets = preparedAssets(db, source)
  const stub = assets.some((asset) => asset.task.provider === 'stub')
  const productionProviders = assets.every((asset) => typeof asset.task.provider === 'string' && asset.task.provider !== '' && asset.task.provider !== 'stub')
  const xhs = xhsAssets(source, assets)
  if (input.mode === 'production' && (!productionProviders || xhs.legacy || xhs.missing.length > 0)) {
    const reason = !productionProviders ? 'production delivery 拒绝 stub 或未知 provider'
      : xhs.legacy ? 'legacy contract v1 不能证明小红书槽位完整' : '小红书 required 槽位缺失'
    throw new VisualPipelineError('production-gate', reason, 409)
  }
  const fingerprint = sha256(JSON.stringify({
    packageId: source.draft.id, mode: input.mode, contractVersion: source.draft.contract_version, sourceSha256: source.sourceSha256,
    assets: assets.map((asset) => ({ id: asset.plan.id, attemptId: asset.task.attempt_id, sha256: asset.task.imported_sha256, provider: asset.task.provider, model: asset.task.model, decidedAt: asset.decidedAt })),
  }))
  const existing = (db.prepare(`
    SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND mode=? AND platform='shared' AND format='manifest' ORDER BY version DESC
  `).all(input.packageId, input.mode) as unknown as DeliveryRow[]).find((row) => {
    try { return (JSON.parse(row.manifest_json) as { fingerprint?: unknown }).fingerprint === fingerprint } catch { return false }
  })
  if (existing) {
    // 幂等复用前重新校验全部磁盘文件与数据库 SHA/bytes；文件损坏时不得返回 created=false 成功。
    const rows = db.prepare('SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND version=? ORDER BY relative_path').all(input.packageId, existing.version) as unknown as DeliveryRow[]
    for (const row of rows) safeVaultFile(row.relative_path, row.sha256, Number(row.bytes))
    const artifacts = rows.map(rowFromDb)
    return { delivery: rowFromDb(existing), artifacts, created: false }
  }
  const versionRow = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM visual_delivery_artifacts WHERE package_id=?').get(input.packageId) as { version: number }
  const version = Number(versionRow.version) + 1
  const deliveryId = `vd-${sha256(`${input.packageId}:${version}:${fingerprint}`).slice(0, 20)}`
  // preview 交付无论 provider 是否 stub 一律标记 testOnly（TEST ONLY 横幅 + 不可发布）。
  const testOnly = input.mode === 'preview' || stub
  const generatedAt = latestDeterministicTime(source, assets)
  const files = new Map<string, Buffer>()
  const byId = new Map(assets.map((asset) => [asset.plan.id, asset]))
  const wechat = renderWechat(source.submission, byId, testOnly)
  files.set('wechat-visual.html', wechat.html)
  files.set('wechat-visual.md', wechat.markdown)
  for (const asset of assets) files.set(`assets/${asset.plan.id}.${asset.extension}`, asset.data)
  const provenance = {
    packageId: input.packageId, batchId: source.batchId, sourcePackageSha256: source.sourceSha256, generatedAt,
    assets: assets.map((asset) => ({
      assetId: asset.plan.id, attemptId: asset.task.attempt_id, attemptNo: Number(asset.task.attempt_no), provider: asset.task.provider,
      model: asset.task.model, prompt: asset.task.prompt, sha256: asset.task.imported_sha256, bytes: Number(asset.task.source_bytes),
      width: Number(asset.task.source_width), height: Number(asset.task.source_height), mime: asset.task.source_media_type,
      generatedAt: asset.task.imported_at, reviewNote: asset.approvalNote,
    })),
  }
  files.set('provenance.json', json(provenance))
  const xhsAssetManifest: Array<Record<string, unknown>> = []
  for (const asset of xhs.entries) {
    const filename = `${String(asset.order).padStart(2, '0')}-${asset.plan.id}.${asset.extension}`
    files.set(`xiaohongshu/${filename}`, asset.data)
    xhsAssetManifest.push({ assetId: asset.plan.id, order: asset.order, role: asset.plan.role ?? null, placement: asset.plan.placement, file: filename, sha256: asset.task.imported_sha256 })
  }
  files.set('xiaohongshu/caption.md', Buffer.from(`# ${source.submission.variants.xiaohongshu.title}\n\n${source.submission.variants.xiaohongshu.body}\n\n${source.submission.variants.xiaohongshu.hashtags.map((tag) => tag.startsWith('#') ? tag : '#' + tag).join(' ')}\n`))
  files.set('xiaohongshu/assets.json', json(xhsAssetManifest))
  files.set('xiaohongshu/provenance.json', json(provenance))
  const xhsManifest = { packageId: input.packageId, legacyContract: xhs.legacy, missingSlots: xhs.missing, completeForProduction: !xhs.legacy && xhs.missing.length === 0, assets: xhsAssetManifest }
  files.set('xiaohongshu/manifest.json', json(xhsManifest))
  const initialFiles = [...files].map(([file, data]) => ({ path: file, sha256: sha256(data), bytes: data.byteLength }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const manifest: DeliveryManifest = {
    deliveryId, packageId: input.packageId, batchId: source.batchId, version, mode: input.mode, fingerprint, generatedAt,
    testOnly, readyForPublication: input.mode === 'production' && !testOnly, legacyContract: xhs.legacy, missingSlots: xhs.missing, files: initialFiles,
  }
  files.set('manifest.json', json(manifest))
  const zipName = `visual-delivery-v${String(version).padStart(3, '0')}.zip`
  files.set(zipName, deterministicZip([...files].map(([file, data]) => ({ path: file, data }))))
  const relativeDir = path.posix.join('deliveries', 'factory', now.toISOString().slice(0, 10), input.packageId, `visual-v${String(version).padStart(3, '0')}`)
  const absoluteDir = path.join(VAULT_ROOT, ...relativeDir.split('/'))
  if (existsSync(absoluteDir)) throw new VisualPipelineError('delivery-conflict', '派生交付目录已存在，拒绝覆盖', 409)
  ensureSafeDirectory(VAULT_ROOT, path.posix.dirname(relativeDir))
  const staging = path.join(path.dirname(absoluteDir), `.${path.basename(absoluteDir)}-${randomUUID()}.tmp`)
  mkdirSync(staging)
  try {
    for (const [file, data] of files) {
      const target = path.join(staging, ...file.split('/'))
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, data, { mode: 0o600 })
    }
    renameSync(staging, absoluteDir)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
  const specs = [...files].map(([file, data]) => {
    const platform = file.startsWith('xiaohongshu/') ? 'xiaohongshu' : file.startsWith('wechat-') || file.startsWith('assets/') ? 'wechat' : 'shared'
    const format = file === 'manifest.json' ? 'manifest' : file === zipName ? 'zip'
      : file === 'provenance.json' ? 'provenance' : file.replaceAll('/', ':')
    return { file, data, platform, format }
  })
  const manifestJson = JSON.stringify(manifest)
  const at = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const spec of specs) {
      const id = spec.file === 'manifest.json' ? deliveryId : `vf-${sha256(`${deliveryId}:${spec.file}`).slice(0, 20)}`
      db.prepare(`
        INSERT INTO visual_delivery_artifacts(
          id, package_id, batch_id, version, mode, platform, format, relative_path, sha256, bytes, manifest_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.packageId, source.batchId, version, input.mode, spec.platform, spec.format,
        path.posix.join(relativeDir, spec.file), sha256(spec.data), spec.data.byteLength, manifestJson, at)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    rmSync(absoluteDir, { recursive: true, force: true })
    throw error
  }
  const artifacts = (db.prepare('SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND version=? ORDER BY relative_path').all(input.packageId, version) as unknown as DeliveryRow[]).map(rowFromDb)
  const delivery = artifacts.find((artifact) => artifact.id === deliveryId)!
  // Exercise the shared readiness calculation after the transaction; no publish action exists here.
  publicationReadiness(db, source.batchId)
  return { delivery, artifacts, created: true }
}

export function listVisualDeliveries(db: DatabaseSync, packageId: string): VisualDeliveryArtifact[] {
  if (!PACKAGE_ID.test(packageId)) throw new VisualPipelineError('bad-request', 'packageId 不合法', 400)
  return (db.prepare(`
    SELECT * FROM visual_delivery_artifacts WHERE package_id=? AND platform='shared' AND format='manifest' ORDER BY version DESC
  `).all(packageId) as unknown as DeliveryRow[]).map(rowFromDb)
}

function deliveryRoot(db: DatabaseSync, deliveryId: string): DeliveryRow {
  if (!DELIVERY_ID.test(deliveryId)) throw new VisualPipelineError('bad-request', 'deliveryId 不合法', 400)
  const row = db.prepare(`SELECT * FROM visual_delivery_artifacts WHERE id=? AND platform='shared' AND format='manifest'`).get(deliveryId) as DeliveryRow | undefined
  if (!row) throw new VisualPipelineError('not-found', '视觉交付包不存在', 404)
  return row
}

export function readVisualDeliveryFile(db: DatabaseSync, deliveryId: string, file: string): { content: Buffer; relativePath: string } {
  const root = deliveryRoot(db, deliveryId)
  if (file === '' || path.isAbsolute(file) || file.includes('\\') || file.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new VisualPipelineError('bad-request', 'file 不合法', 400)
  }
  const manifest = JSON.parse(root.manifest_json) as DeliveryManifest
  const allowed = new Set([...manifest.files.map((item) => item.path), 'manifest.json', `visual-delivery-v${String(root.version).padStart(3, '0')}.zip`])
  if (!allowed.has(file)) throw new VisualPipelineError('not-found', '交付包文件未声明', 404)
  const base = path.posix.dirname(root.relative_path)
  const relative = path.posix.join(base, file)
  const row = db.prepare('SELECT sha256, bytes FROM visual_delivery_artifacts WHERE package_id=? AND version=? AND relative_path=?').get(root.package_id, root.version, relative) as { sha256: string; bytes: number } | undefined
  if (!row) throw new VisualPipelineError('not-found', '交付包文件不存在', 404)
  return { content: safeVaultFile(relative, row.sha256, Number(row.bytes)), relativePath: relative }
}

export function readVisualDeliveryZip(db: DatabaseSync, deliveryId: string): { content: Buffer; filename: string } {
  const root = deliveryRoot(db, deliveryId)
  const filename = `visual-delivery-v${String(root.version).padStart(3, '0')}.zip`
  return { content: readVisualDeliveryFile(db, deliveryId, filename).content, filename }
}
