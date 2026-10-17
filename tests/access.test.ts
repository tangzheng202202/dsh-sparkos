/**
 * 未登录不能读简报台。401/403 响应里不能出现数据目录的绝对路径。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const sentinel = mkdtempSync(path.join(tmpdir(), 'sparkos-secret-vault-'))
process.env.SPARKOS_VAULT_ROOT = sentinel

const { handleSparkosHttp, admitTestOperator } = await import('../src/server/routes.ts')

function mockReq(method: string, url: string) {
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() { /* empty body */ },
  } as unknown as import('node:http').IncomingMessage
}

function mockRes() {
  const out = { status: 0, body: '' }
  const res = {
    writeHead(status: number) { out.status = status },
    end(payload?: string) { out.body = payload ?? '' },
  } as unknown as import('node:http').ServerResponse
  return { res, out }
}

test('不带 cookie 的页面和数据接口返回 401，响应里没有绝对路径', async () => {
  for (const url of ['/sparkos', '/sparkos/app', '/sparkos/data', '/sparkos/intel']) {
    const { res, out } = mockRes()
    await handleSparkosHttp(mockReq('GET', url), res)
    assert.equal(out.status, 401, url)
    assert.equal(out.body, 'unauthorized')
    assert.equal(out.body.includes(sentinel), false, url)
    assert.equal(out.body.includes('vaultRoot'), false, url)
  }
})

test('宿主拒绝为 403 时原样返回，仍然不带路径', async () => {
  const { res, out } = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/data'), res, () => ({ rejection: 403 }))
  assert.equal(out.status, 403)
  assert.equal(out.body, 'forbidden')
  assert.equal(out.body.includes(sentinel), false)
})

test('准入后的 /sparkos/data 仍是 200，测试 operator 没有 principal 字段', async () => {
  let sawPrincipal = false
  const { res, out } = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/data'), res, () => {
    const peer = { id: 'op', ctx: {}, scope: 'op' }
    sawPrincipal = 'principal' in peer
    return { peer }
  })
  assert.equal(sawPrincipal, false)
  assert.equal(out.status, 200)
  const body = JSON.parse(out.body) as { ok: boolean; value: { vaultRoot: string } }
  assert.equal(body.ok, true)
  assert.equal(body.value.vaultRoot, sentinel)
})

test('已登录的测试调用走 admitTestOperator', async () => {
  const { res, out } = mockRes()
  await handleSparkosHttp(mockReq('GET', '/sparkos/intel'), res, admitTestOperator)
  assert.equal(out.status, 200)
  assert.equal(JSON.parse(out.body).ok, true)
})

test('前端请求写明要带 cookie', () => {
  const page = readFileSync(new URL('../src/server/page.template.html', import.meta.url), 'utf8')
  const factory = readFileSync(new URL('../src/server/factory.template.html', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8')
  assert.match(page, /credentials\s*=\s*'include'/)
  assert.match(factory, /credentials\s*=\s*'include'/)
  assert.match(client, /credentials:\s*'include'/)
  assert.equal(page.includes("fetch('/sparkos/"), false)
})
