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
  // Video (Wan T2V/I2V) — only emitted when bundle.mode === 'video'.
  video_frames: '--video-frames',
  flow_shift: '--flow-shift',
} as const;

/** sd-cli flag for each resolved weight / text-encoder component. */
export const WEIGHT_FLAG = {
  vae: '--vae',
  clip_l: '--clip_l',
  clip_g: '--clip_g',
  clip_vision: '--clip_vision',
  t5xxl: '--t5xxl',
  llm: '--llm',
  llm_vision: '--llm_vision',
} as const;

/** Resolved, validated absolute paths for editing input images. */
export interface InputImages {
  init?: string;
  mask?: string;
  refs?: string[];
}

export interface BuildArgsInput {
  /** Generation parameters, with bundle defaults already merged in. */
  params: GenerateParams;
  /** The resolved model bundle (checkpoint + components). */
  bundle: ResolvedBundle;
  /** Absolute output image path. */
  outputPath: string;
  /** Resolved input image paths for img2img / edit. */
  images?: InputImages;
}

/**
 * Produce the argv array for `spawn`. Values are passed as discrete array
 * elements (never concatenated into a shell string), so there is no shell
 * interpolation and prompts cannot inject extra flags.
 */
export function buildArgs(input: BuildArgsInput): string[] {
  const { params, bundle, outputPath, images } = input;
  const args: string[] = [];

  // Video (Wan T2V/I2V) — switches sd-cli into video-generation mode.
  if (bundle.mode === 'video') args.push('-M', 'vid_gen');

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

  // Image editing / img2img inputs.
  if (images?.init) args.push('-i', images.init);
  if (images?.mask) args.push('--mask', images.mask);
  for (const ref of images?.refs ?? []) args.push('-r', ref);
  if (params.strength !== undefined) args.push('--strength', String(params.strength));
  if (params.img_cfg_scale !== undefined) args.push('--img-cfg-scale', String(params.img_cfg_scale));
  if (params.increase_ref_index) args.push('--increase-ref-index');

  // LoRA directory — LoRAs are activated via <lora:name:mult> in the prompt.
  if (bundle.loraDir) args.push('--lora-model-dir', bundle.loraDir);

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

  // Video (Wan T2V/I2V) params — I2V's conditioning image reuses -i (images.init)
  // above, no separate flag needed.
  if (params.video_frames !== undefined) args.push(FLAG_MAP.video_frames, String(params.video_frames));
  if (params.flow_shift !== undefined) args.push(FLAG_MAP.flow_shift, String(params.flow_shift));

  // Model-specific extra flags from the bundle manifest.
  for (const a of bundle.extraArgs) args.push(a);

  return args;
}
