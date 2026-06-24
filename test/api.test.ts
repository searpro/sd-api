import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { makeTestConfig } from './helpers.js';
import { setHfToken } from '../src/util/hf-auth.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(await makeTestConfig());
});

afterAll(async () => {
  await app.close();
});

describe('huggingface auth', () => {
  afterAll(() => setHfToken(null));

  it('reports not configured with no token', async () => {
    const prev = { a: process.env.HF_TOKEN, b: process.env.HUGGING_FACE_HUB_TOKEN };
    delete process.env.HF_TOKEN;
    delete process.env.HUGGING_FACE_HUB_TOKEN;
    setHfToken(null);
    const res = await app.inject({ method: 'GET', url: '/v1/auth/hf' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, source: 'none' });
    if (prev.a !== undefined) process.env.HF_TOKEN = prev.a;
    if (prev.b !== undefined) process.env.HUGGING_FACE_HUB_TOKEN = prev.b;
  });

  it('reports configured (masked) when a token is set, without leaking it', async () => {
    setHfToken('hf_secrettoken1234');
    const res = await app.inject({ method: 'GET', url: '/v1/auth/hf' });
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.masked).toContain('…');
    expect(JSON.stringify(body)).not.toContain('secrettoken');
    setHfToken(null);
  });

  it('verify returns ok:false when no token configured', async () => {
    setHfToken(null);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/hf/verify' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, configured: false });
  });
});

describe('health', () => {
  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('POST /v1/generate (Phase 1+2)', () => {
  it('generates an image with the fake binary', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { prompt: 'a cat', model: 'test', steps: 3 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.image_url).toMatch(/^\/v1\/outputs\//);
    expect(body.metadata.prompt).toBe('a cat');
    expect(body.metadata.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('rejects a missing model with MODEL_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { prompt: 'x', model: 'nope.gguf' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('MODEL_NOT_FOUND');
  });

  it('rejects invalid body with VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { model: 'test' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces the max image dimension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { prompt: 'x', model: 'test', width: 9999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('models (bundles)', () => {
  it('lists the seeded bundle with auto-wired components', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(res.statusCode).toBe(200);
    const models = res.json().models;
    const test = models.find((m: { id: string }) => m.id === 'test');
    expect(test).toBeTruthy();
    expect(test.loadMode).toBe('diffusion-model'); // has vae + clip
    expect(test.checkpoint.name).toBe('diffusion.gguf');
    expect(test.vae.name).toBe('vae.safetensors');
    // The qwen file is auto-detected as the llm text encoder.
    expect(test.clip.find((c: { role?: string }) => c.role === 'llm')).toBeTruthy();
    expect(test.ready).toBe(true);

    const full = models.find((m: { id: string }) => m.id === 'full.gguf');
    expect(full.loadMode).toBe('model');
  });

  it('creates an empty bundle', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: { model: 'newmodel' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().id).toBe('newmodel');
    expect(create.json().ready).toBe(false);
  });

  it('enqueues a background download and lists it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/models/download',
      payload: { model: 'dlmodel', type: 'checkpoint', url: 'http://127.0.0.1:1/model.gguf' },
    });
    expect(res.statusCode).toBe(202);
    const task = res.json();
    expect(task.id).toBeTruthy();
    expect(task.status).toMatch(/queued|downloading|failed/);

    const list = await app.inject({ method: 'GET', url: '/v1/downloads?model=dlmodel' });
    expect(list.statusCode).toBe(200);
    expect(list.json().downloads.some((d: { id: string }) => d.id === task.id)).toBe(true);
  });

  it('blocks traversal on delete', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/models/..%2F..%2Fetc' });
    expect([400, 404]).toContain(res.statusCode);
    expect(res.json().error.code).toMatch(/INVALID_PATH|NOT_FOUND/);
  });

  it('deletes a bundle', async () => {
    await app.inject({ method: 'POST', url: '/v1/models', payload: { model: 'tmpdel' } });
    const del = await app.inject({ method: 'DELETE', url: '/v1/models/tmpdel' });
    expect(del.statusCode).toBe(200);
    const got = await app.inject({ method: 'GET', url: '/v1/models/tmpdel' });
    expect(got.statusCode).toBe(404);
  });
});

describe('catalog', () => {
  it('lists curated models (no network)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/catalog' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().models.map((m: { id: string }) => m.id);
    expect(ids).toContain('z-image-turbo');
    expect(ids).toContain('flux1-dev');
  });

  it('404s for an unknown catalog model', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/catalog/nope/files' });
    expect(res.statusCode).toBe(404);
  });
});

describe('manifest', () => {
  it('writes a bundle manifest and reflects it', async () => {
    await app.inject({ method: 'POST', url: '/v1/models', payload: { model: 'manual' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/models/manual/manifest',
      payload: { name: 'Manual Model', load: 'diffusion-model', defaults: { steps: 8 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Manual Model');
    expect(res.json().loadMode).toBe('diffusion-model');
  });
});

describe('jobs (Phase 4)', () => {
  it('runs a job to completion', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: { prompt: 'async cat', model: 'test', steps: 3 },
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();
    expect(id).toBeTruthy();

    let status = 'queued';
    for (let i = 0; i < 50 && status !== 'completed' && status !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const s = await app.inject({ method: 'GET', url: `/v1/jobs/${id}` });
      status = s.json().status;
    }
    expect(status).toBe('completed');

    const final = await app.inject({ method: 'GET', url: `/v1/jobs/${id}` });
    expect(final.json().result.image_url).toMatch(/^\/v1\/outputs\//);
  });

  it('returns 404 for unknown job', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/jobs/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('JOB_NOT_FOUND');
  });
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

function multipart(boundary: string, filename: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

describe('inputs + image editing', () => {
  it('uploads an input image and uses it as a reference for generation', async () => {
    const boundary = '----sdapitest';
    const up = await app.inject({
      method: 'POST',
      url: '/v1/inputs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, 'ref.png', PNG),
    });
    expect(up.statusCode).toBe(201);
    const name = up.json().inputs[0].name;
    expect(name).toMatch(/\.png$/);

    // The uploaded image is retrievable.
    const get = await app.inject({ method: 'GET', url: `/v1/inputs/${name}` });
    expect(get.statusCode).toBe(200);

    // Generate using it as a reference image (edit).
    const gen = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { prompt: 'edit it', model: 'test', ref_images: [name], steps: 2 },
    });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().image_url).toMatch(/^\/v1\/outputs\//);
  });

  it('rejects a missing reference image with INPUT_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { prompt: 'x', model: 'test', ref_images: ['nope.png'] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('INPUT_NOT_FOUND');
  });

  it('rejects a non-image upload', async () => {
    const boundary = '----sdapitest2';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/inputs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, 'evil.txt', Buffer.from('nope')),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('outputs (Phase 6)', () => {
  it('serves a generated image as base64', async () => {
    const gen = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { prompt: 'serve me', model: 'test', steps: 2 },
    });
    const name = gen.json().image_url.split('/').pop();
    const res = await app.inject({ method: 'GET', url: `/v1/outputs/${name}?format=base64` });
    expect(res.statusCode).toBe(200);
    expect(res.json().base64.length).toBeGreaterThan(0);
  });

  it('404s for a missing output', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/outputs/missing.png' });
    expect(res.statusCode).toBe(404);
  });
});

describe('web UI', () => {
  it('serves the frontend at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('sd-api');
  });
});

describe('docs (Phase 8)', () => {
  it('serves the OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe('3.1.0');
  });
});
