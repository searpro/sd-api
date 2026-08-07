import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseQuant, resolveUrl, listComponentFiles, clearHfCache } from '../src/catalog/hf.js';
import { CatalogManager } from '../src/catalog/manager.js';

const log = { info() {}, warn() {}, debug() {}, error() {} } as never;

afterEach(() => {
  vi.unstubAllGlobals();
  clearHfCache();
});

describe('parseQuant', () => {
  it('extracts gguf quant tokens', () => {
    expect(parseQuant('z_image_turbo-Q4_K.gguf')).toBe('Q4_K');
    expect(parseQuant('model-Q8_0.gguf')).toBe('Q8_0');
    expect(parseQuant('Qwen3-4B-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(parseQuant('thing-q2_k.gguf')).toBe('Q2_K');
  });
  it('extracts precision tokens', () => {
    expect(parseQuant('z_image_bf16.safetensors')).toBe('BF16');
    expect(parseQuant('t5xxl_fp16.safetensors')).toBe('FP16');
  });
  it('returns null when absent', () => {
    expect(parseQuant('ae.safetensors')).toBeNull();
    expect(parseQuant('clip_l.safetensors')).toBeNull();
  });
});

describe('resolveUrl', () => {
  it('builds a HF resolve URL', () => {
    expect(resolveUrl('owner/repo', 'split_files/diffusion_models/m.gguf')).toBe(
      'https://huggingface.co/owner/repo/resolve/main/split_files/diffusion_models/m.gguf?download=true',
    );
  });
});

function stubTree(entries: { path: string; size: number }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => entries.map((e) => ({ type: 'file', path: e.path, size: e.size })),
    })),
  );
}

describe('listComponentFiles', () => {
  it('filters by format/extension and parses quants', async () => {
    stubTree([
      { path: 'z_image_turbo-Q4_K.gguf', size: 100 },
      { path: 'z_image_turbo-Q8_0.gguf', size: 200 },
      { path: 'README.md', size: 1 },
    ]);
    const files = await listComponentFiles({ repo: 'leejet/Z-Image-Turbo-GGUF' }, 'gguf');
    expect(files.map((f) => f.quant).sort()).toEqual(['Q4_K', 'Q8_0']);
    expect(files[0].url).toContain('/resolve/main/');
  });

  it('honors the match filter to disambiguate', async () => {
    stubTree([
      { path: 'flux1-dev.safetensors', size: 100 },
      { path: 'ae.safetensors', size: 50 },
    ]);
    const vae = await listComponentFiles(
      { repo: 'black-forest-labs/FLUX.1-dev', match: 'ae' },
      'safetensors',
    );
    expect(vae).toHaveLength(1);
    expect(vae[0].filename).toBe('ae.safetensors');
  });
});

describe('CatalogManager', () => {
  it('lists curated models with component formats', () => {
    const cat = new CatalogManager(log);
    const models = cat.list();
    const z = models.find((m) => m.id === 'z-image-turbo');
    expect(z).toBeTruthy();
    expect(z!.loadMode).toBe('diffusion-model');
    const ckpt = z!.components.find((c) => c.role === 'checkpoint');
    expect(ckpt!.formats).toEqual(expect.arrayContaining(['gguf', 'safetensors']));
    const llm = z!.components.find((c) => c.role === 'llm');
    expect(llm!.bundleType).toBe('clip');
  });

  it('defaults mode to "image" and surfaces "video" for Wan entries (regression: list() previously dropped this field)', () => {
    const cat = new CatalogManager(log);
    const models = cat.list();
    expect(models.find((m) => m.id === 'z-image-turbo')!.mode).toBe('image');
    expect(models.find((m) => m.id === 'wan2.1-t2v-1.3b')!.mode).toBe('video');
    expect(models.find((m) => m.id === 'wan2.1-i2v-14b-480p')!.mode).toBe('video');
  });

  it('resolves component files via the (stubbed) HF API', async () => {
    stubTree([{ path: 'z_image_turbo-Q3_K.gguf', size: 100 }]);
    const cat = new CatalogManager(log);
    const comps = await cat.files('z-image-turbo');
    const ckpt = comps.find((c) => c.role === 'checkpoint');
    expect(ckpt!.files.gguf?.[0].quant).toBe('Q3_K');
  });
});
