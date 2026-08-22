/** DSH-facing M5A visual task tools. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { openFactoryDatabase } from '../storage/database.ts'
import {
  claimVisualTask,
  failVisualTask,
  heartbeatVisualTask,
  queueVisualBatch,
  submitVisualAttachment,
  visualStatus,
  VisualPipelineError,
} from '../visual/service.ts'
import type { SubmitVisualInput } from '../visual/service.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

interface ToolEnvelope {
  text: string
  value: Record<string, JsonValue>
}

const output = {
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      text: { type: 'string' as const, required: true },
      value: { type: 'object' as const, additionalProperties: true, required: true },
    },
  } as const,
  render: (_args: unknown, result: ToolEnvelope) => [{ type: 'text' as const, text: result.text }],
}

function ok(text: string, value: Record<string, JsonValue>): ToolEnvelope {
  return { text, value: { ok: true, ...value } }
}

function failed(error: unknown): ToolEnvelope {
  const code = error instanceof VisualPipelineError ? error.code : 'internal-error'
  const message = error instanceof Error ? error.message : String(error)
  return { text: `SparkOS visual ${code}: ${message}`, value: { ok: false, error: { code, message } } }
}

function withDb<T>(operation: (db: ReturnType<typeof openFactoryDatabase>) => T): T {
  const db = openFactoryDatabase()
  try { return operation(db) } finally { db.close() }
}

export function registerVisualTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'sparkos_visual_queue',
    description: '为已批准且完整性校验通过的 SparkOS 草稿包创建视觉批次。每个 assets.json 项独立建任务；重复调用幂等。',
    parameters: {
      packageId: { type: 'string', required: true, description: '已批准草稿包 ID（dp-...）' },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args: { packageId: string }) {
      try {
        const result = withDb((db) => queueVisualBatch(db, args.packageId))
        return ok(`视觉批次${result.created ? '已创建' : '已幂等复用'}：${result.batch.id}，${result.tasks.length} 个独立资产任务。`, result as unknown as Record<string, JsonValue>)
      } catch (error) { return failed(error) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sparkos_visual_claim',
    description: '领取一个 SparkOS 视觉资产任务。领取后按 authoritative prompt 调用 image_generate，必须从 images[0] 取得完整附件引用（attachmentId/mediaType/bytes/width/height/name），再调用 sparkos_visual_submit；不得提交 path、URL 或 base64。',
    parameters: {
      packageId: { type: 'string', description: '可选：只领取指定草稿包的任务' },
      leaseSeconds: { type: 'integer', description: '租约秒数，默认 300；允许 60–900' },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args: { packageId?: string; leaseSeconds?: number }) {
      try {
        const claim = withDb((db) => claimVisualTask(db, args))
        if (claim === null) return ok('当前没有可领取的视觉任务。', { claimed: false })
        return ok(
          `已领取 ${claim.task.assetId}（${claim.task.targetWidth}x${claim.task.targetHeight}，image_generate aspect=${claim.imageStudioAspect}）。请将 images[0] 的完整附件引用原样回交 sparkos_visual_submit。`,
          { claimed: true, ...claim } as unknown as Record<string, JsonValue>,
        )
      } catch (error) { return failed(error) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sparkos_visual_heartbeat',
    description: '为当前 SparkOS 视觉生成 attempt 延长租约；只有匹配的一次性 leaseToken 有效。',
    parameters: {
      taskId: { type: 'string', required: true },
      attemptId: { type: 'string', required: true },
      leaseToken: { type: 'string', required: true },
      leaseSeconds: { type: 'integer', description: '延期秒数，默认 300；允许 60–900' },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args: { taskId: string; attemptId: string; leaseToken: string; leaseSeconds?: number }) {
      try {
        const result = withDb((db) => heartbeatVisualTask(db, args.taskId, args.attemptId, args.leaseToken, new Date(), args.leaseSeconds))
        return ok(`视觉任务租约已延长至 ${result.leaseExpiresAt}。`, result as unknown as Record<string, JsonValue>)
      } catch (error) { return failed(error) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sparkos_visual_fail',
    description: '报告当前视觉 attempt 失败。可重试且未达到 maxAttempts 时回到 retry，否则进入 failed；历史 attempt/event 保留。',
    parameters: {
      taskId: { type: 'string', required: true },
      attemptId: { type: 'string', required: true },
      leaseToken: { type: 'string', required: true },
      code: { type: 'string', required: true },
      message: { type: 'string', required: true },
      retryable: { type: 'boolean', required: true },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args: { taskId: string; attemptId: string; leaseToken: string; code: string; message: string; retryable: boolean }) {
      try {
        const result = withDb((db) => failVisualTask(db, args))
        return ok(`视觉 attempt 已记录失败，任务状态=${result.state}。`, result as unknown as Record<string, JsonValue>)
      } catch (error) { return failed(error) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sparkos_visual_submit',
    description: '回交 image_generate 的可靠附件。先 claim，再调用 image_generate，最后把 images[0] 的完整 attachment ref 原样提交；SparkOS 会通过正式 attachments 服务重读、校验并不可变保存。禁止 path、URL、base64。成功只推进到 waiting_visual_approval。',
    parameters: {
      taskId: { type: 'string', required: true },
      attemptId: { type: 'string', required: true },
      leaseToken: { type: 'string', required: true },
      attachment: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          name: { type: 'string' },
        },
      },
      provider: { type: 'string' },
      model: { type: 'string' },
      sourceTool: { type: 'string', required: true, description: '通常为 image_generate' },
      sourceCallId: { type: 'string' },
      promptEffective: { type: 'string' },
      negativePrompt: { type: 'string' },
      seedRequested: { type: 'integer' },
      seedEffective: { type: 'boolean' },
      revisedPrompt: { type: 'string' },
      contentFilter: { type: 'string' },
      generatedAt: { type: 'string' },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args: SubmitVisualInput, execution: { signal?: AbortSignal }) {
      const db = openFactoryDatabase()
      try {
        const attachments = ctx.get('attachments')
        const result = await submitVisualAttachment(db, attachments, args, { signal: execution.signal })
        return ok(`视觉附件已验证并不可变保存：${result.relativePath}；状态=waiting_visual_approval，M5A 不会自动批准或发布。`, result as unknown as Record<string, JsonValue>)
      } catch (error) { return failed(error) } finally { db.close() }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sparkos_visual_status',
    description: '只读查询 SparkOS 视觉批次、任务、attempt、验证结果和准备度；M5A 的 readyForPublication 始终为 false。',
    parameters: {
      packageId: { type: 'string', description: '可选：筛选草稿包' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args: { packageId?: string }) {
      try {
        const snapshot = withDb((db) => visualStatus(db, args.packageId))
        return ok(`视觉批次 ${snapshot.batches.length} 个；M5A 不执行视觉批准或发布。`, snapshot as unknown as Record<string, JsonValue>)
      } catch (error) { return failed(error) }
    },
  }))
}
