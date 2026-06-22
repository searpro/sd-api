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
      payload: { prompt: 'a cat', model: 'test.gguf', steps: 3 },
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
      payload: { model: 'test.gguf' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces the max image dimension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      payload: { prompt: 'x', model: 'test.gguf', width: 9999 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('models (Phase 3)', () => {
  it('lists the seeded checkpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(res.statusCode).toBe(200);
    const names = res.json().models.map((m: { name: string }) => m.name);
    expect(names).toContain('test.gguf');
  });

  it('blocks traversal on delete', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/models/..%2F..%2Fetc' });
    expect([400, 404]).toContain(res.statusCode);
    expect(res.json().error.code).toMatch(/INVALID_PATH|NOT_FOUND/);
  });
});

describe('jobs (Phase 4)', () => {
  it('runs a job to completion', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: { prompt: 'async cat', model: 'test.gguf', steps: 3 },
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
      payload: { prompt: 'serve me', model: 'test.gguf', steps: 2 },
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
