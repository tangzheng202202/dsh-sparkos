/**
 * 渲染统一工作台 HTML 到 /tmp/sparkos-wb.html（无宿主也可跑 DOM 检查）。
 * 用法：node --experimental-strip-types scripts/render-page.mjs [out.html]
 * M8 起 /sparkos/app 与 /sparkos/app-v2 是同一份统一模板；--v2 参数保留为兼容
 * （被忽略），渲染结果与默认完全一致，并顺带写 /tmp/sparkos-wb-v2.html 供 DOM 检查。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Portable fallback: when no real VAULT is configured, render against seeds +
// one minimal daily fixture. Imports are intentionally dynamic so env paths are
// resolved after the temporary root is selected.
let fixtureRoot = null
if (!process.env.SPARKOS_VAULT_ROOT) {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sparkos-render-'))
  const vault = path.join(fixtureRoot, 'vault')
  const daily = path.join(fixtureRoot, 'daily')
  mkdirSync(daily, { recursive: true })
  process.env.SPARKOS_VAULT_ROOT = vault
  process.env.SPARKOS_CONTENTOS_ROOT = fixtureRoot
  process.env.SPARKOS_DAILY_BRIEF_DIR = daily
  process.env.SPARKOS_RUNTIME_EVENTS = path.join(vault, 'archive', 'events.jsonl')
  process.env.SPARKOS_TIMELINE_DATA = path.join(vault, 'config', 'timeline_cards.json')
  writeFileSync(path.join(daily, 'daily_data_2026-08-22.json'), JSON.stringify({
    date: '2026-08-22',
    must_reads: [
      { event_id: 'render-fixture-1', title: '工作台渲染检查', fresh_hours: 1, primary_line: 'line-001' },
      { event_id: 'render-fixture-2', title: '必读第二条（忽略路径）', fresh_hours: 30, primary_line: 'line-002' },
      { event_id: 'render-fixture-3', title: '必读第三条（失败重试路径）', fresh_hours: 72, primary_line: 'line-003' },
    ],
  }))
  writeFileSync(path.join(daily, 'daily_briefing_2026-08-22.md'), '# 每日简报\n\n- 工作台渲染检查\n')
  mkdirSync(path.join(daily, 'drafts'), { recursive: true })
  writeFileSync(path.join(daily, 'drafts', '2026-08-22-wechat.md'), '# 运行时草稿标题\n\n正文预览第一行。\n')
}

const { initVault } = await import('../src/vault.ts')
initVault()
if (fixtureRoot) {
  const vault = process.env.SPARKOS_VAULT_ROOT
  const lines = Array.from({ length: 10 }, (_, index) => ({ id: 'line-' + String(index + 1).padStart(3, '0') }))
  const names = Object.fromEntries(lines.map((line, index) => [line.id, '渲染主线' + (index + 1)]))
  const cards = Array.from({ length: 72 }, (_, index) => ({
    k: 'obs/' + String(index + 1).padStart(3, '0'),
    kind: 'observation',
    date: '2026-08-22',
    title: '渲染知识卡' + (index + 1),
    line: lines[index % lines.length].id,
  }))
  writeFileSync(path.join(vault, 'config', 'narrative_lines.json'), JSON.stringify({ lines }))
  writeFileSync(path.join(vault, 'config', 'line_names.json'), JSON.stringify(names))
  writeFileSync(path.join(vault, 'config', 'timeline_cards.json'), JSON.stringify({ cards }))
}
const { buildWorkbenchData } = await import('../src/server/data.ts')

const args = process.argv.slice(2)
const v2 = args.includes('--v2')
const positional = args.filter((a) => !a.startsWith('--'))
const out = positional[0] ?? (v2 ? '/tmp/sparkos-wb-v2.html' : '/tmp/sparkos-wb.html')
const workbenchData = buildWorkbenchData()
if (fixtureRoot) {
  const shared = {
    cardId: 'ec-1111111111111111', title: '审核意见渲染测试', validation: { errors: [] },
    assetCount: 2,
    artifacts: [
      { id: 'a1', platform: 'wechat', format: 'html', relativePath: 'drafts/factory/2026-08-22/dp-2222222222222222/wechat.html', sha256: 'a'.repeat(64), bytes: 512 },
      { id: 'a2', platform: 'x', format: 'md', relativePath: 'drafts/factory/2026-08-22/dp-2222222222222222/x-thread.md', sha256: 'b'.repeat(64), bytes: 256 },
    ],
    createdAt: '2026-08-22T10:00:00Z', updatedAt: '2026-08-22T11:00:00Z',
  }
  workbenchData.factory.drafts = [
    { ...shared, id: 'dp-1111111111111111', revision: 1, parentPackageId: null, status: 'rejected', reviewNote: '需要重写开头', parentReviewNote: null, decidedAt: '2026-08-22T11:00:00Z' },
    { ...shared, id: 'dp-2222222222222222', revision: 2, parentPackageId: 'dp-1111111111111111', status: 'approved', reviewNote: null, parentReviewNote: '需要重写开头', decidedAt: '2026-08-22T12:00:00Z' },
    { ...shared, id: 'dp-3333333333333333', revision: 3, parentPackageId: 'dp-2222222222222222', status: 'waiting_approval', reviewNote: null, parentReviewNote: null, decidedAt: null },
  ]
  const attempt = (id, taskId, provider = 'stub', overrides = {}) => ({
    id, taskId, attemptNo: 1, provider, model: 'stub-v1', sourceWidth: 900, sourceHeight: 383,
    sourceMediaType: 'image/png', sourceBytes: 64, importedRelativePath: 'visual/fixture.png', importedSha256: 'a'.repeat(64), status: 'waiting_visual_approval', approval: { decision: 'pending', note: null, decidedAt: null },
    ...overrides,
  })
  const task = (id, assetId, state, note, opts = {}) => {
    const attemptNo = opts.attemptNo || ({ 'cover-main': '1', 'inline-one': '2', 'carousel-one': '3', 'failure-one': '4', 'retry-one': '8', 'maxed-one': '9' }[assetId] ?? '5')
    const retryFallback = { eligible: false, reason: 'fixture-default', code: 'invalid-state', expectedNextAttemptNo: Number(attemptNo) + 1 }
    return {
      id, batchId: opts.batchId || 'vb-11111111111111111111', packageId: opts.packageId || 'dp-2222222222222222', assetId, kind: assetId === 'cover-main' ? 'cover' : 'inline',
      placement: opts.placement != null ? opts.placement : (assetId === 'cover-main' ? '微信公众号封面' : '微信正文第一节后'), prompt: opts.prompt != null ? opts.prompt : '<b>必须转义的提示词</b>', altText: opts.altText != null ? opts.altText : '安全替代文本',
      aspectRatio: assetId === 'cover-main' ? '2.35:1' : '16:9', targetWidth: 900, targetHeight: 383, state,
      pipelineState: 'waiting_visual_approval', currentAttempt: opts.currentAttempt || 1, maxAttempts: opts.maxAttempts || 3, failureCount: state === 'rejected' ? 1 : 0, retryCount: state === 'rejected' ? 1 : 0,
      reviewNote: note, retry: opts.retry || retryFallback, events: opts.events || [],
      attempts: [attempt('va-' + String(attemptNo).repeat(20), id, opts.provider || 'stub', { attemptNo: Number(opts.currentAttempt || 1), ...(opts.attemptOverrides || {}) })], createdAt: '2026-08-22T10:00:00Z', updatedAt: '2026-08-22T11:00:00Z',
    }
  }
  const xssTask = task('vt-55555555555555555555', 'xss-one', 'waiting_visual_approval', null, { attemptNo: 5, altText: '<img src=x onerror=lightboxAttack()>', prompt: '<script>pwned()</script> 封面提示词', placement: '<svg onload=svgAttack()> 位置' })
  const otherTask = task('vt-66666666666666666666', 'other-package', 'waiting_visual_approval', null, { attemptNo: 6, batchId: 'vb-22222222222222222222', packageId: 'dp-3333333333333333', altText: '另一包图片', prompt: '另一包提示词', placement: 'Telegram 配图' })
  // M6.2 fixture：可重试的已驳回非 stub 任务（888）与达到最大尝试次数的已驳回任务（999）
  const retryableTask = task('vt-88888888888888888888', 'retry-one', 'rejected', '构图需要重做：主体放大，去掉左下角杂物', {
    attemptNo: 8, provider: 'openai', currentAttempt: 1, maxAttempts: 3,
    retry: { eligible: true, reason: null, code: null, expectedNextAttemptNo: 2 },
    attemptOverrides: { provider: 'openai', model: 'image-model', approval: { decision: 'rejected', note: '构图需要重做：主体放大，去掉左下角杂物', decidedAt: '2026-08-22T12:40:00Z' } },
    events: [
      { id: 1, taskId: 'vt-88888888888888888888', attemptId: null, fromState: null, toState: 'queued', reason: 'created from approved immutable draft package', createdAt: '2026-08-22T10:00:00Z' },
      { id: 2, taskId: 'vt-88888888888888888888', attemptId: 'va-88888888888888888888', fromState: 'queued', toState: 'generating', reason: 'claimed with a hashed lease token', createdAt: '2026-08-22T10:01:00Z' },
      { id: 3, taskId: 'vt-88888888888888888888', attemptId: 'va-88888888888888888888', fromState: 'generated', toState: 'waiting_visual_approval', reason: 'M5A stops at human visual review gate', createdAt: '2026-08-22T10:05:00Z' },
      { id: 4, taskId: 'vt-88888888888888888888', attemptId: 'va-88888888888888888888', fromState: 'waiting_visual_approval', toState: 'rejected', reason: '构图需要重做：主体放大，去掉左下角杂物', createdAt: '2026-08-22T12:40:00Z' },
    ],
  })
  const maxedTask = task('vt-99999999999999999999', 'maxed-one', 'rejected', '已经重试过很多次', {
    attemptNo: 9, currentAttempt: 3, maxAttempts: 3,
    retry: { eligible: false, reason: '已达到最大重试次数', code: 'max-attempts-reached', expectedNextAttemptNo: null },
    attemptOverrides: { approval: { decision: 'rejected', note: '已经重试过很多次', decidedAt: '2026-08-22T12:50:00Z' } },
    events: [],
  })
  workbenchData.factory.visual = { batches: [{
    id: 'vb-11111111111111111111', packageId: 'dp-2222222222222222', revision: 2, sourceAssetsSha256: 'b'.repeat(64), status: 'partially_approved',
    requiredCount: 4, approvedCount: 0, createdAt: '2026-08-22T10:00:00Z', updatedAt: '2026-08-22T11:00:00Z',
    // M6.2 受控重试任务（888 可重试 / 999 达上限）仅注入 V2 fixture，保持 V1 视觉网格与 lightbox 顺序不变
    tasks: [task('vt-11111111111111111111', 'cover-main', 'waiting_visual_approval', null), task('vt-22222222222222222222', 'inline-one', 'waiting_visual_approval', null), task('vt-44444444444444444444', 'failure-one', 'waiting_visual_approval', null), task('vt-33333333333333333333', 'carousel-one', 'rejected', '<img src=x onerror=reviewAttack()>', { retry: { eligible: false, reason: '测试图片不可重试', code: 'stub-cannot-retry', expectedNextAttemptNo: 2 } }), xssTask, task('vt-77777777777777777777', 'approved-one', 'approved', null, { attemptNo: 7, attemptOverrides: { status: 'approved', importedRelativePath: null, approval: { decision: 'approved', note: '构图没问题', decidedAt: '2026-08-22T12:30:00Z' } } })].concat(v2 ? [retryableTask, maxedTask] : []),
    readiness: { required: 4, queued: 0, generating: 0, waitingVisualApproval: 3, failed: 0, readyForVisualApproval: true, visualApproved: false, testOnly: true, deliveryReady: false, readyByPlatform: { wechat: false, telegram: true, x: true, xiaohongshu: false }, readyForPublication: false, blockers: ['required-visual-assets-not-approved','wechat-production-delivery-missing','legacy-contract-v1-cannot-prove-xiaohongshu-complete','xiaohongshu-production-delivery-missing'] },
  }, {
    id: 'vb-22222222222222222222', packageId: 'dp-3333333333333333', revision: 3, sourceAssetsSha256: 'c'.repeat(64), status: 'waiting_visual_approval',
    requiredCount: 1, approvedCount: 0, createdAt: '2026-08-22T12:00:00Z', updatedAt: '2026-08-22T12:00:00Z',
    tasks: [otherTask],
    readiness: { required: 1, queued: 0, generating: 0, waitingVisualApproval: 1, failed: 0, readyForVisualApproval: true, visualApproved: false, testOnly: false, deliveryReady: false, readyByPlatform: { wechat: true, telegram: true, x: true, xiaohongshu: true }, readyForPublication: false, blockers: [] },
  // M6.4 fixture：交付就绪批次（全部批准、非 stub、契约完整），仅注入 V2
  }, v2 ? {
    id: 'vb-33333333333333333333', packageId: 'dp-5555555555555555', revision: 1, sourceAssetsSha256: 'd'.repeat(64), status: 'visual_approved',
    requiredCount: 2, approvedCount: 2, createdAt: '2026-08-22T13:00:00Z', updatedAt: '2026-08-22T13:00:00Z', deliveryLink: null,
    tasks: [
      task('vt-aaaaaaaaaaaaaaaaaaaa', 'deliv-cover', 'approved', null, { attemptNo: 21, provider: 'openai', attemptOverrides: { provider: 'openai', model: 'image-model', approval: { decision: 'approved', note: 'OK', decidedAt: '2026-08-22T13:10:00Z' } } }),
      task('vt-bbbbbbbbbbbbbbbbbbbb', 'deliv-inline', 'approved', null, { attemptNo: 31, provider: 'openai', attemptOverrides: { provider: 'openai', model: 'image-model', approval: { decision: 'approved', note: 'OK', decidedAt: '2026-08-22T13:11:00Z' } } }),
    ],
    readiness: { required: 2, queued: 0, generating: 0, waitingVisualApproval: 0, failed: 0, readyForVisualApproval: true, visualApproved: true, testOnly: false, deliveryReady: true, readyByPlatform: { wechat: true, telegram: true, x: true, xiaohongshu: true }, readyForPublication: true, blockers: [] },
  } : null,
  ].filter(Boolean) }
  // V2 fixture：可解释排名 + 编辑策划 + 情报簇（抽屉/导航/详情测试）
  const ranked = (id, rank, topic, grade) => ({
    rank, topicKey: id, clusterId: 'c-20260822-' + String(rank).padStart(3, '0'), topic,
    heatScore: 80 - rank * 5, overallScore: 75 - rank * 4, velocityScore: 60 - rank * 6, verificationGrade: grade,
    eligibleForCreation: grade === 'A' || grade === 'B', mentionCount: 20 - rank * 2, sourceCount: 5 - rank,
    consecutiveTopDays: Math.max(1, 5 - rank), breakdown: {}, evidenceUrls: ['https://example.com/a'], angleSuggestions: ['切入角度'], judgment: undefined,
  })
  workbenchData.factory.ranking = {
    date: '2026-08-22', generatedAt: '2026-08-22T09:00:00Z',
    top5: [ranked('t-1111111111111111', 1, '排位测试主题 A', 'A'), ranked('t-2222222222222222', 2, '排位测试主题 B', 'B'), ranked('t-3333333333333333', 3, '排位测试主题 C', 'C')],
    rising: [ranked('t-4444444444444444', 1, '上升测试主题', 'B')],
    persistent: [ranked('t-1111111111111111', 1, '排位测试主题 A', 'A')],
    creationCandidates: [ranked('t-1111111111111111', 1, '排位测试主题 A', 'A')],
    all: [ranked('t-1111111111111111', 1, '排位测试主题 A', 'A'), ranked('t-2222222222222222', 2, '排位测试主题 B', 'B')],
  }
  workbenchData.factory.editorial = {
    id: 'er-2222222222222222', mode: 'midweek', periodStart: '2026-08-19', periodEnd: '2026-08-22',
    status: 'pending_approval', generatedAt: '2026-08-22T08:00:00Z',
    summary: { windowDays: 3, rankedTopics: 8, evidenceEligible: 3, selected: 2, note: 'V2 fixture' },
    cards: [
      { id: 'ec-1111111111111111', rank: 1, topicKey: 't-1111111111111111', title: '策划卡主题甲', trendPattern: 'accelerating', coreThesis: '核心判断甲', whyNow: '为什么现在甲', facts: ['事实甲一', '事实甲二'], evidence: [{ url: 'https://example.com/e1', claim: '证据甲', sourceType: 'official', verified: true }], counterArguments: ['反方甲'], knowledgeCards: ['obs/001'], platforms: ['wechat', 'x'], contentFormat: '深度文', risks: ['风险甲'], verificationGrade: 'A', expectedValue: 8.5, decision: 'pending', decidedAt: null },
      { id: 'ec-2222222222222222', rank: 2, topicKey: 't-2222222222222222', title: '策划卡主题乙', trendPattern: 'persistent', coreThesis: '核心判断乙', whyNow: '为什么现在乙', facts: ['事实乙'], evidence: [], counterArguments: [], knowledgeCards: [], platforms: ['xiaohongshu'], contentFormat: '图文', risks: [], verificationGrade: 'B', expectedValue: 7.2, decision: 'pending', decidedAt: null },
    ],
  }
  // 任务记录：供总览「任务记录」中文状态映射测试
  workbenchData.factory.database = { schemaVersion: 5, jobs: { succeeded: 3, waiting_approval: 1, failed: 1, cancelled: 1 }, path: '/tmp/sparkos-fixture.db' }
  workbenchData.clusters = {
    date: '20260822',
    items: [{
      clusterId: 'c-20260822-001', topicKey: 't-1111111111111111', date: '20260822', topic: '排位测试主题 A',
      coreFacts: ['事实一', '事实二'], heat: 'high', novelty: 'medium', sourceCount: 2,
      evidenceUrls: ['https://example.com/a', 'https://example.com/b'], knowledgeCards: ['obs/001'], credibility: 'high',
      risks: ['风险一', '风险二'], platforms: ['wechat', 'x'], angleSuggestions: ['切入角度一'],
      eventKeys: ['ev-20260822-1'], model: 'test-model',
      judgment: { confirmedFacts: ['已确认一'], inferences: ['推断一'], editorialView: '编辑视角一', counterArguments: ['反方一'], uncertainties: ['不确定一'] },
    }],
  }
}
const { escapeJsonForScript } = await import('../src/server/security.ts')
const data = escapeJsonForScript(workbenchData)
function renderTemplate(templatePath, target) {
  const template = readFileSync(fileURLToPath(new URL(templatePath, import.meta.url)), 'utf8')
  const html = template.replace('<script>', '<script>window._embeddedDailyData = ' + data + ';</script>\n<script>')
  writeFileSync(target, html)
  console.log('rendered ' + target + ' (' + html.length + ' bytes)')
}
// M8：统一模板只有一份；--v2 兼容参数被忽略（两处输出内容完全一致，供旧 DOM 检查脚本读取）
void v2
renderTemplate('../src/server/page.template.html', out)
renderTemplate('../src/server/page.template.html', '/tmp/sparkos-wb-v2.html')
if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
