/**
 * 工作台 web 半：宿主 webServer 路由。
 * GET  /sparkos/            → 9 tab 工作台 HTML（_embeddedDailyData 注入范式）
 * GET  /sparkos/data        → 工作台数据 JSON（含 intel 报告）
 * GET  /sparkos/intel       → 情报指挥所数据端点（健康 + 最近 run + archive 计数）
 * POST /sparkos/intel/tick  → 手动触发一轮 ingest（不自动融合）
 * POST /sparkos/mutate → { kind, id, action: adopt|ignore } 决策落 VAULT state/（不触碰星火库）
 * @module dsh-sparkos/src/server/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { buildWorkbenchData, recordDecision, reviewDistill } from './data.ts'
import { buildIntelReport } from '../intel/report.ts'
import { runIntelTick } from '../intel/tick.ts'
import template from './page.template.html'

function respondJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

export async function handleSparkosHttp(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://dsh-sparkos.local')
  const path = url.pathname.replace(/\/+$/, '') || '/sparkos'
  try {
    if (req.method === 'GET' && (path === '/sparkos' || path === '/sparkos/app')) {
      const data = JSON.stringify(buildWorkbenchData()).replace(/</g, '\\u003c')
      const html = (template as string).replace(
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
    if (req.method === 'POST' && path === '/sparkos/mutate') {
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch {
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
