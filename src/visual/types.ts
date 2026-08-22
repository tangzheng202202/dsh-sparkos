/** SparkOS M5A visual task contracts. */

export type VisualTaskState =
  | 'queued'
  | 'generating'
  | 'generated'
  | 'waiting_visual_approval'
  | 'retry'
  | 'failed'

export type VisualBatchStatus =
  | 'queued'
  | 'generating'
  | 'waiting_visual_approval'
  | 'approved'
  | 'rejected'
  | 'failed'

export type VisualAspectRatio = '2.35:1' | '16:9' | '3:4' | '1:1'

export interface VisualBatch {
  id: string
  packageId: string
  revision: number
  sourceAssetsSha256: string
  status: VisualBatchStatus
  requiredCount: number
  approvedCount: number
  createdAt: string
  updatedAt: string
}

export interface VisualAssetTask {
  id: string
  batchId: string
  packageId: string
  assetId: string
  kind: 'cover' | 'inline' | 'carousel'
  placement: string
  prompt: string
  altText: string
  aspectRatio: VisualAspectRatio
  targetWidth: number
  targetHeight: number
  state: VisualTaskState
  idempotencyKey: string
  currentAttempt: number
  maxAttempts: number
  leaseExpiresAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface VisualAssetAttempt {
  id: string
  taskId: string
  jobId: string
  attemptNo: number
  sourceAttachmentId: string | null
  sourceMediaType: string | null
  sourceBytes: number | null
  sourceWidth: number | null
  sourceHeight: number | null
  provider: string | null
  model: string | null
  sourceTool: string | null
  sourceCallId: string | null
  promptOriginal: string
  promptEffective: string | null
  negativePrompt: string | null
  seedRequested: number | null
  seedEffective: boolean | null
  revisedPrompt: string | null
  contentFilter: string | null
  importedRelativePath: string | null
  importedSha256: string | null
  validation: Record<string, unknown>
  status: Exclude<VisualTaskState, 'queued'>
  generatedAt: string | null
  importedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface VisualStatusSnapshot {
  batches: Array<VisualBatch & {
    tasks: Array<VisualAssetTask & { attempts: VisualAssetAttempt[] }>
    readiness: {
      required: number
      queued: number
      generating: number
      waitingVisualApproval: number
      failed: number
      readyForVisualApproval: boolean
      readyForPublication: false
    }
  }>
}

export interface SubmittedAttachmentRef {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}
