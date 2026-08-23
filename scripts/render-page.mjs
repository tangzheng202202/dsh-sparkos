/**
 * 渲染工作台 HTML 到 /tmp/sparkos-wb.html（无宿主也可跑 DOM 检查）。
 * 用法：node --experimental-strip-types scripts/render-page.mjs [out.html]
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
    must_reads: [{ event_id: 'render-fixture-1', title: '工作台渲染检查', fresh_hours: 1, primary_line: 'line-001' }],
  }))
  writeFileSync(path.join(daily, 'daily_briefing_2026-08-22.md'), '# 每日简报\n\n- 工作台渲染检查\n')
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

const out = process.argv[2] ?? '/tmp/sparkos-wb.html'
const workbenchData = buildWorkbenchData()
if (fixtureRoot) {
  const shared = {
    cardId: 'ec-1111111111111111', title: '审核意见渲染测试', validation: { errors: [] },
    assetCount: 0, artifacts: [], createdAt: '2026-08-22T10:00:00Z', updatedAt: '2026-08-22T11:00:00Z',
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
    const attemptNo = opts.attemptNo || ({ 'cover-main': '1', 'inline-one': '2', 'carousel-one': '3', 'failure-one': '4' }[assetId] ?? '5')
    return {
      id, batchId: opts.batchId || 'vb-11111111111111111111', packageId: opts.packageId || 'dp-2222222222222222', assetId, kind: assetId === 'cover-main' ? 'cover' : 'inline',
      placement: opts.placement != null ? opts.placement : (assetId === 'cover-main' ? '微信公众号封面' : '微信正文第一节后'), prompt: opts.prompt != null ? opts.prompt : '<b>必须转义的提示词</b>', altText: opts.altText != null ? opts.altText : '安全替代文本',
      aspectRatio: assetId === 'cover-main' ? '2.35:1' : '16:9', targetWidth: 900, targetHeight: 383, state,
      pipelineState: 'waiting_visual_approval', currentAttempt: 1, maxAttempts: 3, failureCount: state === 'rejected' ? 1 : 0, retryCount: state === 'rejected' ? 1 : 0,
      reviewNote: note, attempts: [attempt('va-' + String(attemptNo).repeat(20), id, 'stub', opts.attemptOverrides)], createdAt: '2026-08-22T10:00:00Z', updatedAt: '2026-08-22T11:00:00Z',
    }
  }
  const xssTask = task('vt-55555555555555555555', 'xss-one', 'waiting_visual_approval', null, { attemptNo: 5, altText: '<img src=x onerror=lightboxAttack()>', prompt: '<script>pwned()</script> 封面提示词', placement: '<svg onload=svgAttack()> 位置' })
  const otherTask = task('vt-66666666666666666666', 'other-package', 'waiting_visual_approval', null, { attemptNo: 6, batchId: 'vb-22222222222222222222', packageId: 'dp-3333333333333333', altText: '另一包图片', prompt: '另一包提示词', placement: 'Telegram 配图' })
  workbenchData.factory.visual = { batches: [{
    id: 'vb-11111111111111111111', packageId: 'dp-2222222222222222', revision: 2, sourceAssetsSha256: 'b'.repeat(64), status: 'partially_approved',
    requiredCount: 4, approvedCount: 0, createdAt: '2026-08-22T10:00:00Z', updatedAt: '2026-08-22T11:00:00Z',
    tasks: [task('vt-11111111111111111111', 'cover-main', 'waiting_visual_approval', null), task('vt-22222222222222222222', 'inline-one', 'waiting_visual_approval', null), task('vt-44444444444444444444', 'failure-one', 'waiting_visual_approval', null), task('vt-33333333333333333333', 'carousel-one', 'rejected', '<img src=x onerror=reviewAttack()>'), xssTask],
    readiness: { required: 4, queued: 0, generating: 0, waitingVisualApproval: 3, failed: 0, readyForVisualApproval: true, visualApproved: false, testOnly: true, deliveryReady: false, readyByPlatform: { wechat: false, telegram: true, x: true, xiaohongshu: false }, readyForPublication: false, blockers: ['stub-visual-assets-test-only'] },
  }, {
    id: 'vb-22222222222222222222', packageId: 'dp-3333333333333333', revision: 3, sourceAssetsSha256: 'c'.repeat(64), status: 'waiting_visual_approval',
    requiredCount: 1, approvedCount: 0, createdAt: '2026-08-22T12:00:00Z', updatedAt: '2026-08-22T12:00:00Z',
    tasks: [otherTask],
    readiness: { required: 1, queued: 0, generating: 0, waitingVisualApproval: 1, failed: 0, readyForVisualApproval: true, visualApproved: false, testOnly: false, deliveryReady: false, readyByPlatform: { wechat: true, telegram: true, x: true, xiaohongshu: true }, readyForPublication: false, blockers: [] },
  }] }
}
const data = JSON.stringify(workbenchData).replace(/</g, '\\u003c')
const template = readFileSync(fileURLToPath(new URL('../src/server/page.template.html', import.meta.url)), 'utf8')
const html = template.replace('<script>', '<script>window._embeddedDailyData = ' + data + ';</script>\n<script>')
writeFileSync(out, html)
console.log('rendered ' + out + ' (' + html.length + ' bytes)')
if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
