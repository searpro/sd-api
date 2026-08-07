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
  /** Model bundle id (a directory under models/) or a single model filename. */
  model: z.string().min(1, 'model is required'),

  // Phase 2
  negative_prompt: z.string().optional(),
  steps: z.number().int().min(1).max(200).optional(),
  cfg_scale: z.number().min(0).max(30).optional(),
  width: z.number().int().min(64).optional(),
  height: z.number().int().min(64).optional(),
  seed: z.number().int().min(-1).optional(),
  sampler: z.enum(SAMPLERS).optional(),

  // Image editing / img2img (names of files uploaded via POST /v1/inputs).
  /** Init image for img2img. */
  init_image: z.string().optional(),
  /** Denoising strength for img2img (0..1, default sd-cli 0.75). */
  strength: z.number().min(0).max(1).optional(),
  /** Inpaint mask image. */
  mask: z.string().optional(),
  /** Reference image(s) for edit models (Kontext, Qwen-Image-Edit, …). */
  ref_images: z.array(z.string()).max(16).optional(),
  /** Auto-increase reference indices (Qwen-Image-Edit-2509 multi-ref). */
  increase_ref_index: z.boolean().optional(),
  /** Image guidance scale for inpaint / edit models. */
  img_cfg_scale: z.number().min(0).max(30).optional(),

  // Video (Wan T2V/I2V) — only meaningful against a mode:"video" model bundle.
  // I2V's conditioning image reuses `init_image` above (same -i flag as img2img).
  /** Number of frames to generate (--video-frames). */
  video_frames: z.number().int().min(1).max(257).optional(),
  /** Flow-matching shift parameter (--flow-shift). */
  flow_shift: z.number().min(0).optional(),
});

export type GenerateParams = z.infer<typeof generateSchema>;

export const generateResponseSchema = z.object({
  // Exactly one pair is populated, depending on metadata.kind — image
  // generations keep the same shape they've always had; video generations
  // (mode:"video" bundles) populate video_path/video_url instead.
  image_path: z.string().optional(),
  image_url: z.string().optional(),
  video_path: z.string().optional(),
  video_url: z.string().optional(),
  metadata: z.object({
    kind: z.enum(['image', 'video']).optional(),
    prompt: z.string(),
    model: z.string(),
    seed: z.number().optional(),
    steps: z.number().optional(),
    cfg_scale: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    sampler: z.string().optional(),
    video_frames: z.number().optional(),
    flow_shift: z.number().optional(),
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
