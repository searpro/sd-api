import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectClipRole, inspectBundle, resolveBundle } from '../src/models/bundle.js';

describe('detectClipRole', () => {
  it('maps known encoder filenames to roles', () => {
    expect(detectClipRole('clip_l.safetensors')).toBe('clip_l');
    expect(detectClipRole('clip_g.safetensors')).toBe('clip_g');
    expect(detectClipRole('t5xxl_fp16.safetensors')).toBe('t5xxl');
    expect(detectClipRole('Qwen3-4B-Q8_0.gguf')).toBe('llm');
    expect(detectClipRole('mistral-small3.2.gguf')).toBe('llm');
    expect(detectClipRole('clip_vision_g.safetensors')).toBe('clip_vision');
  });
  it('returns null for unrecognized names', () => {
    expect(detectClipRole('random-encoder.bin')).toBeNull();
  });
});

describe('bundle resolution', () => {
  let modelsDir: string;

  beforeAll(async () => {
    modelsDir = await mkdtemp(join(tmpdir(), 'bundle-test-'));
    // Split model: z-image (diffusion + vae + qwen llm)
    await mkdir(join(modelsDir, 'z-image', 'checkpoint'), { recursive: true });
    await mkdir(join(modelsDir, 'z-image', 'vae'), { recursive: true });
    await mkdir(join(modelsDir, 'z-image', 'clip'), { recursive: true });
    await writeFile(join(modelsDir, 'z-image', 'checkpoint', 'z_image_turbo-Q2_K.gguf'), 'x');
    await writeFile(join(modelsDir, 'z-image', 'vae', 'z_vae.safetensors'), 'x');
    await writeFile(join(modelsDir, 'z-image', 'clip', 'qwen3-4b.gguf'), 'x');
    // Full model with a manifest forcing "model" load
    await mkdir(join(modelsDir, 'sdxl', 'checkpoint'), { recursive: true });
    await writeFile(join(modelsDir, 'sdxl', 'checkpoint', 'sdxl.gguf'), 'x');
    // Single-file model
    await writeFile(join(modelsDir, 'flat.gguf'), 'x');
    // Video (Wan T2V) model: diffusion + vae + t5xxl, manifest declares mode:"video"
    await mkdir(join(modelsDir, 'wan-t2v', 'checkpoint'), { recursive: true });
    await mkdir(join(modelsDir, 'wan-t2v', 'vae'), { recursive: true });
    await mkdir(join(modelsDir, 'wan-t2v', 'clip'), { recursive: true });
    await writeFile(join(modelsDir, 'wan-t2v', 'checkpoint', 'wan2.1-t2v-1.3b.gguf'), 'x');
    await writeFile(join(modelsDir, 'wan-t2v', 'vae', 'wan_2.1_vae.safetensors'), 'x');
    await writeFile(join(modelsDir, 'wan-t2v', 'clip', 'umt5xxl.gguf'), 'x');
    await writeFile(
      join(modelsDir, 'wan-t2v', 'model.json'),
      JSON.stringify({
        name: 'Wan2.1 T2V 1.3B',
        mode: 'video',
        defaults: { video_frames: 33, flow_shift: 3 },
      }),
    );
  });

  it('resolves a split model with --diffusion-model + vae + llm', async () => {
    const b = await resolveBundle(modelsDir, 'z-image');
    expect(b.loadMode).toBe('diffusion-model');
    expect(b.checkpointPath).toContain(join('checkpoint', 'z_image_turbo-Q2_K.gguf'));
    expect(b.weights.vae).toContain(join('vae', 'z_vae.safetensors'));
    expect(b.weights.llm).toContain(join('clip', 'qwen3-4b.gguf'));
  });

  it('resolves a checkpoint-only bundle as a full model (-m)', async () => {
    const b = await resolveBundle(modelsDir, 'sdxl');
    expect(b.loadMode).toBe('model');
    expect(b.weights.vae).toBeUndefined();
  });

  it('resolves a single-file model', async () => {
    const b = await resolveBundle(modelsDir, 'flat.gguf');
    expect(b.loadMode).toBe('model');
    expect(b.checkpointPath).toContain('flat.gguf');
  });

  it('honors a manifest load override and defaults', async () => {
    await writeFile(
      join(modelsDir, 'z-image', 'model.json'),
      JSON.stringify({ name: 'Z-Image Turbo', load: 'diffusion-model', defaults: { steps: 8, cfg_scale: 1 } }),
    );
    const b = await resolveBundle(modelsDir, 'z-image');
    expect(b.displayName).toBe('Z-Image Turbo');
    expect(b.defaults.steps).toBe(8);
    expect(b.defaults.cfg_scale).toBe(1);
  });

  it('inspect reports readiness and components', async () => {
    const info = await inspectBundle(modelsDir, 'z-image');
    expect(info.ready).toBe(true);
    expect(info.checkpoint?.name).toBe('z_image_turbo-Q2_K.gguf');
    expect(info.clip.some((c) => c.role === 'llm')).toBe(true);
  });

  it('throws MODEL_NOT_FOUND for a missing bundle', async () => {
    await expect(resolveBundle(modelsDir, 'ghost')).rejects.toThrow();
  });

  it('lists loras and resolves a lora-model-dir', async () => {
    await mkdir(join(modelsDir, 'z-image', 'lora'), { recursive: true });
    await writeFile(join(modelsDir, 'z-image', 'lora', 'lineart.safetensors'), 'x');

    const info = await inspectBundle(modelsDir, 'z-image');
    const lora = info.loras.find((l) => l.name === 'lineart.safetensors');
    expect(lora?.ref).toBe('lineart'); // reference name = filename without extension

    const b = await resolveBundle(modelsDir, 'z-image');
    expect(b.loraDir).toContain(join('z-image', 'lora'));
  });

  it('has no lora-model-dir when the bundle has no loras', async () => {
    const b = await resolveBundle(modelsDir, 'sdxl');
    expect(b.loraDir).toBeUndefined();
  });

  it('defaults mode to "image" for a bundle with no manifest mode', async () => {
    const b = await resolveBundle(modelsDir, 'sdxl');
    expect(b.mode).toBe('image');
    const info = await inspectBundle(modelsDir, 'sdxl');
    expect(info.mode).toBe('image');
  });

  it('resolves a video (Wan) bundle: mode + vae + t5xxl + video defaults', async () => {
    const b = await resolveBundle(modelsDir, 'wan-t2v');
    expect(b.mode).toBe('video');
    expect(b.loadMode).toBe('diffusion-model');
    expect(b.checkpointPath).toContain(join('checkpoint', 'wan2.1-t2v-1.3b.gguf'));
    expect(b.weights.vae).toContain(join('vae', 'wan_2.1_vae.safetensors'));
    expect(b.weights.t5xxl).toContain(join('clip', 'umt5xxl.gguf'));
    expect(b.defaults.video_frames).toBe(33);
    expect(b.defaults.flow_shift).toBe(3);

    const info = await inspectBundle(modelsDir, 'wan-t2v');
    expect(info.mode).toBe('video');
    expect(info.ready).toBe(true);
  });
});
