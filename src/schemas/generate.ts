import { z } from 'zod';

/**
 * Sampling methods supported by stable-diffusion.cpp (`--sampling-method`).
 * Kept in sync with the CLI; unknown values are rejected by validation.
 */
export const SAMPLERS = [
  'euler',
  'euler_a',
  'heun',
  'dpm2',
  'dpm++2s_a',
  'dpm++2m',
  'dpm++2mv2',
  'ipndm',
  'ipndm_v',
  'lcm',
  'ddim_trailing',
  'tcd',
] as const;

export const generateSchema = z.object({
  // Phase 1
  prompt: z.string().min(1, 'prompt is required'),
  model: z.string().min(1, 'model is required'),

  // Phase 2
  negative_prompt: z.string().optional(),
  steps: z.number().int().min(1).max(200).optional(),
  cfg_scale: z.number().min(0).max(30).optional(),
  width: z.number().int().min(64).optional(),
  height: z.number().int().min(64).optional(),
  seed: z.number().int().min(-1).optional(),
  sampler: z.enum(SAMPLERS).optional(),

  // Optional weights (Phase 3); names within the models dir.
  vae: z.string().optional(),
  clip_l: z.string().optional(),
  clip_g: z.string().optional(),
  t5xxl: z.string().optional(),
});

export type GenerateParams = z.infer<typeof generateSchema>;

export const generateResponseSchema = z.object({
  image_path: z.string(),
  image_url: z.string(),
  metadata: z.object({
    prompt: z.string(),
    model: z.string(),
    seed: z.number().optional(),
    steps: z.number().optional(),
    cfg_scale: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    sampler: z.string().optional(),
    duration_ms: z.number(),
  }),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
