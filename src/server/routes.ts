/**
 * 工作台 web 半：宿主 webServer 路由。
 * GET  /sparkos/            → 9 tab 工作台 HTML（_embeddedDailyData 注入范式）
 * GET  /sparkos/data        → 工作台数据 JSON（含 intel 报告）
 * GET  /sparkos/intel       → 情报指挥所数据端点（健康 + 最近 run + archive 计数）
 * POST /sparkos/intel/tick  → 手动触发一轮 ingest（不自动融合）
 * POST /sparkos/editorial/decision → 人工批准/驳回周三或周六选题卡
 * POST /sparkos/mutate → { kind, id, action: adopt|ignore } 决策落 VAULT state/（不触碰星火库）
 * @module dsh-sparkos/src/server/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildWorkbenchData, loadWritebackQueue, recordDecision, reviewDistill } from './data.ts'
import { buildIntelReport } from '../intel/report.ts'
import { runIntelTick } from '../intel/tick.ts'
import { listRuntimeDrafts, listVaultDrafts, readDraft } from '../daily.ts'


/** 工作台模板：运行时读取（esbuild 打包时 build.mjs 会拷贝一份到 lib/）。 */
function loadTemplate(): string {
  return readFileSync(fileURLToPath(new URL('./page.template.html', import.meta.url)), 'utf8')
}

function respondJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** 请求体上限 256KB（防内存滥用）。 */
const MAX_BODY_BYTES = 256 * 1024

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) {
      const err = new Error('request body too large') as Error & { code?: string }
      err.code = 'BODY_TOO_LARGE'
      throw err
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

export async function handleSparkosHttp(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://dsh-sparkos.local')
  const path = url.pathname.replace(/\/+$/, '') || '/sparkos'
  try {
    if (req.method === 'GET' && (path === '/sparkos' || path === '/sparkos/app')) {
      const data = JSON.stringify(buildWorkbenchData()).replace(/</g, '\\u003c')
      const html = loadTemplate().replace(
        '<script>',
        `<script>window._embeddedDailyData = ${data};</script>\n<script>`,
      )
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (req.method === 'GET' && path === '/sparkos/data') {
      respondJson(res, 200, { ok: true, value: buildWorkbenchData() })
      return
    }
    if (req.method === 'GET' && path === '/sparkos/intel') {
      // 情报指挥所数据端点（只读：健康 + 最近 run + archive 计数）
      respondJson(res, 200, { ok: true, value: buildIntelReport() })
      return
    }
    if (req.method === 'POST' && path === '/sparkos/intel/tick') {
      // 手动触发一轮 ingest + 健康 + run 留痕（不自动融合）
      const r = runIntelTick()
      respondJson(res, 200, { ok: r.ingest.ok && r.overall !== 'red', value: r.ingest })
      return
    }
    if (req.method === 'POST' && path === '/sparkos/editorial/decision') {
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'BODY_TOO_LARGE') {
          respondJson(res, 413, { ok: false, error: { code: 'payload-too-large', message: '请求体超过 256KB 上限' } })
          return
        }
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body 必须是合法 JSON' } })
        return
      }
      const cardId = typeof body.cardId === 'string' ? body.cardId : ''
      const decision = body.decision
      if (!/^ec-[a-f0-9]{16}$/.test(cardId) || (decision !== 'approved' && decision !== 'rejected')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'cardId 或 decision 不合法' } })
        return
      }
      try {
        const { reviewEditorialCard } = await import('../factory/service.ts')
        const card = reviewEditorialCard(cardId, decision, typeof body.note === 'string' ? body.note : undefined)
        respondJson(res, 200, { ok: true, value: card })
      } catch (error) {
        respondJson(res, 404, { ok: false, error: { code: 'not-found', message: error instanceof Error ? error.message : String(error) } })
      }
      return
    }
    if (req.method === 'GET' && path === '/sparkos/writeback') {
      // 待写回清单（蒸馏采纳产物，人工复制后写回星火库）
      respondJson(res, 200, { ok: true, value: loadWritebackQueue() })
      return
    }
    if (req.method === 'POST' && path === '/sparkos/writeback/clear') {
      // 人工确认写回完成后清空清单（只动 VAULT state/，不触碰星火库）
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const { VAULT_ROOT } = await import('../vault.ts')
      const { join } = await import('node:path')
      mkdirSync(join(VAULT_ROOT, 'state'), { recursive: true })
      writeFileSync(join(VAULT_ROOT, 'state', 'writeback_queue.json'), '[]\n')
      respondJson(res, 200, { ok: true })
      return
    }
    if (req.method === 'POST' && path === '/sparkos/writeback/remove') {
      // 逐条移除待写回（人工确认已写回星火库后）
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'BODY_TOO_LARGE') {
          respondJson(res, 413, { ok: false, error: { code: 'payload-too-large', message: '请求体超过 256KB 上限' } })
          return
        }
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body 必须是合法 JSON' } })
        return
      }
      const file = typeof body.file === 'string' ? body.file : ''
      if (file === '') {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'file 必填' } })
        return
      }
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const { VAULT_ROOT } = await import('../vault.ts')
      const { join } = await import('node:path')
      const queueFile = join(VAULT_ROOT, 'state', 'writeback_queue.json')
      const queue = loadWritebackQueue().filter((e) => e.file !== file)
      mkdirSync(join(VAULT_ROOT, 'state'), { recursive: true })
      writeFileSync(queueFile, JSON.stringify(queue, null, 2) + '\n')
      respondJson(res, 200, { ok: true, value: queue })
      return
    }
    if (req.method === 'GET' && path === '/sparkos/draft') {
      // 按文件名读草稿全文（仅允许两个已知草稿目录内的文件，拒绝路径穿越）
      const file = typeof url.searchParams.get('file') === 'string' ? String(url.searchParams.get('file')) : ''
      if (file === '' || file.includes('/') || file.includes('\\') || file.includes('..')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'file 不合法' } })
        return
      }
      const candidates = [...listRuntimeDrafts(), ...listVaultDrafts()].filter((d) => d.file === file)
      if (candidates.length === 0) {
        respondJson(res, 404, { ok: false, error: { code: 'not-found', message: 'draft: ' + file } })
        return
      }
      const content = readDraft(candidates[0].path)
      respondJson(res, 200, { ok: true, value: { file, path: candidates[0].path, content: content ?? '' } })
      return
    }
    if (req.method === 'POST' && path === '/sparkos/mutate') {
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'BODY_TOO_LARGE') {
          respondJson(res, 413, { ok: false, error: { code: 'payload-too-large', message: '请求体超过 256KB 上限' } })
          return
        }
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body 必须是合法 JSON' } })
        return
      }
      const { kind, id, action } = body as { kind?: unknown; id?: unknown; action?: unknown }
      if (typeof kind !== 'string' || kind === '' || !/^[\w.-]{1,64}$/.test(kind)) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'kind 不合法' } })
        return
      }
      if (typeof id !== 'string' || id === '' || id.length > 128) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'id 不合法' } })
        return
      }
      if (action !== 'adopt' && action !== 'ignore') {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'action 只允许 adopt/ignore' } })
        return
      }
      if (kind === 'distill') {
        try {
          const r = reviewDistill(id, action)
          respondJson(res, 200, { ok: true, entry: r.entry })
        } catch (error) {
          respondJson(res, 422, { ok: false, error: { code: 'red-line', message: error instanceof Error ? error.message : String(error) } })
        }
        return
      }
      const entry = recordDecision(kind, id, action, typeof body.note === 'string' ? body.note : undefined)
      respondJson(res, 200, { ok: true, entry })
      return
    }
    respondJson(res, 404, { ok: false, error: { code: 'not-found', message: path } })
  } catch (error) {
    const code = error instanceof Error && (error as Error & { code?: string }).code
    if (code === 'BODY_TOO_LARGE') {
      respondJson(res, 413, { ok: false, error: { code: 'payload-too-large', message: '请求体超过 256KB 上限' } })
      return
    }
    respondJson(res, 500, {
      ok: false,
      error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
    })
  }
}

export function registerWorkbench(ctx: Context): void {
  ctx.inject(['webServer'], (httpCtx: Context) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'prefix',
      path: '/sparkos',
      handler: async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        await handleSparkosHttp(req, res)
      },
    }))
  })
}
