/**
 * Structured application errors (Spec section 4).
 *
 * Every error surfaced to a client carries a stable machine-readable `code`
 * and an HTTP status, serialized as:
 *   { "error": { "code": "MODEL_NOT_FOUND", "message": "..." } }
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'INVALID_MODEL'
  | 'MISSING_WEIGHTS'
  | 'GENERATION_FAILED'
  | 'PROCESS_TIMEOUT'
  | 'BINARY_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'OUTPUT_NOT_FOUND'
  | 'INVALID_PATH'
  | 'DOWNLOAD_FAILED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const errors = {
  modelNotFound: (name: string) =>
    new AppError('MODEL_NOT_FOUND', `Model not found: ${name}`, 404),
  invalidModel: (msg: string) => new AppError('INVALID_MODEL', msg, 422),
  missingWeights: (msg: string) => new AppError('MISSING_WEIGHTS', msg, 422),
  jobNotFound: (id: string) => new AppError('JOB_NOT_FOUND', `Job not found: ${id}`, 404),
  outputNotFound: (name: string) =>
    new AppError('OUTPUT_NOT_FOUND', `Output not found: ${name}`, 404),
  invalidPath: (msg: string) => new AppError('INVALID_PATH', msg, 400),
  binaryNotFound: (path: string) =>
    new AppError('BINARY_NOT_FOUND', `stable-diffusion.cpp binary not found: ${path}`, 500),
  generationFailed: (msg: string, details?: unknown) =>
    new AppError('GENERATION_FAILED', msg, 500, details),
  processTimeout: (ms: number) =>
    new AppError('PROCESS_TIMEOUT', `Generation process exceeded timeout of ${ms}ms`, 504),
  downloadFailed: (msg: string) => new AppError('DOWNLOAD_FAILED', msg, 502),
  internal: (msg: string) => new AppError('INTERNAL_ERROR', msg, 500),
};
