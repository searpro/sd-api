import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { makeTestConfig } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(await makeTestConfig());
});

afterAll(async () => {
  await app.close();
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
