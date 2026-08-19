import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkbenchData } from '../src/server/data.ts'

test('workbench data: 10 主线 / 72 卡 / 事件账本行数', () => {
  const d = buildWorkbenchData()
  assert.equal(d.lines.length, 10, '主线 10 条')
  assert.equal(d.timeline.cards.length, 72, '知识卡 72 张（含 line 归属）')
  assert.ok(d.events >= 1, '事件账本至少 1 行')
  assert.ok(d.timeline.cards.every((c) => 'line' in (c as object)), '每张卡都有 line 字段')
})
