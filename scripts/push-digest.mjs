#!/usr/bin/env node
/**
 * 把每日晨会摘要推到 Telegram。
 *
 * 用法：
 *   node --experimental-strip-types scripts/push-digest.mjs --dry-run   # 只打印不发送
 *   node --experimental-strip-types scripts/push-digest.mjs             # 真发
 *   node --experimental-strip-types scripts/push-digest.mjs --stdout    # 只输出正文（供管道）
 *
 * 凭据来源（按优先级）：
 *   1. 环境变量 TELEGRAM_BOT_TOKEN + SPARKOS_PUSH_CHAT_ID
 *   2. telegram-bridge 的 .env（TELEGRAM_BOT_TOKEN）+ sessions.json 的第一个 chat
 *      （bridge 目录可用 TELEGRAM_BRIDGE_DIR 覆盖）
 *
 * 设计：不引入第三方依赖（node fetch + 标准库）；投递失败必须显式非 0 退出，
 * 因为「静默失败」会让用户以为今天没有晨会。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const stdoutOnly = args.includes('--stdout')

function expandHome(input) {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(homedir(), input.slice(2))
  return input
}

const bridgeRaw = process.env.TELEGRAM_BRIDGE_DIR?.trim() ?? ''
const BRIDGE_DIR = bridgeRaw === '' ? '' : expandHome(bridgeRaw)

function loadEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function resolveCreds() {
  const env = BRIDGE_DIR ? loadEnvFile(path.join(BRIDGE_DIR, '.env')) : {}
  const token = process.env.TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN ?? ''
  let chatId = process.env.SPARKOS_PUSH_CHAT_ID ?? ''
  if (chatId === '' && BRIDGE_DIR) {
    try {
      const sessions = JSON.parse(readFileSync(path.join(BRIDGE_DIR, 'sessions.json'), 'utf8'))
      chatId = String(Object.keys(sessions)[0] ?? '')
    } catch { /* 无 sessions.json 时留空 */ }
  }
  return { token, chatId }
}

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok !== true) {
    throw new Error('Telegram sendMessage 失败: HTTP ' + res.status + ' ' +
      (body.description ?? JSON.stringify(body).slice(0, 200)))
  }
  return body.result?.message_id ?? null
}

const { buildWorkbenchData } = await import('../src/server/data.ts')
const { buildMorningDigest } = await import('../src/notify/digest.ts')

const data = buildWorkbenchData()
const digest = buildMorningDigest(data)

if (stdoutOnly) {
  process.stdout.write(digest.text + '\n')
  process.exit(0)
}

console.log('--- 摘要（' + digest.text.length + ' 字）---')
console.log(digest.text)
console.log('--- stats: ' + JSON.stringify(digest.stats) + ' ---')

if (dryRun) {
  console.log('[dry-run] 未发送')
  process.exit(0)
}

const { token, chatId } = resolveCreds()
if (token === '' || chatId === '') {
  console.error('缺少凭据：token=' + (token ? 'ok' : '缺失') + ' chatId=' + (chatId || '缺失') +
    '。设置 TELEGRAM_BOT_TOKEN 与 SPARKOS_PUSH_CHAT_ID，或设置 TELEGRAM_BRIDGE_DIR')
  process.exit(1)
}

try {
  const messageId = await sendTelegram(token, chatId, digest.text)
  console.log('[sent] chat=' + chatId + ' message_id=' + messageId)
} catch (error) {
  console.error('[FAIL] ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
