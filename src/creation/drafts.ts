/**
 * Multi-platform draft package contract, validation and local artifact writer.
 * The model/agent writes structured copy; this module enforces evidence and
 * platform completeness, renders safe WeChat HTML and keeps publishing manual.
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { editorialCardById } from '../editorial/planner.ts'
import type { EditorialCard } from '../editorial/planner.ts'
import { VAULT_ROOT } from '../vault.ts'
import { createJob, getJob, startJob, transitionJob } from '../storage/jobs.ts'
import { isSafeExternalUrl } from '../server/security.ts'

export const CREATION_CONTRACT_VERSION = 2
export type DraftPackageStatus = 'awaiting_generation' | 'validation_failed' | 'waiting_approval' | 'approved' | 'rejected'
export type ClaimKind = 'fact' | 'inference' | 'opinion'

export interface FactClaim {
  text: string
  kind: ClaimKind
  evidenceUrls: string[]
}

export type WechatBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string; sourceUrl?: string }
  | { type: 'list'; items: string[] }
  | { type: 'image'; assetId: string; caption: string }

export type DraftPlatform = 'wechat' | 'telegram' | 'x' | 'xiaohongshu'
export type DraftAssetRole = 'wechat-cover' | 'wechat-inline' | 'xhs-cover' | 'xhs-carousel' | 'telegram-asset' | 'x-asset'

export interface DraftAssetPlan {
  id: string
  kind: 'cover' | 'inline' | 'carousel'
  prompt: string
  altText: string
  aspectRatio: '2.35:1' | '16:9' | '3:4' | '1:1'
  placement: string
  /** Required for creation contract v2; absent on legacy contract v1 packages. */
  platforms?: DraftPlatform[]
  order?: number
  required?: boolean
  role?: DraftAssetRole
}

export interface DraftSubmission {
  packageId: string
  editorialAngle: string
  keyMessage: string
  factBoundary: string
  factClaims: FactClaim[]
  variants: {
    wechat: { title: string; dek: string; blocks: WechatBlock[] }
    telegram: { title: string; body: string }
    x: { posts: string[] }
    xiaohongshu: { title: string; body: string; hashtags: string[] }
  }
  assets: DraftAssetPlan[]
}

export interface DraftValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  stats: { wechatChars: number; telegramChars: number; xPosts: number; xiaohongshuChars: number; assets: number; facts: number }
}

export interface CreationRequest {
  packageId: string
  revision: number
  parentPackageId: string | null
  /** v2+ 修订上下文：父版本的人工驳回意见。 */
  parentReviewNote: string | null
  contractVersion: number
  createdAt: string
  sourceCard: EditorialCard
  instructions: string[]
  requiredPlatforms: ['wechat', 'telegram', 'x', 'xiaohongshu']
  outputContract: string
  submissionTemplate: Record<string, unknown>
}

export interface DraftArtifact {
  id: string
  platform: string
  format: string
  relativePath: string
  sha256: string
  bytes: number
}

export interface DraftPackage {
  id: string
  cardId: string
  revision: number
  parentPackageId: string | null
  jobId: string
  contractVersion: number
  status: DraftPackageStatus
  request: CreationRequest
  submission: DraftSubmission | null
  validation: DraftValidation
  artifactDir: string | null
  artifacts: DraftArtifact[]
  reviewNote: string | null
  parentReviewNote: string | null
  createdAt: string
  updatedAt: string
  decidedAt: string | null
}

export interface DraftPackageSummary {
  id: string
  cardId: string
  revision: number
  parentPackageId: string | null
  status: DraftPackageStatus
  title: string
  validation: DraftValidation
  assetCount: number
  artifacts: DraftArtifact[]
  reviewNote: string | null
  parentReviewNote: string | null
  createdAt: string
  updatedAt: string
  decidedAt: string | null
}

interface PackageRow {
  id: string
  card_id: string
  revision: number
  parent_package_id: string | null
  job_id: string
  contract_version: number
  status: DraftPackageStatus
  request_json: string
  submission_json: string | null
  validation_json: string
  artifact_dir: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
}

interface ArtifactRow {
  id: string
  platform: string
  format: string
  relative_path: string
  sha256: string
  bytes: number
}

function artifactFromRow(row: ArtifactRow): DraftArtifact {
  return { id: row.id, platform: row.platform, format: row.format, relativePath: row.relative_path, sha256: row.sha256, bytes: Number(row.bytes) }
}

function packageFromRow(db: DatabaseSync, row: PackageRow): DraftPackage {
  const artifacts = (db.prepare('SELECT * FROM draft_artifacts WHERE package_id = ? ORDER BY relative_path').all(row.id) as unknown as ArtifactRow[]).map(artifactFromRow)
  const request = JSON.parse(row.request_json) as CreationRequest
  const review = db.prepare("SELECT note FROM approvals WHERE subject_kind='draft_package' AND subject_id=?").get(row.id) as { note: string | null } | undefined
  const parentReview = row.parent_package_id
    ? db.prepare("SELECT note FROM approvals WHERE subject_kind='draft_package' AND subject_id=?").get(row.parent_package_id) as { note: string | null } | undefined
    : undefined
  const parentReviewNote = parentReview?.note ?? request.parentReviewNote ?? null
  return {
    id: row.id, cardId: row.card_id, revision: Number(row.revision), parentPackageId: row.parent_package_id,
    jobId: row.job_id, contractVersion: Number(row.contract_version), status: row.status,
    request: { ...request, parentReviewNote },
    submission: row.submission_json ? JSON.parse(row.submission_json) as DraftSubmission : null,
    validation: JSON.parse(row.validation_json) as DraftValidation,
    artifactDir: row.artifact_dir, artifacts, reviewNote: review?.note ?? null, parentReviewNote,
    createdAt: row.created_at, updatedAt: row.updated_at, decidedAt: row.decided_at,
  }
}

function packageById(db: DatabaseSync, id: string): DraftPackage | null {
  const row = db.prepare('SELECT * FROM draft_packages WHERE id = ?').get(id) as PackageRow | undefined
  return row ? packageFromRow(db, row) : null
}

function emptyValidation(): DraftValidation {
  return { ok: false, errors: [], warnings: [], stats: { wechatChars: 0, telegramChars: 0, xPosts: 0, xiaohongshuChars: 0, assets: 0, facts: 0 } }
}

function creationRequest(packageId: string, revision: number, parentPackageId: string | null, parentReviewNote: string | null, card: EditorialCard, now: string): CreationRequest {
  return {
    packageId,
    revision,
    parentPackageId,
    parentReviewNote,
    contractVersion: CREATION_CONTRACT_VERSION,
    createdAt: now,
    sourceCard: card,
    requiredPlatforms: ['wechat', 'telegram', 'x', 'xiaohongshu'],
    instructions: [
      ...(parentReviewNote ? ['这是修订版，必须逐条回应父版本驳回意见：' + parentReviewNote] : []),
      '只使用 sourceCard 中的事实与证据；不得把推断写成已确认事实。',
      '围绕 coreThesis 保持统一观点，但按四个平台的阅读习惯重新组织，不做机械截断。',
      '微信公众号必须提交结构化 blocks，由系统渲染安全 HTML；至少包含封面和两处正文配图任务。',
      '所有 fact 类型 claim 必须回链 sourceCard.evidence 中的 URL；争议与风险必须显式保留。',
      '这是待审草稿，不得包含“已发布”或绕过人工审核的指令。',
      '最低完整度：微信正文 600 字/6 个 blocks，Telegram 150 字，小红书 250 字/3 个标签，X 1-12 条且单条不超过 280 字。',
    ],
    outputContract: 'DraftSubmission: packageId/editorialAngle/keyMessage/factBoundary/factClaims/variants{wechat,telegram,x,xiaohongshu}/assets',
    submissionTemplate: {
      packageId,
      editorialAngle: card.coreThesis,
      keyMessage: '一句话核心信息',
      factBoundary: '哪些已确认，哪些仍是推断或未知',
      factClaims: [{ text: '逐条声明', kind: 'fact|inference|opinion', evidenceUrls: ['仅填写 sourceCard.evidence 中已有 URL'] }],
      variants: {
        wechat: { title: '5-64字', dek: '导语', blocks: [{ type: 'heading|paragraph|quote|list|image', text: '结构化正文；图片块填写 assetId/caption' }] },
        telegram: { title: '标题', body: '完整正文' },
        x: { posts: ['线程第1条', '线程第2条'] },
        xiaohongshu: { title: '不超过30字', body: '完整正文', hashtags: ['标签1', '标签2', '标签3'] },
      },
      assets: [
        { id: 'cover-main', kind: 'cover', prompt: '无小字的画面提示词', altText: '替代文本', aspectRatio: '2.35:1', placement: '公众号封面', platforms: ['wechat'], order: 1, required: true, role: 'wechat-cover' },
        { id: 'inline-one', kind: 'inline', prompt: '正文配图提示词', altText: '替代文本', aspectRatio: '16:9', placement: '微信正文位置', platforms: ['wechat'], order: 2, required: true, role: 'wechat-inline' },
        { id: 'xhs-cover', kind: 'cover', prompt: '小红书首图提示词', altText: '小红书首图', aspectRatio: '3:4', placement: '小红书第1张', platforms: ['xiaohongshu'], order: 1, required: true, role: 'xhs-cover' },
        { id: 'carousel-one', kind: 'carousel', prompt: '小红书轮播提示词', altText: '替代文本', aspectRatio: '3:4', placement: '小红书第2张', platforms: ['xiaohongshu'], order: 2, required: true, role: 'xhs-carousel' },
      ],
    },
  }
}

function createDraftRequest(db: DatabaseSync, card: EditorialCard, revision: number, parentPackageId: string | null, parentReviewNote: string | null, now: Date): DraftPackage {
  const fingerprint = createHash('sha256').update(JSON.stringify({ version: CREATION_CONTRACT_VERSION, revision, card })).digest('hex').slice(0, 16)
  const at = now.toISOString()
  const id = 'dp-' + createHash('sha256').update(`${card.id}:${fingerprint}`).digest('hex').slice(0, 16)
  const request = creationRequest(id, revision, parentPackageId, parentReviewNote, card, at)
  db.exec('BEGIN IMMEDIATE')
  try {
    const job = createJob(db, {
      kind: 'content.generate-package', input: { packageId: id, cardId: card.id, revision, contractVersion: CREATION_CONTRACT_VERSION },
      idempotencyKey: `content.generate-package:${id}`, priority: 30, now,
    }).job
    db.prepare(`
      INSERT INTO draft_packages(
        id, card_id, revision, parent_package_id, job_id, contract_version, input_fingerprint, status,
        request_json, validation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_generation', ?, ?, ?, ?)
    `).run(id, card.id, revision, parentPackageId, job.id, CREATION_CONTRACT_VERSION, fingerprint, JSON.stringify(request), JSON.stringify(emptyValidation()), at, at)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return packageById(db, id)!
}

export function ensureDraftRequest(db: DatabaseSync, cardId: string, now = new Date()): { package: DraftPackage; created: boolean } {
  const card = editorialCardById(db, cardId)
  if (!card) throw new Error('选题卡不存在：' + cardId)
  if (card.decision !== 'approved') throw new Error('只有已批准选题卡可以进入创作：' + cardId)
  const existing = db.prepare('SELECT * FROM draft_packages WHERE card_id = ? ORDER BY revision DESC LIMIT 1').get(cardId) as PackageRow | undefined
  if (existing) return { package: packageFromRow(db, existing), created: false }
  return { package: createDraftRequest(db, card, 1, null, null, now), created: true }
}

export function reviseDraftRequest(db: DatabaseSync, rejectedPackageId: string, now = new Date()): { package: DraftPackage; created: boolean } {
  const rejected = packageById(db, rejectedPackageId)
  if (!rejected) throw new Error('草稿包不存在：' + rejectedPackageId)
  if (rejected.status !== 'rejected') throw new Error('只有已驳回草稿包可以创建修订版：' + rejected.status)
  const existing = db.prepare('SELECT * FROM draft_packages WHERE parent_package_id = ? ORDER BY revision DESC LIMIT 1').get(rejectedPackageId) as PackageRow | undefined
  if (existing) return { package: packageFromRow(db, existing), created: false }
  const card = editorialCardById(db, rejected.cardId)
  if (!card || card.decision !== 'approved') throw new Error('来源选题卡未批准或不存在')
  return { package: createDraftRequest(db, card, rejected.revision + 1, rejected.id, rejected.reviewNote, now), created: true }
}

export function listDraftPackages(db: DatabaseSync, limit = 20): DraftPackage[] {
  const safe = Math.max(1, Math.min(100, Math.trunc(limit)))
  return (db.prepare(`SELECT * FROM draft_packages ORDER BY created_at DESC LIMIT ${safe}`).all() as unknown as PackageRow[]).map((row) => packageFromRow(db, row))
}

export function listDraftPackageSummaries(db: DatabaseSync, limit = 20): DraftPackageSummary[] {
  return listDraftPackages(db, limit).map((draftPackage) => ({
    id: draftPackage.id,
    cardId: draftPackage.cardId,
    revision: draftPackage.revision,
    parentPackageId: draftPackage.parentPackageId,
    status: draftPackage.status,
    title: draftPackage.request.sourceCard.title,
    validation: draftPackage.validation,
    assetCount: draftPackage.submission?.assets.length ?? 0,
    artifacts: draftPackage.artifacts,
    reviewNote: draftPackage.reviewNote,
    parentReviewNote: draftPackage.parentReviewNote,
    createdAt: draftPackage.createdAt,
    updatedAt: draftPackage.updatedAt,
    decidedAt: draftPackage.decidedAt,
  }))
}

export function pendingDraftRequests(db: DatabaseSync, limit = 10): CreationRequest[] {
  const safe = Math.max(1, Math.min(50, Math.trunc(limit)))
  return (db.prepare(`
    SELECT * FROM draft_packages WHERE status IN ('awaiting_generation', 'validation_failed')
    ORDER BY created_at LIMIT ${safe}
  `).all() as unknown as PackageRow[]).map((row) => JSON.parse(row.request_json) as CreationRequest)
}

function textOfBlocks(blocks: WechatBlock[]): string {
  return blocks.flatMap((block) => block.type === 'list'
    ? (Array.isArray(block.items) ? block.items.filter((item) => typeof item === 'string') : [])
    : block.type === 'image' ? [] : [typeof block.text === 'string' ? block.text : '']).join('\n')
}

export function validateDraftSubmission(submission: DraftSubmission, card: EditorialCard, contractVersion = CREATION_CONTRACT_VERSION): DraftValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const knownEvidence = new Set(card.evidence.map((item) => item.url))
  if (submission.packageId === '') errors.push('packageId 必填')
  if (!submission.editorialAngle?.trim()) errors.push('editorialAngle 必填')
  if (!submission.keyMessage?.trim()) errors.push('keyMessage 必填')
  if (!submission.factBoundary?.trim()) errors.push('factBoundary 必填')
  const rawClaims = Array.isArray(submission.factClaims) ? submission.factClaims : []
  const claims = rawClaims.filter((claim): claim is FactClaim => typeof claim === 'object' && claim !== null)
  if (claims.length !== rawClaims.length) errors.push('factClaims 含非对象条目')
  if (claims.length < 3) errors.push('factClaims 至少 3 条')
  for (const [index, claim] of claims.entries()) {
    if (!claim.text?.trim()) errors.push(`factClaims[${index}].text 必填`)
    if (claim.kind !== 'fact' && claim.kind !== 'inference' && claim.kind !== 'opinion') errors.push(`factClaims[${index}].kind 不合法`)
    const urls = Array.isArray(claim.evidenceUrls) ? claim.evidenceUrls : []
    if (claim.kind === 'fact' && urls.length === 0) errors.push(`factClaims[${index}] 事实缺少证据 URL`)
    for (const url of urls) {
      if (!isSafeExternalUrl(url)) errors.push(`factClaims[${index}] 证据 URL 必须是 http/https 绝对地址：${url}`)
      else if (!knownEvidence.has(url)) errors.push(`factClaims[${index}] 使用了选题卡之外的证据：${url}`)
    }
  }
  const variants = submission.variants
  const rawWechatBlocks = Array.isArray(variants?.wechat?.blocks) ? variants.wechat.blocks : []
  const wechatBlocks = rawWechatBlocks.filter((block): block is WechatBlock => typeof block === 'object' && block !== null)
  if (wechatBlocks.length !== rawWechatBlocks.length) errors.push('wechat.blocks 含非对象条目')
  for (const [index, block] of wechatBlocks.entries()) {
    if (!['heading', 'paragraph', 'quote', 'list', 'image'].includes(block.type)) errors.push(`wechat.blocks[${index}].type 不合法`)
    if (block.type === 'heading' && block.level !== 2 && block.level !== 3) errors.push(`wechat.blocks[${index}].level 只允许 2/3`)
    if (block.type === 'list' && (!Array.isArray(block.items) || block.items.length === 0 || block.items.some((item) => typeof item !== 'string' || !item.trim()))) errors.push(`wechat.blocks[${index}].items 不合法`)
    if ((block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') && !block.text?.trim()) errors.push(`wechat.blocks[${index}].text 必填`)
    if (block.type === 'image' && (!block.assetId?.trim() || !block.caption?.trim())) errors.push(`wechat.blocks[${index}] assetId/caption 必填`)
  }
  const wechatChars = textOfBlocks(wechatBlocks).length
  if (!variants?.wechat?.title?.trim() || variants.wechat.title.length > 64) errors.push('wechat.title 必填且 ≤64 字')
  if (!variants?.wechat?.dek?.trim()) errors.push('wechat.dek 必填')
  if (wechatBlocks.length < 6 || wechatChars < 600) errors.push('wechat.blocks 至少 6 段且正文不少于 600 字')
  const telegramChars = variants?.telegram?.body?.length ?? 0
  if (!variants?.telegram?.title?.trim() || telegramChars < 150) errors.push('telegram 需要标题且正文不少于 150 字')
  const rawPosts = Array.isArray(variants?.x?.posts) ? variants.x.posts : []
  const posts = rawPosts.filter((post): post is string => typeof post === 'string')
  if (posts.length !== rawPosts.length) errors.push('x.posts 含非字符串条目')
  if (posts.length < 1 || posts.length > 12) errors.push('x.posts 需要 1-12 条')
  posts.forEach((post, index) => { if (!post.trim() || post.length > 280) errors.push(`x.posts[${index}] 为空或超过 280 字`) })
  const xiaohongshuChars = variants?.xiaohongshu?.body?.length ?? 0
  if (!variants?.xiaohongshu?.title?.trim() || variants.xiaohongshu.title.length > 30) errors.push('xiaohongshu.title 必填且 ≤30 字')
  if (xiaohongshuChars < 250) errors.push('xiaohongshu.body 不少于 250 字')
  if (!Array.isArray(variants?.xiaohongshu?.hashtags) || variants.xiaohongshu.hashtags.length < 3 || variants.xiaohongshu.hashtags.some((tag) => typeof tag !== 'string' || !tag.trim())) errors.push('xiaohongshu.hashtags 至少 3 个有效标签')

  const rawAssets = Array.isArray(submission.assets) ? submission.assets : []
  const assets = rawAssets.filter((asset): asset is DraftAssetPlan => typeof asset === 'object' && asset !== null)
  if (assets.length !== rawAssets.length) errors.push('assets 含非对象条目')
  const assetIds = new Set<string>()
  const platformOrders = new Set<string>()
  for (const [index, asset] of assets.entries()) {
    if (!/^[a-z0-9][a-z0-9._-]{2,48}$/i.test(asset.id ?? '')) errors.push(`assets[${index}].id 不合法`)
    if (assetIds.has(asset.id)) errors.push(`assets[${index}].id 重复`)
    assetIds.add(asset.id)
    if (!asset.prompt?.trim() || !asset.altText?.trim() || !asset.placement?.trim()) errors.push(`assets[${index}] prompt/altText/placement 必填`)
    if (!['cover', 'inline', 'carousel'].includes(asset.kind)) errors.push(`assets[${index}].kind 不合法`)
    if (!['2.35:1', '16:9', '3:4', '1:1'].includes(asset.aspectRatio)) errors.push(`assets[${index}].aspectRatio 不合法`)
    if (contractVersion >= 2) {
      const platforms = Array.isArray(asset.platforms) ? asset.platforms : []
      if (platforms.length === 0 || platforms.some((platform) => !['wechat', 'telegram', 'x', 'xiaohongshu'].includes(platform))) {
        errors.push(`assets[${index}].platforms 必须是非空合法平台数组`)
      }
      if (!Number.isSafeInteger(asset.order) || Number(asset.order) < 1) errors.push(`assets[${index}].order 必须是正整数`)
      if (typeof asset.required !== 'boolean') errors.push(`assets[${index}].required 必须明确为 boolean`)
      if (!['wechat-cover', 'wechat-inline', 'xhs-cover', 'xhs-carousel', 'telegram-asset', 'x-asset'].includes(asset.role ?? '')) {
        errors.push(`assets[${index}].role 不合法`)
      }
      for (const platform of platforms) {
        const key = `${platform}:${asset.order}`
        if (platformOrders.has(key)) errors.push(`assets[${index}] 平台/order 重复：${key}`)
        platformOrders.add(key)
      }
      const allowedRatios: Partial<Record<NonNullable<DraftAssetPlan['role']>, DraftAssetPlan['aspectRatio'][]>> = {
        'wechat-cover': ['2.35:1'], 'wechat-inline': ['16:9'],
        'xhs-cover': ['3:4'], 'xhs-carousel': ['3:4', '1:1'],
        'telegram-asset': ['16:9', '1:1'], 'x-asset': ['16:9', '1:1'],
      }
      if (asset.role && !allowedRatios[asset.role]?.includes(asset.aspectRatio)) errors.push(`assets[${index}] 比例与 role 不匹配`)
      const expectedPlatform = asset.role?.startsWith('wechat-') ? 'wechat'
        : asset.role?.startsWith('xhs-') ? 'xiaohongshu'
          : asset.role === 'telegram-asset' ? 'telegram' : asset.role === 'x-asset' ? 'x' : null
      if (expectedPlatform && !platforms.includes(expectedPlatform)) errors.push(`assets[${index}] role 必须声明平台 ${expectedPlatform}`)
    }
  }
  if (!assets.some((asset) => asset.kind === 'cover')) errors.push('assets 至少包含 1 张封面图')
  if (assets.filter((asset) => asset.kind === 'inline' || asset.kind === 'carousel').length < 2) errors.push('assets 至少包含 2 张正文/轮播配图')
  for (const block of wechatBlocks) if (block.type === 'image' && !assetIds.has(block.assetId)) errors.push(`wechat image 引用了未知 assetId：${block.assetId}`)
  if (contractVersion >= 2) {
    const required = (role: DraftAssetRole, predicate: (asset: DraftAssetPlan) => boolean = () => true): boolean => assets.some((asset) => asset.role === role && asset.required === true && predicate(asset))
    if (!required('wechat-cover')) errors.push('contract v2 微信至少需要 required wechat-cover')
    if (!required('wechat-inline')) errors.push('contract v2 微信至少需要 required wechat-inline')
    if (!required('xhs-cover', (asset) => asset.order === 1)) errors.push('contract v2 小红书需要 required xhs-cover(order=1)')
    if (!required('xhs-carousel', (asset) => Number(asset.order) >= 2)) errors.push('contract v2 小红书需要 required xhs-carousel(order≥2)')
    const references = [...(variants?.xiaohongshu?.body ?? '').matchAll(/(?:asset:\/\/|\{\{asset:)([a-z0-9][a-z0-9._-]{2,48})/gi)].map((match) => match[1])
    for (const assetId of references) if (!assetIds.has(assetId)) errors.push(`xiaohongshu 正文引用了未知 assetId：${assetId}`)
  }
  if (!wechatBlocks.some((block) => block.type === 'image')) warnings.push('微信公众号正文没有图片占位块')
  const allText = JSON.stringify(submission)
  if (/自动发布|无需人工审核|绕过审核/.test(allText)) errors.push('草稿触发人工发布红线')
  if (card.risks.length > 0 && !card.risks.some((risk) => allText.includes(risk))) warnings.push('选题风险未逐字出现在草稿中，请人工重点复核')
  return {
    ok: errors.length === 0, errors, warnings,
    stats: { wechatChars, telegramChars, xPosts: posts.length, xiaohongshuChars, assets: assets.length, facts: claims.length },
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function wechatHtml(submission: DraftSubmission): string {
  const block = (item: WechatBlock): string => {
    if (item.type === 'heading') return `<h${item.level}>${escapeHtml(item.text)}</h${item.level}>`
    if (item.type === 'paragraph') return `<p>${escapeHtml(item.text).replaceAll('\n', '<br>')}</p>`
    if (item.type === 'quote') return `<blockquote>${escapeHtml(item.text)}${item.sourceUrl ? `<small>${escapeHtml(item.sourceUrl)}</small>` : ''}</blockquote>`
    if (item.type === 'list') return `<ul>${item.items.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
    const asset = submission.assets.find((value) => value.id === item.assetId)
    return `<figure data-asset-id="${escapeHtml(item.assetId)}"><div class="image-slot">配图：${escapeHtml(asset?.altText ?? item.assetId)}</div><figcaption>${escapeHtml(item.caption)}</figcaption></figure>`
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(submission.variants.wechat.title)}</title><style>body{margin:0;background:#f5f2ec;color:#2f2a24;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.article{max-width:720px;margin:0 auto;background:#fff;padding:36px 28px 64px}h1{font-size:28px;line-height:1.35;margin:0 0 12px}h2{font-size:21px;margin:34px 0 12px;border-left:4px solid #e8563d;padding-left:10px}h3{font-size:18px;margin:26px 0 10px}.dek{color:#766b5d;font-size:15px;border-bottom:1px solid #e8dcc8;padding-bottom:22px}p,li{font-size:16px;line-height:1.9}blockquote{margin:22px 0;padding:14px 18px;background:#fff8ef;border-left:3px solid #f5a95c;color:#5f5548}blockquote small{display:block;margin-top:8px;color:#8a7b63}.image-slot{min-height:220px;border:1px dashed #b5a78e;background:#fff8ef;display:flex;align-items:center;justify-content:center;color:#8a7b63;padding:20px;text-align:center}figure{margin:26px 0}figcaption{font-size:12px;color:#8a7b63;text-align:center;margin-top:6px}.boundary{margin-top:36px;padding:14px;background:#f5f2ec;font-size:13px;line-height:1.7;color:#766b5d}</style></head><body><article class="article"><h1>${escapeHtml(submission.variants.wechat.title)}</h1><div class="dek">${escapeHtml(submission.variants.wechat.dek)}</div>${submission.variants.wechat.blocks.map(block).join('')}<div class="boundary"><b>事实边界：</b>${escapeHtml(submission.factBoundary)}</div></article></body></html>`
}

function wechatMarkdown(submission: DraftSubmission): string {
  const lines = [`# ${submission.variants.wechat.title}`, '', `> ${submission.variants.wechat.dek}`, '']
  for (const item of submission.variants.wechat.blocks) {
    if (item.type === 'heading') lines.push(`${'#'.repeat(item.level)} ${item.text}`, '')
    else if (item.type === 'paragraph') lines.push(item.text, '')
    else if (item.type === 'quote') lines.push(`> ${item.text}${item.sourceUrl ? `（${item.sourceUrl}）` : ''}`, '')
    else if (item.type === 'list') lines.push(...item.items.map((value) => `- ${value}`), '')
    else lines.push(`![${item.caption}](asset://${item.assetId})`, '')
  }
  lines.push('---', `事实边界：${submission.factBoundary}`)
  return lines.join('\n') + '\n'
}

function artifactContents(submission: DraftSubmission): Record<string, { platform: string; format: string; content: string }> {
  return {
    'wechat.html': { platform: 'wechat', format: 'html', content: wechatHtml(submission) },
    'wechat.md': { platform: 'wechat', format: 'markdown', content: wechatMarkdown(submission) },
    'telegram.md': { platform: 'telegram', format: 'markdown', content: `# ${submission.variants.telegram.title}\n\n${submission.variants.telegram.body}\n` },
    'x-thread.md': { platform: 'x', format: 'markdown', content: submission.variants.x.posts.map((post, index) => `${index + 1}/${submission.variants.x.posts.length} ${post}`).join('\n\n---\n\n') + '\n' },
    'xiaohongshu.md': { platform: 'xiaohongshu', format: 'markdown', content: `# ${submission.variants.xiaohongshu.title}\n\n${submission.variants.xiaohongshu.body}\n\n${submission.variants.xiaohongshu.hashtags.map((tag) => tag.startsWith('#') ? tag : '#' + tag).join(' ')}\n` },
    'assets.json': { platform: 'shared', format: 'json', content: JSON.stringify(submission.assets, null, 2) + '\n' },
    'package.json': { platform: 'shared', format: 'json', content: JSON.stringify(submission, null, 2) + '\n' },
  }
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function writeArtifacts(packageId: string, submission: DraftSubmission, now: Date, folderDate: string): { dir: string; artifacts: DraftArtifact[]; created: boolean } {
  const date = folderDate.slice(0, 10)
  const relativeDir = path.join('drafts', 'factory', date, packageId)
  const target = path.join(VAULT_ROOT, relativeDir)
  const contents = artifactContents(submission)
  let created = false
  if (existsSync(target)) {
    // 产物完整性：目录已存在时校验全部允许文件（8 个），不能只比较 package.json。
    verifyArtifactDir(target, relativeDir, packageId, contents)
  } else {
    created = true
    const parent = path.dirname(target)
    mkdirSync(parent, { recursive: true })
    const staging = path.join(parent, '.' + packageId + '-' + randomUUID() + '.tmp')
    mkdirSync(staging, { recursive: true })
    try {
      for (const [file, spec] of Object.entries(contents)) writeFileSync(path.join(staging, file), spec.content, 'utf8')
      const manifest = Object.entries(contents).map(([file, spec]) => ({ file, platform: spec.platform, format: spec.format, sha256: sha256(spec.content), bytes: Buffer.byteLength(spec.content) }))
      writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ packageId, generatedAt: now.toISOString(), artifacts: manifest }, null, 2) + '\n', 'utf8')
      renameSync(staging, target)
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      throw error
    }
  }
  const all = { ...contents, 'manifest.json': { platform: 'shared', format: 'json', content: readFileSync(path.join(target, 'manifest.json'), 'utf8') } }
  const artifacts = Object.entries(all).map(([file, spec]) => ({
    id: randomUUID(), platform: spec.platform, format: spec.format,
    relativePath: path.join(relativeDir, file), sha256: sha256(spec.content), bytes: Buffer.byteLength(spec.content),
  }))
  return { dir: relativeDir, artifacts, created }
}

/**
 * 校验已存在的产物目录与将要写入的内容完全一致：
 * - 全部 8 个允许文件（7 个产物 + manifest.json），一个不能多、一个不能少；
 * - manifest 覆盖关系（声明的文件集合 = 7 个产物）、SHA、bytes 逐项比对；
 * - 拒绝 symlink、目录越界（realpath 逃逸 VAULT）、任一内容变化。
 */
function verifyArtifactDir(target: string, relativeDir: string, packageId: string, contents: Record<string, { platform: string; format: string; content: string }>): void {
  const fail = (reason: string): never => { throw new Error('草稿产物目录完整性校验失败（' + reason + '），拒绝复用：' + relativeDir) }
  const rootReal = realpathSync(VAULT_ROOT)
  const targetReal = realpathSync(target)
  if (targetReal !== realpathSync(path.resolve(VAULT_ROOT, relativeDir)) || !targetReal.startsWith(rootReal + path.sep)) fail('目录 realpath 越界')
  if (lstatSync(target).isSymbolicLink()) fail('目录是 symlink')
  const present = readdirSync(target)
  const expectedFiles = [...Object.keys(contents), 'manifest.json']
  const extra = present.filter((file) => !expectedFiles.includes(file))
  if (extra.length > 0) fail('存在未声明文件：' + extra.join(', '))
  const missing = expectedFiles.filter((file) => !present.includes(file))
  if (missing.length > 0) fail('缺失文件：' + missing.join(', '))
  // 全部 8 个文件（含 manifest.json 本身）先做 lstat 普通文件检查，再读取任何内容——
  // symlink 的 manifest 不得被跟随。
  for (const file of expectedFiles) {
    const info = lstatSync(path.join(target, file))
    if (!info.isFile() || info.isSymbolicLink()) fail('产物不是普通文件：' + file)
  }
  // manifest 结构与覆盖关系
  const manifest: { packageId?: unknown; artifacts?: unknown } = (() => {
    try {
      return JSON.parse(readFileSync(path.join(target, 'manifest.json'), 'utf8')) as { packageId?: unknown; artifacts?: unknown }
    } catch {
      return fail('manifest.json 不可解析')
    }
  })()
  if (manifest.packageId !== packageId) fail('manifest packageId 不匹配')
  const declared = Array.isArray(manifest.artifacts) ? manifest.artifacts as Array<{ file?: unknown; sha256?: unknown; bytes?: unknown }> : []
  const declaredFiles = declared.map((item) => String(item.file))
  const contentFiles = Object.keys(contents)
  if (declaredFiles.length !== contentFiles.length || contentFiles.some((file, index) => declaredFiles[index] !== file)) fail('manifest 未完整覆盖 7 个产物文件')
  for (const item of declared) {
    const file = String(item.file)
    const info = lstatSync(path.join(target, file))
    if (!info.isFile() || info.isSymbolicLink()) fail('产物不是普通文件：' + file)
    const data = readFileSync(path.join(target, file))
    if (String(item.bytes) !== String(data.byteLength)) fail('manifest bytes 不匹配：' + file)
    if (item.sha256 !== sha256(data)) fail('manifest SHA 不匹配：' + file)
  }
  // 逐文件内容与将写入内容一致（含 package.json 在内的全部产物）
  for (const [file, spec] of Object.entries(contents)) {
    const data = readFileSync(path.join(target, file))
    if (sha256(data) !== sha256(spec.content) || data.byteLength !== Buffer.byteLength(spec.content)) fail('内容与本次提交不一致：' + file)
  }
}

export function submitDraftPackage(db: DatabaseSync, submission: DraftSubmission, now = new Date()): { package: DraftPackage; validation: DraftValidation } {
  const current = packageById(db, submission.packageId)
  if (!current) throw new Error('草稿包不存在：' + submission.packageId)
  if (current.status !== 'awaiting_generation' && current.status !== 'validation_failed') throw new Error('草稿包当前状态不可提交：' + current.status)
  const card = editorialCardById(db, current.cardId)
  if (!card || card.decision !== 'approved') throw new Error('来源选题卡未批准或不存在')
  const validation = validateDraftSubmission(submission, card, current.contractVersion)
  const at = now.toISOString()
  if (!validation.ok) {
    db.prepare(`UPDATE draft_packages SET status='validation_failed', submission_json=?, validation_json=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify(submission), JSON.stringify(validation), at, current.id)
    return { package: packageById(db, current.id)!, validation }
  }
  let job = getJob(db, current.jobId)
  if (!job) throw new Error('草稿生成任务不存在：' + current.jobId)
  if (job.status === 'failed') job = transitionJob(db, job.id, 'queued', { note: 'valid resubmission retry', now })
  if (job.status === 'queued') job = startJob(db, job.id, 'sparkos-content-inline', now)
  if (job.status !== 'running') throw new Error('草稿生成任务当前状态不可提交：' + job.status)
  // 可恢复语义的精确条件：仅当「本次调用新建目录」且「数据库尚未提交」时才允许清理。
  // 复用的既有目录（created=false）与已 COMMIT 的目录（dbCommitted=true）都是权威状态，绝不能删。
  let createdDirThisCall: string | null = null
  let dbCommitted = false
  try {
    const written = writeArtifacts(current.id, submission, now, current.createdAt)
    if (written.created) createdDirThisCall = written.dir
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        UPDATE draft_packages SET status='waiting_approval', submission_json=?, validation_json=?, artifact_dir=?, updated_at=? WHERE id=?
      `).run(JSON.stringify(submission), JSON.stringify(validation), written.dir, at, current.id)
      db.prepare('DELETE FROM draft_artifacts WHERE package_id = ?').run(current.id)
      const insert = db.prepare(`
        INSERT INTO draft_artifacts(id, package_id, platform, format, relative_path, sha256, bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const artifact of written.artifacts) insert.run(artifact.id, current.id, artifact.platform, artifact.format, artifact.relativePath, artifact.sha256, artifact.bytes, at)
      db.prepare(`
        INSERT INTO approvals(id, subject_kind, subject_id, decision, created_at)
        VALUES (?, 'draft_package', ?, 'pending', ?)
        ON CONFLICT(subject_kind, subject_id) DO UPDATE SET decision='pending', note=NULL, decided_at=NULL
      `).run(randomUUID(), current.id, at)
      db.exec('COMMIT')
      dbCommitted = true
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    transitionJob(db, job.id, 'waiting_approval', { output: { packageId: current.id, artifacts: written.artifacts.length }, now })
  } catch (error) {
    // 可恢复语义：仅清理「本次新建且未落库」的半成品目录。
    // - 复用的既有目录（created=false）：本就是权威产物，校验已通过，不得删除；
    // - DB 已 COMMIT 后的失败（如 transitionJob 出错）：SQLite 行已指向该目录，
    //   删除会留下数据库指向不存在文件的状态，同样不得删除。
    if (createdDirThisCall !== null && !dbCommitted) {
      const absoluteDir = path.join(VAULT_ROOT, createdDirThisCall)
      rmSync(absoluteDir, { recursive: true, force: true })
    }
    transitionJob(db, job.id, 'failed', { error: error instanceof Error ? error.message : String(error), now })
    db.prepare(`UPDATE draft_packages SET status='validation_failed', validation_json=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify({ ...validation, ok: false, errors: [...validation.errors, 'artifact-write: ' + (error instanceof Error ? error.message : String(error))] }), at, current.id)
    throw error
  }
  return { package: packageById(db, current.id)!, validation }
}

export function decideDraftPackage(db: DatabaseSync, packageId: string, decision: 'approved' | 'rejected', note?: string, now = new Date()): DraftPackage {
  if (!/^dp-[a-f0-9]{16}$/.test(packageId)) throw new Error('草稿包 id 不合法')
  const current = packageById(db, packageId)
  if (!current) throw new Error('草稿包不存在：' + packageId)
  if (current.status !== 'waiting_approval') throw new Error('草稿包不在待审状态：' + current.status)
  const normalizedNote = note?.trim() || null
  if (decision === 'rejected' && normalizedNote === null) throw new Error('驳回草稿必须填写审核意见')
  const at = now.toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE draft_packages SET status=?, decided_at=?, updated_at=? WHERE id=?').run(decision, at, at, packageId)
    db.prepare(`UPDATE approvals SET decision=?, note=?, decided_at=? WHERE subject_kind='draft_package' AND subject_id=?`)
      .run(decision, normalizedNote, at, packageId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const job = getJob(db, current.jobId)
  if (job?.status === 'waiting_approval') transitionJob(db, job.id, decision === 'approved' ? 'succeeded' : 'cancelled', { note: `draft package ${decision}`, now })
  return packageById(db, packageId)!
}

/**
 * 读取草稿产物：SQLite 是唯一权威（sha256/bytes），响应前校验普通文件、realpath、
 * SHA 与大小；篡改后抛出明确完整性错误（调用方 422），绝不继续预览可疑内容。
 */
export function readDraftArtifact(db: DatabaseSync, packageId: string, file: string): { content: Buffer; format: string; platform: string } | null {
  if (!/^dp-[a-f0-9]{16}$/.test(packageId) || !/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(file)) return null
  const rows = db.prepare(`
    SELECT platform, format, relative_path, sha256, bytes FROM draft_artifacts WHERE package_id = ?
  `).all(packageId) as Array<{ platform: string; format: string; relative_path: string; sha256: string; bytes: number }>
  const row = rows.find((item) => path.basename(item.relative_path) === file)
  if (!row) return null
  const root = path.resolve(VAULT_ROOT)
  const absolute = path.resolve(VAULT_ROOT, row.relative_path)
  if (!absolute.startsWith(root + path.sep)) return null
  let info
  let real: string
  let data: Buffer
  try {
    info = lstatSync(absolute)
    real = realpathSync(absolute)
    data = readFileSync(absolute)
  } catch {
    throw new Error('draft-artifact-integrity: 产物文件不可读：' + row.relative_path)
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('draft-artifact-integrity: 产物必须是普通文件（拒绝 symlink）：' + row.relative_path)
  const rootReal = realpathSync(root)
  if (real !== realpathSync(absolute) || !real.startsWith(rootReal + path.sep)) throw new Error('draft-artifact-integrity: 产物 realpath 越界：' + row.relative_path)
  if (data.byteLength !== Number(row.bytes)) throw new Error('draft-artifact-integrity: 产物大小与数据库记录不一致：' + row.relative_path)
  if (sha256(data) !== row.sha256) throw new Error('draft-artifact-integrity: 产物 SHA-256 与数据库记录不一致：' + row.relative_path)
  return { content: data, format: row.format, platform: row.platform }
}
