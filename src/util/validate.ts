import type { GenerateParams } from '../schemas/generate.js';
import { AppError } from '../errors.js';

/** Enforce the max image-dimension safety limit (Spec section 5). */
export function validateDimensions(params: GenerateParams, maxDim: number): void {
  for (const key of ['width', 'height'] as const) {
    const v = params[key];
    if (v !== undefined && v > maxDim) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${key} ${v} exceeds the maximum allowed dimension of ${maxDim}`,
        400,
      );
    }
  }
}
