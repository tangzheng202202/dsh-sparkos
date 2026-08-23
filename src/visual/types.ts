/** SparkOS M5A visual task contracts. */

export type VisualTaskState =
  | 'queued'
  | 'generating'
  | 'generated'
  | 'waiting_visual_approval'
  | 'retry'
  | 'failed'
  | 'approved'
  | 'rejected'

export type VisualBatchStatus =
  | 'queued'
  | 'generating'
  | 'waiting_visual_approval'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'partially_approved'
  | 'visual_approved_test'
  | 'visual_approved'

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
  /** Physical M5A generation state; review decisions are overlaid from approvals. */
  pipelineState?: Exclude<VisualTaskState, 'approved' | 'rejected'>
  idempotencyKey: string
  currentAttempt: number
  maxAttempts: number
  leaseExpiresAt: string | null
  lastError: string | null
  failureCount?: number
  retryCount?: number
  reviewNote?: string | null
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
  approval?: VisualAttemptApproval
}

export interface VisualAttemptApproval {
  decision: 'pending' | 'approved' | 'rejected'
  note: string | null
  decidedAt: string | null
}

/** One visual_asset_events row (audit history of a task). */
export interface VisualTaskEvent {
  id: number
  taskId: string
  attemptId: string | null
  fromState: string | null
  toState: string
  reason: string | null
  createdAt: string
}

/** Backend-computed controlled-retry eligibility for a visual task. */
export interface VisualRetryEligibility {
  eligible: boolean
  reason: string | null
  code: string | null
  expectedNextAttemptNo: number | null
}

/** One visual_retry_requests row (M6.2 controlled retry provenance). */
export interface VisualRetryRequest {
  id: string
  idempotencyKey: string
  packageId: string
  taskId: string
  attemptId: string
  assetId: string
  rejectNote: string
  supplementaryInstruction: string | null
  status: 'created' | 'claimed' | 'superseded'
  createdAt: string
  updatedAt: string
}

export interface PlatformReadiness {
  wechat: boolean
  telegram: boolean
  x: boolean
  xiaohongshu: boolean
}

export interface PublicationReadiness {
  visualApproved: boolean
  testOnly: boolean
  deliveryReady: boolean
  readyByPlatform: PlatformReadiness
  readyForPublication: boolean
  blockers: string[]
}

export interface VisualStatusSnapshot {
  batches: Array<VisualBatch & {
    tasks: Array<VisualAssetTask & {
      attempts: VisualAssetAttempt[]
      /** Backend-computed controlled-retry eligibility (M6.2). */
      retry: VisualRetryEligibility
      /** Full audit trail of the task (visual_asset_events). */
      events: VisualTaskEvent[]
    }>
    /** M6.4 只读交付下载链接（最新 manifest 交付包；无则 null）。 */
    deliveryLink: string | null
    /** M6.6 最近发布任务台账（无则 null；只读展示，不自动发布）。 */
    publishTask: { id: string; status: string; createdAt: string; updatedAt: string } | null
    readiness: {
      required: number
      queued: number
      generating: number
      waitingVisualApproval: number
      failed: number
      readyForVisualApproval: boolean
    } & PublicationReadiness
  }>
}

export interface VisualDeliveryArtifact {
  id: string
  packageId: string
  batchId: string
  version: number
  mode: 'preview' | 'production'
  platform: string
  format: string
  relativePath: string
  sha256: string
  bytes: number
  manifest: Record<string, unknown>
  createdAt: string
}

export interface SubmittedAttachmentRef {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}
