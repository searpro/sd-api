import { describe, it, expect } from 'vitest';
import { buildArgs } from '../src/sd/args.js';
import { parseProgress } from '../src/sd/progress.js';
import type { ResolvedBundle } from '../src/models/bundle.js';

const fullModel: ResolvedBundle = {
  id: 'm.gguf',
  dir: '/models',
  displayName: 'm.gguf',
  loadMode: 'model',
  mode: 'image',
  checkpointPath: '/models/m.gguf',
  weights: {},
  defaults: {},
  extraArgs: [],
};

const splitModel: ResolvedBundle = {
  id: 'z-image',
  dir: '/models/z-image',
  displayName: 'z-image',
  loadMode: 'diffusion-model',
  mode: 'image',
  checkpointPath: '/models/z-image/checkpoint/z.gguf',
  weights: { vae: '/models/z-image/vae/v.sft', llm: '/models/z-image/clip/qwen.gguf' },
  defaults: {},
  extraArgs: [],
};

const wanBundle: ResolvedBundle = {
  id: 'wan2.1-t2v-1.3b',
  dir: '/models/wan2.1-t2v-1.3b',
  displayName: 'Wan2.1 T2V 1.3B',
  loadMode: 'diffusion-model',
  mode: 'video',
  checkpointPath: '/models/wan2.1-t2v-1.3b/checkpoint/wan.gguf',
  weights: {
    vae: '/models/wan2.1-t2v-1.3b/vae/wan_2.1_vae.safetensors',
    t5xxl: '/models/wan2.1-t2v-1.3b/clip/umt5xxl.gguf',
  },
  defaults: {},
  extraArgs: [],
};

const wanI2vBundle: ResolvedBundle = {
  ...wanBundle,
  id: 'wan2.1-i2v-14b',
  weights: { ...wanBundle.weights, clip_vision: '/models/wan2.1-i2v-14b/clip/clip_vision_h.safetensors' },
};

describe('buildArgs', () => {
  it('uses -m for a full model checkpoint', () => {
    const args = buildArgs({
      params: { prompt: 'a cat', model: 'm.gguf' },
      bundle: fullModel,
      outputPath: '/out/x.png',
    });
    expect(args).toEqual(['-m', '/models/m.gguf', '-o', '/out/x.png', '-p', 'a cat']);
  });

  it('uses --diffusion-model and wires vae + llm for a split model', () => {
    const args = buildArgs({
      params: { prompt: 'a cat', model: 'z-image' },
      bundle: splitModel,
      outputPath: '/out/x.png',
    });
    expect(args).toContain('--diffusion-model');
    expect(args).not.toContain('-m');
    expect(args[args.indexOf('--diffusion-model') + 1]).toBe('/models/z-image/checkpoint/z.gguf');
    expect(args[args.indexOf('--vae') + 1]).toBe('/models/z-image/vae/v.sft');
    expect(args[args.indexOf('--llm') + 1]).toBe('/models/z-image/clip/qwen.gguf');
  });

  it('maps all phase-2 params', () => {
    const args = buildArgs({
      params: {
        prompt: 'p',
        model: 'm.gguf',
        negative_prompt: 'bad',
        steps: 20,
        cfg_scale: 7,
        width: 512,
        height: 768,
        seed: 1234,
        sampler: 'euler_a',
      },
      bundle: fullModel,
      outputPath: '/x.png',
    });
    expect(args).toContain('--steps');
    expect(args).toContain('20');
    expect(args).toContain('--cfg-scale');
    expect(args).toContain('-W');
    expect(args).toContain('512');
    expect(args).toContain('-H');
    expect(args).toContain('768');
    expect(args).toContain('-s');
    expect(args).toContain('1234');
    expect(args).toContain('--sampling-method');
    expect(args).toContain('euler_a');
    expect(args).toContain('-n');
    expect(args).toContain('bad');
  });

  it('wires img2img and edit reference images', () => {
    const args = buildArgs({
      params: { prompt: 'p', model: 'z-image', strength: 0.4, increase_ref_index: true, img_cfg_scale: 2 },
      bundle: splitModel,
      outputPath: '/x.png',
      images: { init: '/in/a.png', mask: '/in/m.png', refs: ['/in/r1.png', '/in/r2.png'] },
    });
    expect(args[args.indexOf('-i') + 1]).toBe('/in/a.png');
    expect(args[args.indexOf('--mask') + 1]).toBe('/in/m.png');
    expect(args.filter((a) => a === '-r')).toHaveLength(2);
    const refIdx = args.indexOf('-r');
    expect(args[refIdx + 1]).toBe('/in/r1.png');
    expect(args).toContain('--increase-ref-index');
    expect(args[args.indexOf('--strength') + 1]).toBe('0.4');
    expect(args[args.indexOf('--img-cfg-scale') + 1]).toBe('2');
  });

  it('passes --lora-model-dir when the bundle has a lora dir', () => {
    const args = buildArgs({
      params: { prompt: 'a cat <lora:lineart:0.8>', model: 'z' },
      bundle: { ...splitModel, loraDir: '/models/z-image/lora' },
      outputPath: '/x.png',
    });
    expect(args[args.indexOf('--lora-model-dir') + 1]).toBe('/models/z-image/lora');
    // The lora tag stays in the prompt verbatim.
    expect(args[args.indexOf('-p') + 1]).toContain('<lora:lineart:0.8>');
  });

  it('omits --lora-model-dir when there is no lora dir', () => {
    const args = buildArgs({ params: { prompt: 'p', model: 'm' }, bundle: fullModel, outputPath: '/x.png' });
    expect(args).not.toContain('--lora-model-dir');
  });

  it('appends manifest extra args', () => {
    const args = buildArgs({
      params: { prompt: 'p', model: 'q' },
      bundle: { ...splitModel, extraArgs: ['--qwen-image-zero-cond-t', '--flow-shift', '3'] },
      outputPath: '/x.png',
    });
    expect(args.slice(-3)).toEqual(['--qwen-image-zero-cond-t', '--flow-shift', '3']);
  });

  it('emits -M vid_gen and --video-frames/--flow-shift for a video (Wan) bundle', () => {
    const args = buildArgs({
      params: { prompt: 'a cat flying', model: 'wan2.1-t2v-1.3b', video_frames: 33, flow_shift: 3 },
      bundle: wanBundle,
      outputPath: '/out/x.webm',
    });
    expect(args.slice(0, 2)).toEqual(['-M', 'vid_gen']);
    expect(args[args.indexOf('--diffusion-model') + 1]).toBe('/models/wan2.1-t2v-1.3b/checkpoint/wan.gguf');
    expect(args[args.indexOf('--vae') + 1]).toBe('/models/wan2.1-t2v-1.3b/vae/wan_2.1_vae.safetensors');
    expect(args[args.indexOf('--t5xxl') + 1]).toBe('/models/wan2.1-t2v-1.3b/clip/umt5xxl.gguf');
    expect(args[args.indexOf('--video-frames') + 1]).toBe('33');
    expect(args[args.indexOf('--flow-shift') + 1]).toBe('3');
  });

  it('does not emit -M for an image bundle even if video params are somehow present', () => {
    const args = buildArgs({
      params: { prompt: 'p', model: 'm.gguf', video_frames: 33 },
      bundle: fullModel,
      outputPath: '/x.png',
    });
    expect(args).not.toContain('-M');
    // video_frames is still forwarded (bundle.mode alone gates -M, not the flag) —
    // sd-cli itself would reject it outside vid_gen mode; that's an operator error,
    // not something buildArgs needs to police.
    expect(args).toContain('--video-frames');
  });

  it('wires clip_vision for a Wan I2V bundle via the existing -i (init image) flag', () => {
    const args = buildArgs({
      params: { prompt: 'animate this', model: 'wan2.1-i2v-14b' },
      bundle: wanI2vBundle,
      outputPath: '/out/x.webm',
      images: { init: '/in/start.png' },
    });
    expect(args[args.indexOf('--clip_vision') + 1]).toBe(
      '/models/wan2.1-i2v-14b/clip/clip_vision_h.safetensors',
    );
    expect(args[args.indexOf('-i') + 1]).toBe('/in/start.png');
  });

  it('passes prompt as a discrete arg (no shell injection surface)', () => {
    const args = buildArgs({
      params: { prompt: 'a cat; rm -rf /', model: 'm.gguf' },
      bundle: fullModel,
      outputPath: '/x.png',
    });
    const i = args.indexOf('-p');
    expect(args[i + 1]).toBe('a cat; rm -rf /');
  });
});

describe('parseProgress', () => {
  it('extracts step/total from a progress bar line', () => {
    const p = parseProgress('  |====>      | 7/20 - 0.12s/it');
    expect(p).toEqual({ step: 7, total: 20, progress: 7 / 20 });
  });

  it('ignores non-progress lines', () => {
    expect(parseProgress('loading model weights')).toBeNull();
    expect(parseProgress('')).toBeNull();
  });
});
