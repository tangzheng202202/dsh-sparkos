/**
 * 工作台 web 半：宿主 webServer 路由。
 * GET  /sparkos/            → 9 tab 工作台 HTML（_embeddedDailyData 注入范式）
 * GET  /sparkos/app-v2      → V2 只读预览版工作台（同一数据注入范式，仅 GET，不执行任何写操作）
 * GET  /sparkos/data        → 工作台数据 JSON（含 intel 报告）
 * GET  /sparkos/intel       → 情报指挥所数据端点（健康 + 最近 run + archive 计数）
 * POST /sparkos/intel/tick  → 手动触发一轮 ingest（不自动融合）
 * POST /sparkos/editorial/decision → 人工批准/驳回周三或周六选题卡
 * GET  /sparkos/creation/artifact → 预览已校验的平台草稿产物
 * POST /sparkos/creation/decision → 人工批准/驳回完整草稿包
 * POST /sparkos/creation/revise → 为已驳回草稿包创建不可覆盖的修订版
 * POST /sparkos/visual/queue → 为 approved 草稿创建幂等视觉批次
 * GET  /sparkos/visual/status → 只读视觉任务与 attempt 状态
 * GET  /sparkos/visual/asset → 按数据库 attemptId 预览已验证的不可变图片
 * POST /sparkos/visual/decision|retry → 人工视觉审核与显式重试
 * POST/GET /sparkos/visual/delivery|deliveries|download → 派生交付包
 * POST /sparkos/mutate → { kind, id, action: adopt|ignore } 决策落 VAULT state/（不触碰星火库）
 * @module dsh-sparkos/src/server/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorkbenchData, loadWritebackQueue, recordDecision, reviewDistill } from './data.ts'
import { buildIntelReport } from '../intel/report.ts'
import { runIntelTick } from '../intel/tick.ts'
import { listRuntimeDrafts, listVaultDrafts, readDraft } from '../daily.ts'
import { openFactoryDatabase } from '../storage/database.ts'
import { queueVisualBatch, readVisualAsset, visualStatus, VisualPipelineError } from '../visual/service.ts'
import { decideVisualAttempt, requestVisualRetry, retryVisualTask } from '../visual/review.ts'
import { createVisualDelivery, listVisualDeliveries, readVisualDeliveryFile, readVisualDeliveryZip } from '../visual/delivery.ts'


/** 工作台模板：运行时读取（esbuild 打包时 build.mjs 会拷贝一份到 lib/）。 */
function loadTemplate(): string {
  return readFileSync(fileURLToPath(new URL('./page.template.html', import.meta.url)), 'utf8')
}

/** V2 只读预览版模板（同一注入范式）。 */
function loadV2Template(): string {
  return readFileSync(fileURLToPath(new URL('./page-v2.template.html', import.meta.url)), 'utf8')
}

function respondJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function respondVisualError(res: import('node:http').ServerResponse, error: unknown): void {
  const status = error instanceof VisualPipelineError ? error.httpStatus : 500
  const code = error instanceof VisualPipelineError ? error.code : 'internal-error'
  const message = error instanceof Error ? error.message : String(error)
  respondJson(res, status, { ok: false, error: { code, message } })
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
    if (req.method === 'GET' && path === '/sparkos/app-v2') {
      // V2 只读预览版：仅 GET；同源数据注入；不注册任何写路由
      const data = JSON.stringify(buildWorkbenchData()).replace(/</g, '\u003c')
      const html = loadV2Template().replace(
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
    if (req.method === 'POST' && path === '/sparkos/visual/queue') {
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
      if (typeof body.packageId !== 'string' || Object.keys(body).some((key) => key !== 'packageId')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许 packageId' } })
        return
      }
      const db = openFactoryDatabase()
      try {
        const value = queueVisualBatch(db, body.packageId)
        respondJson(res, value.created ? 201 : 200, { ok: true, value })
      } catch (error) {
        respondVisualError(res, error)
      } finally {
        db.close()
      }
      return
    }
    if (req.method === 'GET' && path === '/sparkos/visual/status') {
      const packageId = url.searchParams.get('packageId') ?? undefined
      const db = openFactoryDatabase()
      try {
        respondJson(res, 200, { ok: true, value: visualStatus(db, packageId) })
      } catch (error) {
        respondVisualError(res, error)
      } finally {
        db.close()
      }
      return
    }
    if (req.method === 'GET' && path === '/sparkos/visual/asset') {
      const attemptId = url.searchParams.get('attemptId') ?? ''
      if ([...url.searchParams.keys()].some((key) => key !== 'attemptId') || url.searchParams.getAll('attemptId').length !== 1) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许一个 attemptId 参数' } })
        return
      }
      const db = openFactoryDatabase()
      try {
        const asset = readVisualAsset(db, attemptId)
        if (asset === null) {
          respondJson(res, 404, { ok: false, error: { code: 'not-found', message: '视觉资产不存在、未到预览状态或完整性校验失败' } })
          return
        }
        res.writeHead(200, {
          'content-type': asset.mediaType,
          'content-length': String(asset.bytes),
          'x-content-type-options': 'nosniff',
          'cross-origin-resource-policy': 'same-origin',
          'cache-control': 'private, no-store',
        })
        res.end(asset.content)
      } finally {
        db.close()
      }
      return
    }
    if (req.method === 'POST' && path === '/sparkos/visual/decision') {
      let body: Record<string, unknown>
      try { body = await readJsonBody(req) } catch {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body 必须是合法 JSON' } })
        return
      }
      if (typeof body.attemptId !== 'string' || (body.decision !== 'approved' && body.decision !== 'rejected')
        || (body.note !== undefined && typeof body.note !== 'string')
        || Object.keys(body).some((key) => !['attemptId', 'decision', 'note'].includes(key))) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许 attemptId、decision 和可选 note' } })
        return
      }
      const db = openFactoryDatabase()
      try {
        respondJson(res, 200, { ok: true, value: decideVisualAttempt(db, { attemptId: body.attemptId, decision: body.decision, note: body.note as string | undefined }) })
      } catch (error) { respondVisualError(res, error) } finally { db.close() }
      return
    }
    if (req.method === 'POST' && path === '/sparkos/visual/retry') {
      let body: Record<string, unknown>
      try { body = await readJsonBody(req) } catch {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body 必须是合法 JSON' } })
        return
      }
      const keys = Object.keys(body)
      // M6.2 controlled retry schema; the legacy { taskId } shape still works.
      if (keys.length === 1 && typeof body.taskId === 'string') {
        const db = openFactoryDatabase()
        try { respondJson(res, 200, { ok: true, value: retryVisualTask(db, body.taskId) }) }
        catch (error) { respondVisualError(res, error) } finally { db.close() }
        return
      }
      const allowed = ['packageId', 'taskId', 'currentAttemptId', 'assetId', 'idempotencyKey', 'supplementaryInstruction']
      if (keys.some((key) => !allowed.includes(key))
        || typeof body.packageId !== 'string' || typeof body.taskId !== 'string'
        || typeof body.currentAttemptId !== 'string' || typeof body.assetId !== 'string'
        || typeof body.idempotencyKey !== 'string'
        || (body.supplementaryInstruction !== undefined && typeof body.supplementaryInstruction !== 'string')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许 packageId、taskId、currentAttemptId、assetId、idempotencyKey 和可选 supplementaryInstruction' } })
        return
      }
      const db = openFactoryDatabase()
      try {
        respondJson(res, 200, { ok: true, value: requestVisualRetry(db, body as { packageId: string; taskId: string; currentAttemptId: string; assetId: string; idempotencyKey: string; supplementaryInstruction?: string }) })
      } catch (error) { respondVisualError(res, error) } finally { db.close() }
      return
    }
    if (req.method === 'POST' && path === '/sparkos/visual/delivery') {
      let body: Record<string, unknown>
      try { body = await readJsonBody(req) } catch {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body 必须是合法 JSON' } })
        return
      }
      if (typeof body.packageId !== 'string' || (body.mode !== 'preview' && body.mode !== 'production')
        || Object.keys(body).some((key) => key !== 'packageId' && key !== 'mode')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许 packageId 和 mode' } })
        return
      }
      const db = openFactoryDatabase()
      try {
        const value = createVisualDelivery(db, { packageId: body.packageId, mode: body.mode })
        respondJson(res, value.created ? 201 : 200, { ok: true, value })
      } catch (error) { respondVisualError(res, error) } finally { db.close() }
      return
    }
    if (req.method === 'GET' && path === '/sparkos/visual/deliveries') {
      const packageId = url.searchParams.get('packageId') ?? ''
      if (url.searchParams.getAll('packageId').length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'packageId')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许一个 packageId 参数' } })
        return
      }
      const db = openFactoryDatabase()
      try { respondJson(res, 200, { ok: true, value: listVisualDeliveries(db, packageId) }) }
      catch (error) { respondVisualError(res, error) } finally { db.close() }
      return
    }
    if (req.method === 'GET' && path === '/sparkos/visual/delivery') {
      const deliveryId = url.searchParams.get('deliveryId') ?? ''
      const file = url.searchParams.get('file') ?? ''
      if (url.searchParams.getAll('deliveryId').length !== 1 || url.searchParams.getAll('file').length !== 1
        || [...url.searchParams.keys()].some((key) => key !== 'deliveryId' && key !== 'file')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许 deliveryId 和 file' } })
        return
      }
      const db = openFactoryDatabase()
      try {
        const item = readVisualDeliveryFile(db, deliveryId, file)
        const extension = nodePath.extname(file).toLowerCase()
        const contentType = extension === '.html' ? 'text/html; charset=utf-8' : extension === '.json' ? 'application/json; charset=utf-8'
          : extension === '.md' ? 'text/plain; charset=utf-8' : extension === '.png' ? 'image/png'
            : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'application/octet-stream'
        const headers: Record<string, string> = { 'content-type': contentType, 'content-length': String(item.content.byteLength), 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' }
        if (extension === '.html') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"
        res.writeHead(200, headers)
        res.end(item.content)
      } catch (error) { respondVisualError(res, error) } finally { db.close() }
      return
    }
    if (req.method === 'GET' && path === '/sparkos/visual/download') {
      const deliveryId = url.searchParams.get('deliveryId') ?? ''
      if (url.searchParams.getAll('deliveryId').length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'deliveryId')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '仅允许一个 deliveryId 参数' } })
        return
      }
      const db = openFactoryDatabase()
      try {
        const item = readVisualDeliveryZip(db, deliveryId)
        res.writeHead(200, {
          'content-type': 'application/zip', 'content-length': String(item.content.byteLength),
          'content-disposition': `attachment; filename="${item.filename}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
        })
        res.end(item.content)
      } catch (error) { respondVisualError(res, error) } finally { db.close() }
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
    if (req.method === 'GET' && path === '/sparkos/creation/artifact') {
      const packageId = url.searchParams.get('packageId') ?? ''
      const file = url.searchParams.get('file') ?? ''
      const { openFactoryDatabase } = await import('../storage/database.ts')
      const { readDraftArtifact } = await import('../creation/drafts.ts')
      const db = openFactoryDatabase()
      try {
        const artifact = readDraftArtifact(db, packageId, file)
        if (!artifact) {
          respondJson(res, 404, { ok: false, error: { code: 'not-found', message: 'draft artifact' } })
          return
        }
        const contentType = artifact.format === 'html' ? 'text/html; charset=utf-8'
          : artifact.format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
        const headers: Record<string, string> = { 'content-type': contentType, 'x-content-type-options': 'nosniff' }
        if (artifact.format === 'html') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
        res.writeHead(200, headers)
        res.end(artifact.content)
      } finally {
        db.close()
      }
      return
    }
    if (req.method === 'POST' && path === '/sparkos/creation/decision') {
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
      const packageId = typeof body.packageId === 'string' ? body.packageId : ''
      const decision = body.decision
      const note = typeof body.note === 'string' ? body.note.trim() : ''
      if (!/^dp-[a-f0-9]{16}$/.test(packageId) || (decision !== 'approved' && decision !== 'rejected')) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'packageId 或 decision 不合法' } })
        return
      }
      if (decision === 'rejected' && note === '') {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: '驳回草稿必须填写审核意见' } })
        return
      }
      try {
        const { reviewDraftPackage } = await import('../factory/service.ts')
        const draftPackage = reviewDraftPackage(packageId, decision, note || undefined)
        respondJson(res, 200, { ok: true, value: draftPackage })
      } catch (error) {
        respondJson(res, 422, { ok: false, error: { code: 'invalid-state', message: error instanceof Error ? error.message : String(error) } })
      }
      return
    }
    if (req.method === 'POST' && path === '/sparkos/creation/revise') {
      let body: Record<string, unknown>
      try { body = await readJsonBody(req) } catch {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body 必须是合法 JSON' } })
        return
      }
      const packageId = typeof body.packageId === 'string' ? body.packageId : ''
      if (!/^dp-[a-f0-9]{16}$/.test(packageId)) {
        respondJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'packageId 不合法' } })
        return
      }
      try {
        const { requestDraftRevision } = await import('../factory/service.ts')
        const result = requestDraftRevision(packageId)
        respondJson(res, 200, { ok: true, value: result.package, created: result.created })
      } catch (error) {
        respondJson(res, 422, { ok: false, error: { code: 'invalid-state', message: error instanceof Error ? error.message : String(error) } })
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
