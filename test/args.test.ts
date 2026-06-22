import { describe, it, expect } from 'vitest';
import { buildArgs } from '../src/sd/args.js';
import { parseProgress } from '../src/sd/progress.js';

describe('buildArgs', () => {
  it('maps core params to CLI flags', () => {
    const args = buildArgs({
      params: { prompt: 'a cat', model: 'm.gguf' },
      modelPath: '/m/m.gguf',
      outputPath: '/out/x.png',
    });
    expect(args).toEqual(['-m', '/m/m.gguf', '-o', '/out/x.png', '-p', 'a cat']);
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
      modelPath: '/m.gguf',
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

  it('passes prompt as a discrete arg (no shell injection surface)', () => {
    const args = buildArgs({
      params: { prompt: 'a cat; rm -rf /', model: 'm.gguf' },
      modelPath: '/m.gguf',
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
