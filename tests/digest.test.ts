/**
 * 每日晨会摘要测试。
 *
 * 定位：SparkOS 靠**推送**交付结论，不靠页面。所以这条消息必须一屏读完、
 * 只给结论。测试重点盯住「不要把机器原文原样倒出来」这条底线。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMorningDigest, headline, scheduleHasDraft, scheduleLabel } from '../src/notify/digest.ts'
import type { WorkbenchData } from '../src/server/data.ts'

test('headline：取最早的分隔符切主句，绝不倒出 160 字事件账本原文', () => {
  const long = 'OpenAI 宣称用 AI 解决 Navier–Stokes 千禧年难题并发布证明、表示不申领百万奖金——同日 NYU 数学家 Tristan Buckmaster 发声明指控其「打得不干净」（快照 09-09 08:01 首采 HN 双热源 1162🔥 声明 PDF）'
  const h = headline(long)
  assert.equal(h, 'OpenAI 宣称用 AI 解决 Navier–Stokes 千禧年难题并发布证明')
  assert.ok(h.length <= 48)
  assert.ok(!h.includes('——') && !h.includes('快照'), '不得带机器尾巴')
  // 「——」比「、」更靠后时，应取更早的「、」
  assert.equal(headline('陶哲轩警告：AI 正在把数学开放问题当「非可再生资源」开采——解题速度超过新问题被提出的速度'),
    '陶哲轩警告：AI 正在把数学开放问题当「非可再生资源」开采')
  // 无分隔符时按字数兜底
  assert.ok(headline('没有任何分隔符的超级长标题'.repeat(5)).length <= 48)
  // 分隔符太靠前（正文开头）不切，避免切出无意义短句
  assert.ok(headline('AI，这是一个以逗号开头的句子').startsWith('AI，'))
})

test('scheduleLabel：去掉与消息头重复的日期，保留时刻', () => {
  assert.equal(scheduleLabel('三 9/10 20:00'), '20:00')
  assert.equal(scheduleLabel('一 8/25'), '一 8/25', '去掉后为空则回退原文')
  assert.equal(scheduleLabel('四 9/11 12:00'), '12:00')
})

test('scheduleHasDraft：只在真的对得上时说「有」，对不上不诬赖用户', () => {
  assert.equal(scheduleHasDraft('公众号《一鱼多吃》（S1E3）；小红书拆条',
    ['AI 解开了千禧年难题', 'Meta 让 AI 接管支付']), false, '排期与草稿无关时必须报「没找到」')
  assert.equal(scheduleHasDraft('公众号《一鱼多吃》（S1E3）',
    ['一鱼多吃：一篇母版变6份平台素材']), true, '有交集才算找到')
  assert.equal(scheduleHasDraft('', []), true, '无从判断不要误报')
})

function fixture(over: Partial<WorkbenchData> = {}): WorkbenchData {
  return {
    daily: {
      date: '2026-09-10',
      data: {
        drafts: [{ platform: 'wechat', hook: '「AI 解开了千禧年难题」——展开说明' }],
        must_reads: [{ event_id: 'e1', title: 'OpenAI 宣称用 AI 解决 Navier–Stokes 千禧年难题并发布证明、表示不申领百万奖金——同日 NYU 数学家反击（快照 09-09 08:01…）', fresh_hours: 24, primary_line: 'line-005' }],
      },
    },
    mediaOs: {
      today: '2026-09-10',
      schedule: { present: true, items: [{ label: '三 9/10 20:00', action: '公众号 🏭《一鱼多吃》（S1E3）' }], range: '2026-08-18 → 09-23', inRange: true, updatedAt: null },
      metrics: { present: true, rows: 0, lastDate: null, updatedAt: null },
      topicPool: { present: true, entries: 25, updatedAt: null },
      root: '/tmp/media-os', available: true,
    },
    cardRequests: [
      { clusterId: 'c1', suggestedUri: 'obs://056', suggestedFile: '056-x-2026-09-10.md', title: 'T', reason: 'r', heat: 'high', sourceHeat: 95, sourceCount: 1, evidenceUrls: [], eventKeys: [] },
    ],
    clusters: { date: '20260910', items: [] },
    ...over,
  } as unknown as WorkbenchData
}

test('buildMorningDigest：一屏读完，且给出「排期没草稿」这个最关键结论', () => {
  const d = buildMorningDigest(fixture())
  const lines = d.text.split('\n')
  assert.ok(lines.length <= 20, '推送必须一屏读完，实际 ' + lines.length + ' 行')
  assert.ok(d.text.includes('今天要发') && d.text.includes('雷达捡到') && d.text.includes('要动手'))
  assert.ok(d.text.includes('20:00 → 公众号'), '排期标签不应重复日期')
  assert.equal(d.stats.scheduleHasDraft, false)
  assert.ok(d.text.includes('系统里没找到对应草稿'), '排期与雷达草稿无关时必须点出来')
  assert.ok(!d.text.includes('快照'), '不得把机器尾巴带进推送')
  assert.ok(d.text.includes('数据回流 0 条'))
  assert.ok(d.text.includes('补卡 1 张'))
})

test('buildMorningDigest：匹配上草稿时不得误报；空排期不报错', () => {
  const matched = buildMorningDigest(fixture({
    daily: {
      date: '2026-09-10',
      data: { drafts: [{ platform: 'wechat', hook: '一鱼多吃：一篇母版变6份平台素材' }], must_reads: [] },
    },
  } as unknown as Partial<WorkbenchData>))
  assert.equal(matched.stats.scheduleHasDraft, true)
  assert.ok(matched.text.includes('找到对应草稿'))

  const noSchedule = buildMorningDigest(fixture({
    mediaOs: {
      today: '2026-09-10',
      schedule: { present: true, items: [], range: null, inRange: true, updatedAt: null },
      metrics: { present: true, rows: 5, lastDate: '2026-09-09', updatedAt: null },
      topicPool: { present: true, entries: 0, updatedAt: null },
      root: '/tmp/media-os', available: true,
    },
  } as unknown as Partial<WorkbenchData>))
  assert.equal(noSchedule.stats.scheduleCount, 0)
  assert.ok(noSchedule.text.includes('今天没有安排'))
  assert.ok(!noSchedule.text.includes('数据回流 0 条'), '有数据时不得报警')
})
