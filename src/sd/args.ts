import type { GenerateParams } from '../schemas/generate.js';

/**
 * Mapping from API parameters to stable-diffusion.cpp CLI flags (Spec section 3).
 *
 * The mapping is data-driven so it stays easy to audit and adjust if the
 * upstream CLI changes. Each entry names the flag the value is passed with.
 */
export const FLAG_MAP = {
  prompt: '-p',
  negative_prompt: '-n',
  steps: '--steps',
  cfg_scale: '--cfg-scale',
  width: '-W',
  height: '-H',
  seed: '-s',
  sampler: '--sampling-method',
} as const;

export interface BuildArgsInput {
  params: GenerateParams;
  /** Absolute path to the resolved .gguf checkpoint. */
  modelPath: string;
  /** Absolute output image path. */
  outputPath: string;
  /** Absolute paths for optional weights, already resolved + validated. */
  weights?: {
    vae?: string;
    clip_l?: string;
    clip_g?: string;
    t5xxl?: string;
  };
}

/**
 * Produce the argv array for `spawn`. Values are passed as discrete array
 * elements (never concatenated into a shell string), so there is no shell
 * interpolation and prompts cannot inject extra flags.
 */
export function buildArgs(input: BuildArgsInput): string[] {
  const { params, modelPath, outputPath, weights } = input;
  const args: string[] = [];

  // Core: model + output.
  args.push('-m', modelPath);
  args.push('-o', outputPath);

  // Prompt is always present.
  args.push(FLAG_MAP.prompt, params.prompt);

  // Optional generation parameters (Phase 2).
  if (params.negative_prompt) args.push(FLAG_MAP.negative_prompt, params.negative_prompt);
  if (params.steps !== undefined) args.push(FLAG_MAP.steps, String(params.steps));
  if (params.cfg_scale !== undefined) args.push(FLAG_MAP.cfg_scale, String(params.cfg_scale));
  if (params.width !== undefined) args.push(FLAG_MAP.width, String(params.width));
  if (params.height !== undefined) args.push(FLAG_MAP.height, String(params.height));
  if (params.seed !== undefined) args.push(FLAG_MAP.seed, String(params.seed));
  if (params.sampler) args.push(FLAG_MAP.sampler, params.sampler);

  // Optional weights (Phase 3).
  if (weights?.vae) args.push('--vae', weights.vae);
  if (weights?.clip_l) args.push('--clip_l', weights.clip_l);
  if (weights?.clip_g) args.push('--clip_g', weights.clip_g);
  if (weights?.t5xxl) args.push('--t5xxl', weights.t5xxl);

  return args;
}
