import { describe, it, expect } from 'vitest';
import { assertSafeName, safeResolve } from '../src/util/paths.js';
import { AppError } from '../src/errors.js';

describe('path safety', () => {
  it('accepts plain filenames', () => {
    expect(assertSafeName('model.gguf')).toBe('model.gguf');
    expect(safeResolve('/base', 'model.gguf')).toBe('/base/model.gguf');
  });

  it('rejects traversal attempts', () => {
    for (const bad of ['../etc/passwd', 'a/b', 'a\\b', '..', '/abs/path', 'x/../../y']) {
      expect(() => assertSafeName(bad)).toThrow(AppError);
    }
  });

  it('rejects null bytes', () => {
    expect(() => assertSafeName('a\0b')).toThrow(AppError);
  });

  it('safeResolve blocks escaping the base dir', () => {
    expect(() => safeResolve('/base', '../secret')).toThrow(AppError);
  });
});
