/**
 * 工作台 HTTP 安全边界（P0 热修）：
 * - escapeJsonForScript：唯一的安全内嵌 JSON 序列化（< > & U+2028 U+2029 全转义）
 * - isSafeExternalUrl / safeExternalUrlOf：动态外链只允许 http/https 绝对地址
 * - CSRF：同源校验 + 不可被跨站读取的 token（页面内嵌 + GET /sparkos/csrf 签发）
 * - CSP：每请求 nonce，script-src 不允许 unsafe-inline
 * DSH webServer 宿主未提供 auth/CSRF API（仅路由注册），此处为插件内可测试的同源保护。
 * @module dsh-sparkos/src/server/security
 */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/**
 * 唯一的安全序列化函数：把任意数据序列化为可内嵌 <script> 的 JSON 文本。
 * 至少转义 < 为字面量 \u003c，以及 >、&、U+2028、U+2029 —— 防止 </script> 突破与 JS 行终止符问题。
 * V1/V2 页面与渲染脚本必须共用本实现，禁止任何页面再手写等价 replace。
 */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * 动态可点击外链的白名单判定：只允许 http:/https: 绝对地址。
 * 拒绝 javascript:、data:、file:、vbscript:、混合大小写变体、空白/控制字符前缀、
 * 协议相对地址（//host）以及一切无法解析为绝对 http(s) URL 的值。
 */
export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  if (raw === '' || raw.length > 2048) return false
  // 浏览器会剥离首尾空白与内部制表/换行后再解析协议，先于一切判断拒绝
  if (raw !== raw.trim()) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return false
  if (!/^https?:\/\//i.test(raw)) return false // 同时拒绝协议相对 //host 与所有其它 scheme
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 安全则原样返回（可作 href），否则 null（调用方必须降级为普通转义文本）。 */
export function safeExternalUrlOf(raw: unknown): string | null {
  return isSafeExternalUrl(raw) ? raw : null
}

/** 过滤 URL 列表：只保留安全项（服务端提交校验/数据装配共用）。 */
export function filterSafeExternalUrls(urls: unknown[]): string[] {
  return urls.filter((u): u is string => isSafeExternalUrl(u))
}

// ---------------------------------------------------------------------------
// CSRF：token 存进程内 Map（随机 256bit，跨站页面无法读取），12h 过期，容量上限防膨胀。
// ---------------------------------------------------------------------------

const CSRF_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const CSRF_TOKEN_CAP = 512

const csrfTokens = new Map<string, number>()

/** 签发一个新 CSRF token（内嵌进页面 / GET /sparkos/csrf 返回）。 */
export function issueCsrfToken(): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  for (const [t, expiry] of csrfTokens) {
    if (expiry <= now) csrfTokens.delete(t)
  }
  if (csrfTokens.size >= CSRF_TOKEN_CAP) {
    const oldest = csrfTokens.keys().next().value
    if (oldest !== undefined) csrfTokens.delete(oldest)
  }
  csrfTokens.set(token, now + CSRF_TOKEN_TTL_MS)
  return token
}

/** 校验 token（存在且未过期）。 */
export function verifyCsrfToken(token: unknown): boolean {
  if (typeof token !== 'string' || token === '') return false
  const expiry = csrfTokens.get(token)
  if (expiry === undefined) return false
  if (expiry <= Date.now()) {
    csrfTokens.delete(token)
    return false
  }
  return true
}

/** 测试辅助：清空 token 表。 */
export function resetCsrfTokensForTests(): void {
  csrfTokens.clear()
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

/** Origin（scheme+host[:port]）与请求 Host 头是否同源。Origin 缺失视为非浏览器请求。 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = headerOf(req, 'origin')
  if (origin === undefined) return true
  const host = headerOf(req, 'host')
  if (host === undefined || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 是否浏览器形态请求（带 Origin/Referer/Sec-Fetch-* 任一头）。 */
function looksLikeBrowser(req: IncomingMessage): boolean {
  return headerOf(req, 'origin') !== undefined
    || headerOf(req, 'referer') !== undefined
    || headerOf(req, 'sec-fetch-site') !== undefined
}

export interface MutationRejection {
  status: number
  code: string
  message: string
}

/**
 * 写端点统一守卫（覆盖全部 mutation POST）：
 * 1. Content-Type 必须是 application/json（charset 参数允许；缺失视为无体请求放行），否则 415；
 * 2. 浏览器请求必须 Origin 与 Host 同源（Sec-Fetch-Site 非同源同样拒绝），否则 403；
 * 3. 浏览器请求必须携带有效 x-sparkos-csrf token（页面内嵌或 /sparkos/csrf 签发，
 *    跨站页面不可读取），否则 403；
 * 4. 错误一律返回结构化 JSON，不含任何凭据。
 * 返回 null 表示放行。
 */
export function checkMutationRequest(req: IncomingMessage): MutationRejection | null {
  if (req.method !== 'POST') return null
  const contentType = headerOf(req, 'content-type')
  if (contentType !== undefined) {
    const mediaType = contentType.split(';')[0]!.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return { status: 415, code: 'unsupported-media-type', message: 'mutation POST 必须使用 application/json' }
    }
  }
  const secFetchSite = headerOf(req, 'sec-fetch-site')
  if (secFetchSite !== undefined && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return { status: 403, code: 'cross-origin', message: '拒绝跨站写入请求' }
  }
  if (!isSameOrigin(req)) {
    return { status: 403, code: 'cross-origin', message: '拒绝跨站写入请求' }
  }
  if (looksLikeBrowser(req)) {
    const token = headerOf(req, 'x-sparkos-csrf')
    if (!verifyCsrfToken(token)) {
      return { status: 403, code: 'csrf-token', message: '缺少或无效的 CSRF token' }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// CSP：每请求 nonce；script-src 不含 unsafe-inline；保留同源 iframe、图片预览与现有内联样式的最小权限。
// ---------------------------------------------------------------------------

/** 生成每请求 CSP nonce（128bit base64url）。 */
export function newCspNonce(): string {
  return randomBytes(16).toString('base64url')
}

/** 工作台页面的 CSP 头（script-src 仅 nonce + 同源，无 unsafe-inline）。 */
export function cspWithNonce(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "frame-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}
