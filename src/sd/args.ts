import type { GenerateParams } from '../schemas/generate.js';
import type { ResolvedBundle } from '../models/bundle.js';

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

/** sd-cli flag for each resolved weight / text-encoder component. */
export const WEIGHT_FLAG = {
  vae: '--vae',
  clip_l: '--clip_l',
  clip_g: '--clip_g',
  clip_vision: '--clip_vision',
  t5xxl: '--t5xxl',
  llm: '--llm',
} as const;

export interface BuildArgsInput {
  /** Generation parameters, with bundle defaults already merged in. */
  params: GenerateParams;
  /** The resolved model bundle (checkpoint + components). */
  bundle: ResolvedBundle;
  /** Absolute output image path. */
  outputPath: string;
}

/**
 * Produce the argv array for `spawn`. Values are passed as discrete array
 * elements (never concatenated into a shell string), so there is no shell
 * interpolation and prompts cannot inject extra flags.
 */
export function buildArgs(input: BuildArgsInput): string[] {
  const { params, bundle, outputPath } = input;
  const args: string[] = [];

  // Checkpoint: a full model uses -m; a standalone diffusion model uses
  // --diffusion-model and is accompanied by its VAE / text encoders.
  if (bundle.loadMode === 'diffusion-model') {
    args.push('--diffusion-model', bundle.checkpointPath);
  } else {
    args.push('-m', bundle.checkpointPath);
  }

  // Auto-wired components from the bundle.
  for (const [role, flag] of Object.entries(WEIGHT_FLAG) as [
    keyof typeof WEIGHT_FLAG,
    string,
  ][]) {
    const path = bundle.weights[role];
    if (path) args.push(flag, path);
  }

  // Output.
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

  return args;
}
