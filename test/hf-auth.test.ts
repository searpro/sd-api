import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getHfToken,
  setHfToken,
  hfTokenSource,
  maskToken,
  isHuggingFaceUrl,
  hfAuthHeaders,
  hfWhoami,
  clearWhoamiCache,
  gatedHint,
} from '../src/util/hf-auth.js';

const ENV_KEYS = ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'];

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  setHfToken(null);
  clearWhoamiCache();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setHfToken(null);
  vi.unstubAllGlobals();
});

describe('token source', () => {
  it('reports none when unset', () => {
    expect(getHfToken()).toBeUndefined();
    expect(hfTokenSource()).toBe('none');
  });
  it('reads HF_TOKEN from env', () => {
    process.env.HF_TOKEN = 'hf_envtoken1234';
    expect(getHfToken()).toBe('hf_envtoken1234');
    expect(hfTokenSource()).toBe('env');
  });
  it('falls back to HUGGING_FACE_HUB_TOKEN', () => {
    process.env.HUGGING_FACE_HUB_TOKEN = 'hf_alt';
    expect(hfTokenSource()).toBe('env');
  });
  it('override takes precedence over env', () => {
    process.env.HF_TOKEN = 'hf_env';
    setHfToken('hf_override');
    expect(getHfToken()).toBe('hf_override');
    expect(hfTokenSource()).toBe('override');
  });
});

describe('maskToken', () => {
  it('never reveals the full token', () => {
    const m = maskToken('hf_abcdefghijklmnop');
    expect(m).toContain('…');
    expect(m).not.toContain('efghijkl');
    expect(m.endsWith('mnop')).toBe(true);
  });
});

describe('hfAuthHeaders', () => {
  it('is empty with no token', () => {
    expect(hfAuthHeaders()).toEqual({});
  });
  it('attaches Bearer for API calls and HF urls only', () => {
    process.env.HF_TOKEN = 'hf_x';
    expect(hfAuthHeaders()).toEqual({ Authorization: 'Bearer hf_x' });
    expect(hfAuthHeaders('https://huggingface.co/foo/resolve/main/x')).toEqual({ Authorization: 'Bearer hf_x' });
    // Never leak the token to a non-HF host (e.g. a CDN redirect target).
    expect(hfAuthHeaders('https://cdn-lfs.example.com/x')).toEqual({});
  });
  it('isHuggingFaceUrl', () => {
    expect(isHuggingFaceUrl('https://huggingface.co/a/b')).toBe(true);
    expect(isHuggingFaceUrl('https://evil.com')).toBe(false);
    expect(isHuggingFaceUrl('not a url')).toBe(false);
  });
});

describe('hfWhoami', () => {
  it('returns null with no token (no fetch)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await hfWhoami()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('returns the user on success', async () => {
    process.env.HF_TOKEN = 'hf_good';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ name: 'alice', fullname: 'Alice A' }) })));
    expect(await hfWhoami()).toEqual({ name: 'alice', fullname: 'Alice A' });
  });
  it('throws on an invalid token', async () => {
    process.env.HF_TOKEN = 'hf_bad';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })));
    await expect(hfWhoami()).rejects.toThrow(/invalid or expired/i);
  });
});

describe('gatedHint', () => {
  it('mentions HF_TOKEN when unauthenticated', () => {
    expect(gatedHint(401)).toMatch(/HF_TOKEN/);
  });
  it('mentions the license for 403 and includes the repo url', () => {
    const msg = gatedHint(403, 'https://huggingface.co/owner/repo');
    expect(msg).toMatch(/gated/i);
    expect(msg).toContain('https://huggingface.co/owner/repo');
  });
});
