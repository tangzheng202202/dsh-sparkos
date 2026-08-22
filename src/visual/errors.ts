/** Shared visual-pipeline error with stable HTTP semantics. */
export class VisualPipelineError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, message: string, httpStatus = 422, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VisualPipelineError'
    this.code = code
    this.httpStatus = httpStatus
  }
}
