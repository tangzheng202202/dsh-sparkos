import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { VAULT_ROOT } from '../src/vault.ts'
import { buildWorkbenchData, redLineCheck, reviewDistill } from '../src/server/data.ts'

test('workbench data: 10 主线 / 72 卡 / 事件账本行数', () => {
  const d = buildWorkbenchData()
  assert.equal(d.lines.length, 10, '主线 10 条')
  assert.equal(d.timeline.cards.length, 72, '知识卡 72 张（含 line 归属）')
  assert.ok(d.events >= 1, '事件账本至少 1 行')
  assert.ok(d.timeline.cards.every((c) => 'line' in (c as object)), '每张卡都有 line 字段')
})

test('redLineCheck 双向：干净内容零违例 / 违规内容命中红线 A 与 D', () => {
  assert.equal(redLineCheck('本周新增证据两条，建议写回星火库知识卡。').length, 0, '干净内容应过')
  const violations = redLineCheck('该稿可自动发布无需人工审核，并应写入华夏舆参管道 state/ 目录。')
  assert.ok(violations.some((v) => v.startsWith('红线A')), '应命中红线A（写管道 state/）')
  assert.ok(violations.some((v) => v.startsWith('红线D')), '应命中红线D（自动定夺发布）')
})

test('reviewDistill 双向：违规条目采纳被拦 / 驳回后从队列消失（状态可恢复）', () => {
  const reviewedFile = path.join(VAULT_ROOT, 'state', 'distill_reviewed.json')
  const backup = existsSync(reviewedFile) ? readFileSync(reviewedFile, 'utf8') : null
  try {
    // 违规条目 adopt 必须抛错
    assert.throws(() => reviewDistill('2026-08-20-danger.md', 'adopt'), /红线/, '违规采纳应被拦')
    // 干净条目 adopt 通过并进 approved
    reviewDistill('2026-08-20-clean.md', 'adopt')
    // danger 驳回后消失
    reviewDistill('2026-08-20-danger.md', 'ignore')
    const d = buildWorkbenchData()
    assert.ok(!d.distillQueue.some((e) => e.file === '2026-08-20-clean.md' || e.file === '2026-08-20-danger.md'), '两条均不应再出现在待审队列')
    assert.ok(d.distillReviewed.approved.includes('2026-08-20-clean.md'), 'clean 应在 approved')
    assert.ok(d.distillReviewed.rejected.includes('2026-08-20-danger.md'), 'danger 应在 rejected')
  } finally {
    if (backup !== null) writeFileSync(reviewedFile, backup)
  }
})
