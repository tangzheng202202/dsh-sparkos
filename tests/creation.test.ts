import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DraftSubmission } from '../src/creation/drafts.ts'
import type { IntelCluster } from '../src/intel/cluster.ts'

const root = mkdtempSync(path.join(tmpdir(), 'sparkos-creation-'))
process.env.SPARKOS_VAULT_ROOT = path.join(root, 'vault')
after(() => rmSync(root, { recursive: true, force: true }))

const evidenceUrl = 'https://official.example/creation'

function intelCluster(suffix = ''): IntelCluster {
  return {
    clusterId: 'c-20260822-001', topicKey: 't-creation-test' + suffix, date: '20260822', topic: 'AI 内容工厂创作测试' + suffix,
    coreFacts: ['产品已发布', '功能已有官方说明'], heat: 'high', novelty: 'high', sourceCount: 1,
    evidenceUrls: [evidenceUrl], evidence: [{ url: evidenceUrl, sourceType: 'official', verified: true }],
    knowledgeCards: ['obs://creation'], credibility: 'high', risks: ['样本仍然有限'], platforms: ['wechat', 'telegram', 'x', 'xiaohongshu'],
    angleSuggestions: ['从结构变化切入'], eventKeys: ['e1', 'e2', 'e3'],
    judgment: { confirmedFacts: ['产品已发布'], inferences: ['可能影响流程'], editorialView: '关键是内容生产从单篇写作转向可审计流水线。', counterArguments: ['工具增加也可能增加复杂度'], uncertainties: ['样本仍然有限'] },
  }
}

function validSubmission(packageId: string): DraftSubmission {
  const paragraph = '这是围绕已确认事实展开的完整分析段落。它明确区分事实、推断和观点，并解释内容工厂如何通过证据链、任务状态与人工审核提升稳定性。'.repeat(4)
  return {
    packageId, editorialAngle: '从单篇写作转向可审计流水线', keyMessage: '自动化的价值来自可靠流程，而不是跳过判断。',
    factBoundary: '产品发布与官方功能属于已确认事实；长期影响仍是推断，样本仍然有限。',
    factClaims: [
      { text: '产品已发布', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '功能已有官方说明', kind: 'fact', evidenceUrls: [evidenceUrl] },
      { text: '可能改变内容团队流程', kind: 'inference', evidenceUrls: [] },
    ],
    variants: {
      wechat: {
        title: 'AI 内容工厂真正改变的是什么', dek: '从热点、证据到四平台草稿，关键是可审计的生产流程。',
        blocks: [
          { type: 'heading', level: 2, text: '先说结论' },
          { type: 'paragraph', text: paragraph },
          { type: 'image', assetId: 'inline-flow', caption: '内容工厂流程图' },
          { type: 'heading', level: 2, text: '事实与推断的边界' },
          { type: 'paragraph', text: paragraph },
          { type: 'paragraph', text: '样本仍然有限，因此这里保留风险说明。' + paragraph },
        ],
      },
      telegram: { title: 'AI 内容工厂：关键不是多写几篇', body: paragraph + paragraph },
      x: { posts: ['1/3 内容工厂的重点不是让模型替人拍板，而是把情报、证据、判断和审核连接起来。', '2/3 已确认的是产品和功能；长期影响仍需更多样本。', '3/3 自动化越强，事实边界和人工闸门越重要。'] },
      xiaohongshu: { title: 'AI内容工厂避坑指南', body: paragraph + paragraph, hashtags: ['AI工具', '内容创作', '自媒体'] },
    },
    assets: [
      { id: 'cover-main', kind: 'cover', prompt: '暖色编辑工作台，信息流汇入内容生产线，无文字', altText: 'AI 内容工厂封面', aspectRatio: '2.35:1', placement: '微信公众号封面' },
      { id: 'inline-flow', kind: 'inline', prompt: '情报到审核的四阶段流程信息图，无小字', altText: '内容生产流程', aspectRatio: '16:9', placement: '微信正文第一节后' },
      { id: 'carousel-proof', kind: 'carousel', prompt: '事实、推断、观点三层卡片', altText: '事实边界卡片', aspectRatio: '3:4', placement: '小红书第二张' },
    ],
  }
}

async function approvedCardFixture(suffix = '') {
  const { openFactoryDatabase } = await import('../src/storage/database.ts')
  const { generateDailyRanking } = await import('../src/intel/ranking.ts')
  const { generateEditorialPlan, decideEditorialCard } = await import('../src/editorial/planner.ts')
  const db = openFactoryDatabase({ path: ':memory:' })
  generateDailyRanking(db, [intelCluster(suffix)], '2026-08-22')
  const plan = generateEditorialPlan(db, 'weekly', '2026-08-22')
  decideEditorialCard(db, plan.cards[0].id, 'approved')
  return { db, card: plan.cards[0] }
}

test('approved editorial card creates one idempotent structured creation request', async () => {
  const { ensureDraftRequest, pendingDraftRequests } = await import('../src/creation/drafts.ts')
  const { db, card } = await approvedCardFixture()
  const first = ensureDraftRequest(db, card.id)
  const again = ensureDraftRequest(db, card.id)
  assert.equal(first.created, true)
  assert.equal(again.created, false)
  assert.equal(first.package.id, again.package.id)
  assert.deepEqual(first.package.request.requiredPlatforms, ['wechat', 'telegram', 'x', 'xiaohongshu'])
  assert.equal(pendingDraftRequests(db).length, 1)
  db.close()
})

test('unsupported facts fail validation and keep the generation job retryable', async () => {
  const { ensureDraftRequest, submitDraftPackage } = await import('../src/creation/drafts.ts')
  const { getJob } = await import('../src/storage/jobs.ts')
  const { db, card } = await approvedCardFixture()
  const draft = ensureDraftRequest(db, card.id).package
  const submission = validSubmission(draft.id)
  submission.factClaims[0].evidenceUrls = ['https://invented.example/nope']
  const result = submitDraftPackage(db, submission)
  assert.equal(result.validation.ok, false)
  assert.equal(result.package.status, 'validation_failed')
  assert.match(result.validation.errors.join(' '), /选题卡之外的证据/)
  assert.equal(getJob(db, draft.jobId)?.status, 'queued')
  assert.equal(result.package.artifacts.length, 0)
  db.close()
})

test('draft rejection requires a note and exposes it to v2 requests and factory summaries', async () => {
  const { ensureDraftRequest, submitDraftPackage, decideDraftPackage, reviseDraftRequest, listDraftPackageSummaries } = await import('../src/creation/drafts.ts')
  const { db, card } = await approvedCardFixture('-review-note')
  const v1 = ensureDraftRequest(db, card.id).package
  submitDraftPackage(db, validSubmission(v1.id), new Date('2026-08-22T10:00:00Z'))
  assert.throws(() => decideDraftPackage(db, v1.id, 'rejected'), /必须填写审核意见/)
  assert.throws(() => decideDraftPackage(db, v1.id, 'rejected', '   '), /必须填写审核意见/)
  const stillWaiting = listDraftPackageSummaries(db).find((item) => item.id === v1.id)!
  assert.equal(stillWaiting.status, 'waiting_approval')

  const rejected = decideDraftPackage(db, v1.id, 'rejected', '  请重写开头并补充反方观点  ')
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.reviewNote, '请重写开头并补充反方观点')
  const approval = db.prepare("SELECT decision, note FROM approvals WHERE subject_kind='draft_package' AND subject_id=?").get(v1.id) as { decision: string; note: string }
  assert.equal(approval.decision, 'rejected')
  assert.equal(approval.note, '请重写开头并补充反方观点')

  const v2 = reviseDraftRequest(db, v1.id).package
  assert.equal(v2.parentReviewNote, '请重写开头并补充反方观点')
  assert.equal(v2.request.parentReviewNote, '请重写开头并补充反方观点')
  assert.match(v2.request.instructions.join('\n'), /请重写开头并补充反方观点/)
  const summaries = listDraftPackageSummaries(db)
  assert.equal(summaries.find((item) => item.id === v1.id)?.reviewNote, '请重写开头并补充反方观点')
  assert.equal(summaries.find((item) => item.id === v2.id)?.parentReviewNote, '请重写开头并补充反方观点')

  submitDraftPackage(db, validSubmission(v2.id), new Date('2026-08-22T11:00:00Z'))
  const approved = decideDraftPackage(db, v2.id, 'approved')
  assert.equal(approved.status, 'approved', '批准仍不强制填写意见')
  assert.equal(listDraftPackageSummaries(db).find((item) => item.id === v1.id)?.status, 'rejected')
  assert.equal(listDraftPackageSummaries(db).find((item) => item.id === v2.id)?.status, 'approved')
  db.close()
})

test('valid submission writes safe artifacts; rejection creates an immutable revision that can be approved', async () => {
  const { ensureDraftRequest, submitDraftPackage, readDraftArtifact, decideDraftPackage, reviseDraftRequest } = await import('../src/creation/drafts.ts')
  const { getJob } = await import('../src/storage/jobs.ts')
  const { db, card } = await approvedCardFixture()
  const draft = ensureDraftRequest(db, card.id).package
  const submission = validSubmission(draft.id)
  submission.variants.wechat.blocks[1] = { type: 'paragraph', text: '<script>alert(1)</script>' + '安全正文。'.repeat(160) }
  const result = submitDraftPackage(db, submission, new Date('2026-08-22T12:00:00Z'))
  assert.equal(result.validation.ok, true)
  assert.equal(result.package.status, 'waiting_approval')
  assert.equal(result.package.artifacts.length, 8)
  assert.equal(getJob(db, draft.jobId)?.status, 'waiting_approval')
  const html = readDraftArtifact(db, draft.id, 'wechat.html')!
  const rendered = html.content.toString('utf8')
  assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(!rendered.includes('<script>'))
  assert.match(rendered, /data-asset-id="inline-flow"/)
  const rejected = decideDraftPackage(db, draft.id, 'rejected', '需要调整开头')
  assert.equal(rejected.status, 'rejected')
  assert.equal(getJob(db, draft.jobId)?.status, 'cancelled')
  const revision = reviseDraftRequest(db, draft.id)
  assert.equal(revision.created, true)
  assert.equal(revision.package.revision, 2)
  assert.equal(revision.package.parentPackageId, draft.id)
  assert.equal(reviseDraftRequest(db, draft.id).package.id, revision.package.id, 'revision request is idempotent')
  submitDraftPackage(db, validSubmission(revision.package.id), new Date('2026-08-22T13:00:00Z'))
  const approved = decideDraftPackage(db, revision.package.id, 'approved', '内容与证据通过')
  assert.equal(approved.status, 'approved')
  assert.equal(getJob(db, revision.package.jobId)?.status, 'succeeded')
  db.close()
})
