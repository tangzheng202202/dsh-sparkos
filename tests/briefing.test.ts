/**
 * 简报台（brief 模式）回归：2026-08-30 降级决策。
 * - 工厂受控端点在默认（brief）模式下统一 410 factory-disabled
 * - 页面渲染简报台模板（必读/草稿/蒸馏/待写回），不再引用工厂端点
 * - daily 轻量端点（data/draft/mutate/writeback）保持可用
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 显式不设置 SPARKOS_WORKBENCH_MODE：本文件验证默认 brief 模式
delete process.env.SPARKOS_WORKBENCH_MODE

const root = mkdtempSync(join(tmpdir(), 'sparkos-brief-'))
const vault = join(root, 'vault')
const brief = join(root, 'daily_brief')
const drafts = join(brief, 'drafts')
const queue = join(root, 'distill_queue')
mkdirSync(join(vault, 'config'), { recursive: true })
mkdirSync(drafts, { recursive: true })
mkdirSync(queue, { recursive: true })
writeFileSync(join(vault, 'config', 'narrative_lines.json'), JSON.stringify({ lines: [{ id: 'L01' }] }))
writeFileSync(join(brief, 'daily_data_2026-08-30.json'), JSON.stringify({
  date: '2026-08-30',
  must_reads: [{ event_id: 'ev-brief-1', title: '简报台必读一', fresh_hours: 5, primary_line: 'L01' }],
}))
writeFileSync(join(brief, 'daily_briefing_2026-08-30.md'), '# 每日简报\n\n- 简报台渲染检查')
writeFileSync(join(drafts, '2026-08-30-wechat.md'), '# 简报台草稿\n\n全文内容。')
writeFileSync(join(queue, '2026-08-30-cand.md'), '---\ntitle: 候选\n---\n观察内容。')
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_CONTENTOS_ROOT = root
process.env.SPARKOS_DAILY_BRIEF_DIR = brief
process.env.SPARKOS_RUNTIME_DISTILL_QUEUE = queue
after(() => rmSync(root, { recursive: true, force: true }))

type MockRes = { res: import('node:http').ServerResponse; out: { status: number; body: string } }

function mockReq(method: string, url: string, body?: unknown) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      origin: 'http://dsh-sparkos.local',
      host: 'dsh-sparkos.local',
      'x-sparkos-csrf': 'not-checked-here',
    },
    [Symbol.asyncIterator]: async function* () { yield* chunks },
  } as unknown as import('node:http').IncomingMessage
}

function mockRes(): MockRes {
  const out = { status: 0, body: '' }
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { out.status = status },
    end(payload?: string) { out.body = typeof payload === 'string' ? payload : '' },
  } as unknown as import('node:http').ServerResponse
  return { res, out }
}

const { handleSparkosHttp } = await import('../src/server/routes.ts')

/** 取一个合法 CSRF token（mutation 守卫先于工厂 410 门，请求必须三重守卫全过）。 */
async function csrfToken(): Promise<string> {
  const { res, out } = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/csrf'), res)
  return (JSON.parse(out.body) as { value: { token: string } }).value.token
}

test('工厂受控端点在 brief 模式下统一 410 factory-disabled', async () => {
  const factoryEndpoints: Array<[string, string, unknown]> = [
    ['POST', '/sparkos/editorial/decision', { cardId: 'ec-1111111111111111', decision: 'approved' }],
    ['POST', '/sparkos/creation/decision', { packageId: 'dp-1111111111111111', decision: 'approved' }],
    ['POST', '/sparkos/creation/revise', { packageId: 'dp-1111111111111111' }],
    ['POST', '/sparkos/visual/queue', { packageId: 'dp-1111111111111111' }],
    ['GET', '/sparkos/visual/status', undefined],
    ['GET', '/sparkos/visual/asset?attemptId=va-x', undefined],
    ['POST', '/sparkos/visual/decision', { attemptId: 'va-11111111111111111111', decision: 'approved' }],
    ['POST', '/sparkos/visual/retry', { taskId: 'vt-11111111111111111111' }],
    ['POST', '/sparkos/visual/delivery', { packageId: 'dp-1111111111111111', mode: 'preview' }],
    ['GET', '/sparkos/visual/delivery?deliveryId=vd-x&file=a.json', undefined],
    ['GET', '/sparkos/visual/deliveries?packageId=dp-1111111111111111', undefined],
    ['GET', '/sparkos/visual/download?deliveryId=vd-x', undefined],
    ['POST', '/sparkos/publish', { packageId: 'dp-1111111111111111' }],
    ['GET', '/sparkos/creation/artifact?packageId=dp-1111111111111111&file=wechat.html', undefined],
  ]
  const token = await csrfToken()
  for (const [method, url, body] of factoryEndpoints) {
    const { res, out } = mockRes()
    const req = mockReq(method, url, body)
    ;(req.headers as Record<string, string>)['x-sparkos-csrf'] = token
    await handleSparkosHttp(req, res)
    assert.equal(out.status, 410, method + ' ' + url + ' 应为 410，实际 ' + out.status)
    const parsed = JSON.parse(out.body) as { error: { code: string } }
    assert.equal(parsed.error.code, 'factory-disabled', method + ' ' + url)
  }
})

test('brief 模式页面渲染简报台而非工厂工作台', async () => {
  const { res, out } = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/app'), res)
  assert.equal(out.status, 200)
  assert.ok(out.body.includes('SparkOS 简报台'), '应渲染简报台标题')
  assert.ok(out.body.includes('data-mr='), '必读采纳/忽略按钮应存在')
  assert.ok(out.body.includes('data-rt-toggle='), '草稿查看全文应存在')
  assert.ok(!out.body.includes('visual-lightbox'), '不应包含工厂视觉 lightbox')
  assert.ok(!out.body.includes('/sparkos/visual/decision'), '不应引用工厂视觉端点')
  assert.ok(!out.body.includes('/sparkos/publish'), '不应引用工厂发布端点')
})

test('daily 轻量端点保持可用（data / draft）', async () => {
  const d = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/data'), d.res)
  assert.equal(d.out.status, 200)
  const parsed = JSON.parse(d.out.body) as { value: { daily: { date: string | null } } }
  assert.equal(parsed.value.daily.date, '2026-08-30')

  const r = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/draft?file=2026-08-30-wechat.md'), r.res)
  assert.equal(r.out.status, 200)
})
