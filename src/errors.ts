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
  | 'INPUT_NOT_FOUND'
  | 'INVALID_PATH'
  | 'DOWNLOAD_FAILED'
  | 'LLM_BINARY_NOT_FOUND'
  | 'LLM_STARTUP_FAILED'
  | 'LLM_SERVER_UNAVAILABLE'
  | 'LLM_UPSTREAM_ERROR'
  | 'AUDIO_BINARY_NOT_FOUND'
  | 'AUDIO_STARTUP_FAILED'
  | 'AUDIO_SERVER_UNAVAILABLE'
  | 'AUDIO_UPSTREAM_ERROR'
  | 'AUDIO_VOICE_REF_NOT_FOUND'
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
  inputNotFound: (name: string) =>
    new AppError('INPUT_NOT_FOUND', `Input image not found: ${name}`, 404),
  invalidPath: (msg: string) => new AppError('INVALID_PATH', msg, 400),
  binaryNotFound: (path: string) =>
    new AppError('BINARY_NOT_FOUND', `stable-diffusion.cpp binary not found: ${path}`, 500),
  generationFailed: (msg: string, details?: unknown) =>
    new AppError('GENERATION_FAILED', msg, 500, details),
  processTimeout: (ms: number) =>
    new AppError('PROCESS_TIMEOUT', `Generation process exceeded timeout of ${ms}ms`, 504),
  downloadFailed: (msg: string) => new AppError('DOWNLOAD_FAILED', msg, 502),
  llmBinaryNotFound: (path: string) =>
    new AppError('LLM_BINARY_NOT_FOUND', `llama-server binary not found: ${path}`, 500),
  llmStartupFailed: (msg: string) => new AppError('LLM_STARTUP_FAILED', msg, 500),
  llmServerUnavailable: (msg: string) => new AppError('LLM_SERVER_UNAVAILABLE', msg, 502),
  llmUpstreamError: (msg: string) => new AppError('LLM_UPSTREAM_ERROR', msg, 502),
  audioBinaryNotFound: (path: string) =>
    new AppError('AUDIO_BINARY_NOT_FOUND', `audiocpp_server binary not found: ${path}`, 500),
  audioStartupFailed: (msg: string) => new AppError('AUDIO_STARTUP_FAILED', msg, 500),
  audioServerUnavailable: (msg: string) => new AppError('AUDIO_SERVER_UNAVAILABLE', msg, 502),
  audioUpstreamError: (msg: string) => new AppError('AUDIO_UPSTREAM_ERROR', msg, 502),
  audioVoiceRefNotFound: (name: string) =>
    new AppError('AUDIO_VOICE_REF_NOT_FOUND', `Voice reference audio not found: ${name}`, 404),
  internal: (msg: string) => new AppError('INTERNAL_ERROR', msg, 500),
};
