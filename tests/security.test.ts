/**
 * P0 安全热修回归测试：JSON 注入 / 危险 URL / 写端点安全边界 / CSP。
 * 真实 HTTP（node:http server 包 handleSparkosHttp）+ 隔离 fixture（tmp VAULT + tmp SQLite），
 * 不触碰生产 VAULT、生产 SQLite、视觉任务、approval、delivery 或图片。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ---- 隔离 fixture 环境（先设 env，再动态 import 源码模块） ----
const root = mkdtempSync(path.join(tmpdir(), 'sparkos-sec-'))
const vault = path.join(root, 'vault')
const brief = path.join(root, 'daily_brief')
const drafts = path.join(brief, 'drafts')
const queue = path.join(root, 'distill_queue')
mkdirSync(path.join(vault, 'config'), { recursive: true })
mkdirSync(path.join(vault, 'state'), { recursive: true })
mkdirSync(path.join(vault, 'ops-intel', 'clusters'), { recursive: true })
mkdirSync(drafts, { recursive: true })
mkdirSync(queue, { recursive: true })
const PAYLOAD = '</script><script>attack()</script>'
const LS = 'a\u2028b'
writeFileSync(path.join(vault, 'config', 'narrative_lines.json'), JSON.stringify({ lines: [{ id: 'L01' }] }))
writeFileSync(path.join(vault, 'config', 'line_names.json'), JSON.stringify({ L01: '主线一' }))
// 标题 / briefing / 草稿 / 决策 note 全部携带注入 payload
writeFileSync(path.join(brief, 'daily_data_2026-08-20.json'), JSON.stringify({
  date: '2026-08-20',
  must_reads: [{ event_id: 'ev-xss', title: PAYLOAD + LS, fresh_hours: 4, primary_line: 'L01' }],
  suggestions: [{ type: 'generic', note: PAYLOAD }],
}))
writeFileSync(path.join(brief, 'daily_briefing_2026-08-20.md'), '# 简报\n\n- ' + PAYLOAD)
writeFileSync(path.join(drafts, '2026-08-20-wechat.md'), '# 草稿\n\n' + PAYLOAD)
writeFileSync(path.join(queue, '2026-08-20-cand.md'), '---\ntitle: 候选\n---\n' + PAYLOAD)
writeFileSync(path.join(vault, 'state', 'decisions.json'), JSON.stringify([
  { at: '2026-08-20T00:00:00Z', kind: 'topic', id: 'ev-xss', action: 'adopt', note: PAYLOAD },
]))
// 历史脏数据：cluster 文件里的危险 URL 必须原样保留在数据里但只能渲染为普通转义文本
writeFileSync(path.join(vault, 'ops-intel', 'clusters', 'clusters-20260822.json'), JSON.stringify([{
  clusterId: 'c-20260822-001', date: '20260822', topic: '脏链接主题',
  coreFacts: [], heat: 'medium', novelty: 'medium', sourceCount: 1,
  evidenceUrls: ['javascript:attack()', ' https://ev trim.example/', '//protocol-relative.example/x', 'HTTPS://UPPER.CASE/ok', 'https://safe.example/a'],
  knowledgeCards: [], credibility: 'medium', risks: [], platforms: [], angleSuggestions: [], eventKeys: ['ev-1'],
}]))
process.env.SPARKOS_VAULT_ROOT = vault
process.env.SPARKOS_CONTENTOS_ROOT = root
process.env.SPARKOS_DAILY_BRIEF_DIR = brief
process.env.SPARKOS_RUNTIME_DISTILL_QUEUE = queue
process.env.SPARKOS_RUNTIME_EVENTS = path.join(root, 'events.jsonl')
process.env.SPARKOS_TIMELINE_DATA = path.join(vault, 'config', 'timeline_cards.json')
process.env.SPARKOS_DB_PATH = path.join(root, 'fixture.db')

const { handleSparkosHttp } = await import('../src/server/routes.ts')
const security = await import('../src/server/security.ts')

// ---- 隔离 SQLite fixture：视觉任务 prompt/altText/placement 携带注入 payload ----
{
  const { openFactoryDatabase } = await import('../src/storage/database.ts')
  const db = openFactoryDatabase()
  const now = '2026-08-22T10:00:00Z'
  db.prepare("INSERT INTO workflow_jobs (id, kind, status, priority, input_json, attempts, max_attempts, run_after, created_at, updated_at) VALUES (?, 'creation', 'succeeded', 0, '{}', 0, 3, ?, ?, ?)").run('job-sec-1', now, now, now)
  db.prepare("INSERT INTO editorial_runs (id, mode, period_start, period_end, input_fingerprint, status, generated_at) VALUES (?, 'midweek', '2026-08-19', '2026-08-22', 'sec-fp', 'pending_approval', ?)").run('er-sec-1', now)
  db.prepare('INSERT INTO editorial_cards (id, run_id, rank, topic_key, title, trend_pattern, core_thesis, why_now, facts_json, evidence_json, counter_arguments_json, knowledge_cards_json, platforms_json, content_format, risks_json, verification_grade, expected_value, created_at) VALUES (?, ?, 1, ?, ?, \'accelerating\', ?, ?, \'[]\', ?, \'[]\', \'[]\', \'[]\', \'深度文\', \'[]\', \'A\', 8.0, ?)')
    .run('ec-sec-1', 'er-sec-1', 't-sec-1', PAYLOAD, '核心判断', '为什么现在', JSON.stringify([
      { url: 'javascript:cardAttack()', claim: '脏证据', sourceType: 'official', verified: true },
      { url: 'https://safe.example/e1', claim: '净证据', sourceType: 'official', verified: true },
    ]), now)
  db.prepare("INSERT INTO draft_packages (id, card_id, revision, job_id, contract_version, input_fingerprint, status, request_json, created_at, updated_at) VALUES (?, ?, 1, 'job-sec-1', 2, 'sec-fp-2', 'approved', ?, ?, ?)").run('dp-sec-1', 'ec-sec-1', JSON.stringify({ sourceCard: { title: PAYLOAD, evidence: [] } }), now, now)
  db.prepare("INSERT INTO visual_batches (id, package_id, revision, source_assets_sha256, status, required_count, created_at, updated_at) VALUES (?, 'dp-sec-1', 1, ?, 'waiting_visual_approval', 1, ?, ?)").run('vb-sec-1', 'a'.repeat(64), now, now)
  db.prepare("INSERT INTO visual_asset_tasks (id, batch_id, package_id, asset_id, kind, placement, prompt, alt_text, aspect_ratio, target_width, target_height, state, idempotency_key, current_attempt, max_attempts, created_at, updated_at) VALUES (?, 'vb-sec-1', 'dp-sec-1', 'cover-main', 'cover', ?, ?, ?, '2.35:1', 900, 383, 'waiting_visual_approval', 'sec-idem-1', 1, 3, ?, ?)")
    .run('vt-sec-1', PAYLOAD + ' 位置', PAYLOAD + ' 提示词', PAYLOAD + ' 替代文本', now, now)
  db.prepare("INSERT INTO visual_asset_attempts (id, task_id, job_id, attempt_no, prompt_original, status, created_at, updated_at) VALUES (?, 'vt-sec-1', 'job-sec-1', 1, ?, 'waiting_visual_approval', ?, ?)").run('va-sec-1', PAYLOAD, now, now)
  db.close()
}

// ---- 真实 HTTP server ----
let server: Server
let base = ''
before(async () => {
  server = createServer((req, res) => { handleSparkosHttp(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + String((server.address() as { port: number }).port)
})
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(root, { recursive: true, force: true })
})

function count(haystack: string, needle: string): number {
  let n = 0; let i = haystack.indexOf(needle)
  while (i !== -1) { n++; i = haystack.indexOf(needle, i + needle.length) }
  return n
}

test('一、JSON 注入：/sparkos/app 与 /sparkos/app-v2 的真实响应不突破 <script>', async () => {
  for (const page of ['/sparkos/app', '/sparkos/app-v2']) {
    const res = await fetch(base + page)
    assert.equal(res.status, 200, page)
    const html = await res.text()
    // payload 进入页面（数据未被丢弃），但只以转义形式存在
    assert.ok(html.includes('\\u003c/script\\u003e\\u003cscript\\u003eattack()\\u003c'), page + ' 应包含转义后的 payload')
    assert.ok(!html.includes('<script>attack()'), page + ' 不得出现裸注入脚本')
    assert.ok(!html.includes('</script><script>'), page + ' 不得出现可闭合的 </script><script>')
    // 每页恰好两个 script 开标签（数据注入 1 + 模板 1），且都带 nonce
    assert.equal(count(html, '<script'), 2, page)
    assert.equal(count(html, 'nonce='), 2, page)
    // > 与 U+2028/U+2029 也必须转义
    assert.ok(!html.includes('a\u2028b'.replace('\\u2028', '\u2028')), page + ' 不得出现字面量 U+2028')
    assert.ok(html.includes('\\u2028'), page + ' U+2028 应转义为 \\u2028')
    // prompt/altText/note/title 均已覆盖（转义形式存在 ≥4 处）
    assert.ok(count(html, '\\u003c/script\\u003e\\u003cscript\\u003eattack()') >= 4, page + ' 标题/prompt/note/altText 应全部转义')
  }
})

test('二、危险 URL 白名单：javascript:/data:/file:/vbscript:/混合大小写/空白前缀/协议相对全部拒绝', () => {
  const bad = [
    'javascript:attack()',
    'JaVaScRiPt:attack()',
    ' javascript:attack()',
    '\tjavascript:attack()',
    'java\nscript:attack()',
    'data:text/html;base64,PHNjcmlwdD4=',
    'DATA:text/html,x',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '/relative/path',
    'ftp://example.com/x',
    'mailto:a@b.c',
    'not a url',
    '',
  ]
  for (const u of bad) assert.equal(security.isSafeExternalUrl(u), false, JSON.stringify(u))
  const good = ['https://example.com/a?b=1#f', 'http://example.com/', 'HTTPS://UPPER.CASE/ok', 'https://例え.jp/パス']
  for (const u of good) assert.equal(security.isSafeExternalUrl(u), true, JSON.stringify(u))
  assert.deepEqual(security.filterSafeExternalUrls(['javascript:x', 'https://ok.example/', 42, 'data:x']), ['https://ok.example/'])
})

test('二、前端 isSafeUrl 与服务端 isSafeExternalUrl 规则一致（两模板）', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const vectors: Array<[string, boolean]> = [
    ['javascript:attack()', false], ['JaVaScRiPt:attack()', false], [' javascript:attack()', false],
    ['data:text/html,x', false], ['file:///etc/passwd', false], ['vbscript:x', false],
    ['//evil.example/x', false], ['https://ok.example/a', true], ['http://ok.example/', true],
    ['not a url', false],
  ]
  for (const tpl of ['../src/server/page.template.html']) {
    const html = readFileSync(fileURLToPath(new URL(tpl, import.meta.url)), 'utf8')
    const start = html.indexOf('function isSafeUrl')
    const end = html.indexOf('function safeExtLink')
    assert.ok(start !== -1 && end > start, tpl + ' 应内联 isSafeUrl')
    // eslint-disable-next-line no-new-func
    const isSafeUrl = new Function('URL', html.slice(start, end) + '; return isSafeUrl;')(URL) as (u: string) => boolean
    for (const [u, expected] of vectors) assert.equal(isSafeUrl(u), expected, tpl + ' ' + JSON.stringify(u))
  }
})

test('二、服务端提交校验：validateCluster 拒绝危险 evidenceUrls / evidence[].url', async () => {
  const { validateCluster } = await import('../src/intel/cluster.ts')
  const errs = validateCluster({
    clusterId: 'c-20260822-001', date: '20260822', topic: '安全测试', eventKeys: ['ev-1'],
    heat: 'medium', novelty: 'medium', credibility: 'medium', sourceCount: 1,
    evidenceUrls: ['javascript:attack()', ' https://trim.example/'],
    evidence: [{ url: 'data:text/html,x', claim: 'c', sourceType: 'official', verified: false }],
  })
  assert.ok(errs.some((e) => e.includes('evidenceUrls[0]')), String(errs))
  assert.ok(errs.some((e) => e.includes('evidenceUrls[1]')), '空白前缀必须拒绝：' + errs.join(';'))
  assert.ok(errs.some((e) => e.includes('evidence[0].url')), String(errs))
  const clean = validateCluster({
    clusterId: 'c-20260822-002', date: '20260822', topic: '安全测试', eventKeys: ['ev-1'],
    heat: 'medium', novelty: 'medium', credibility: 'medium', sourceCount: 1,
    evidenceUrls: ['https://safe.example/a'],
  })
  assert.deepEqual(clean.filter((e) => e.includes('http/https')), [])
})

test('二、历史脏数据：页面数据保留脏 URL 原文，模板不将其渲染为链接', async () => {
  const html = await (await fetch(base + '/sparkos/app-v2')).text()
  // 数据层：脏 URL 原样保留（历史数据不删改）
  assert.ok(html.includes('javascript:attack()'.replaceAll('a', 'a')), '脏 URL 应存在于嵌入数据')
  assert.ok(html.includes('https://safe.example/a'))
  // 模板层：外链必须经 safeExtLink（isSafeUrl 门控），不存在裸 href 拼接
  assert.ok(html.includes('function safeExtLink'))
  const oldPattern = '<a href=' + String.fromCharCode(34) + "'" + 'esc(u)' + String.fromCharCode(34)
  assert.ok(!html.includes(oldPattern), '外链不得再直接拼接 href')
})

test('三、写端点边界：text/plain no-cors 415 / 跨站 Origin 403 / 缺少或错误 token 403 / 合法同源 200', async () => {
  const origin = base
  // 1. text/plain（no-cors 表单）→ 415 结构化 JSON
  const plain = await fetch(base + '/sparkos/mutate', {
    method: 'POST', headers: { 'content-type': 'text/plain', origin },
    body: JSON.stringify({ kind: 'topic', id: 'ev-xss', action: 'ignore' }),
  })
  assert.equal(plain.status, 415)
  assert.equal(plain.headers.get('content-type'), 'application/json; charset=utf-8')
  const j415 = await plain.json()
  assert.equal(j415.ok, false)
  assert.equal(j415.error.code, 'unsupported-media-type')
  // 2. 跨站 Origin → 403
  const cross = await fetch(base + '/sparkos/mutate', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ kind: 'topic', id: 'ev-xss', action: 'ignore' }),
  })
  assert.equal(cross.status, 403)
  assert.equal((await cross.json()).error.code, 'cross-origin')
  // 3. 同源但缺少 token → 403
  const noToken = await fetch(base + '/sparkos/mutate', {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ kind: 'topic', id: 'ev-xss', action: 'ignore' }),
  })
  assert.equal(noToken.status, 403)
  assert.equal((await noToken.json()).error.code, 'csrf-token')
  // 4. 错误 token → 403
  const badToken = await fetch(base + '/sparkos/mutate', {
    method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-sparkos-csrf': 'deadbeef' },
    body: JSON.stringify({ kind: 'topic', id: 'ev-xss', action: 'ignore' }),
  })
  assert.equal(badToken.status, 403)
  // 5. GET /sparkos/csrf 签发 + 合法同源写 → 200
  const csrf = await (await fetch(base + '/sparkos/csrf')).json()
  assert.equal(csrf.ok, true)
  assert.match(csrf.value.token, /^[0-9a-f]{64}$/)
  const ok = await fetch(base + '/sparkos/mutate', {
    method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-sparkos-csrf': csrf.value.token },
    body: JSON.stringify({ kind: 'topic', id: 'ev-xss', action: 'ignore' }),
  })
  assert.equal(ok.status, 200)
  // 6. 非浏览器（无 Origin 头）同源写不强制 token
  const nonBrowser = await fetch(base + '/sparkos/mutate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'topic', id: 'ev-xss', action: 'ignore' }),
  })
  assert.equal(nonBrowser.status, 200)
})

test('三、全部写路由都被跨站 Origin 拒绝（不漏 intel/tick、decision、retry、delivery、publish、mutate、writeback）', async () => {
  const writeRoutes: Array<[string, unknown]> = [
    ['/sparkos/intel/tick', {}],
    ['/sparkos/visual/queue', { packageId: 'dp-0000000000000000' }],
    ['/sparkos/visual/decision', { attemptId: 'va-00000000000000000000', decision: 'approved' }],
    ['/sparkos/visual/retry', { taskId: 'vt-00000000000000000000' }],
    ['/sparkos/visual/delivery', { packageId: 'dp-0000000000000000', mode: 'preview' }],
    ['/sparkos/publish', { packageId: 'dp-0000000000000000' }],
    ['/sparkos/editorial/decision', { cardId: 'ec-0000000000000000', decision: 'approved' }],
    ['/sparkos/creation/decision', { packageId: 'dp-0000000000000000', decision: 'approved' }],
    ['/sparkos/creation/revise', { packageId: 'dp-0000000000000000' }],
    ['/sparkos/writeback/clear', {}],
    ['/sparkos/writeback/remove', { file: 'x.md' }],
    ['/sparkos/mutate', { kind: 'topic', id: 'ev-xss', action: 'ignore' }],
  ]
  for (const [route, body] of writeRoutes) {
    const res = await fetch(base + route, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example', 'x-sparkos-csrf': 'whatever' },
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 403, route)
    const j = await res.json()
    assert.equal(j.ok, false, route)
    assert.equal(j.error.code, 'cross-origin', route)
  }
})

test('四、CSP：每请求 nonce，script-src 无 unsafe-inline，保留最小权限', async () => {
  const seen = new Set<string>()
  const appNonces: string[] = []
  for (const page of ['/sparkos/app', '/sparkos/app-v2']) {
    const res = await fetch(base + page)
    const csp = res.headers.get('content-security-policy') ?? ''
    assert.ok(csp.length > 0, page)
    assert.ok(/script-src 'self' 'nonce-/.test(csp), page + ' ' + csp)
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), page + ' script-src 不允许 unsafe-inline')
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"), page)
    assert.ok(csp.includes("img-src 'self' data: blob:"), page)
    assert.ok(csp.includes("frame-src 'self'"), page)
    assert.ok(csp.includes("connect-src 'self'"), page)
    assert.ok(csp.includes("object-src 'none'"), page)
    const html = await res.text()
    const nonces = [...html.matchAll(/<script nonce="([^"]+)"/g)].map((m) => m[1])
    assert.equal(nonces.length, 2, page)
    for (const n of nonces) assert.ok(csp.includes(n), page + ' nonce 应出现在 CSP 头中')
    seen.add(nonces[0]!)
    if (page === '/sparkos/app') appNonces.push(nonces[0]!)
  }
  assert.equal(seen.size, 2, '两个页面各一个独立 nonce')
  const again = await fetch(base + '/sparkos/app')
  const againNonce = [...(await again.text()).matchAll(/<script nonce="([^"]+)"/g)].map((m) => m[1])[0]
  assert.notEqual(againNonce, appNonces[0], '同页重复请求必须使用新 nonce')
})

test('守卫单元：错误响应不含任何凭据/token', async () => {
  const res = await fetch(base + '/sparkos/mutate', {
    method: 'POST', headers: { 'content-type': 'text/plain', origin: 'http://evil.example' },
    body: 'x',
  })
  const text = await res.text()
  assert.ok(!text.includes('sparkos-csrf') || !text.match(/[0-9a-f]{64}/), '错误响应不得泄漏 token')
})
