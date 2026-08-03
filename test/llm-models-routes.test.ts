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

describe('llm-models (bundles)', () => {
  it('lists installed LLM models (empty initially)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/llm-models' });
    expect(res.statusCode).toBe(200);
    expect(res.json().models).toEqual([]);
  });

  it('creates an empty bundle, then deletes it', async () => {
    const create = await app.inject({ method: 'POST', url: '/v1/llm-models', payload: { model: 'llmdlmodel' } });
    expect(create.statusCode).toBe(201);
    expect(create.json().ready).toBe(false);

    const get = await app.inject({ method: 'GET', url: '/v1/llm-models/llmdlmodel' });
    expect(get.statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: '/v1/llm-models/llmdlmodel' });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: '/v1/llm-models/llmdlmodel' });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects a path-traversal model name', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/llm-models/..%2F..%2Fetc' });
    expect(res.statusCode).toBe(400);
  });

  it('writes and reads back the model.json sidecar', async () => {
    await app.inject({ method: 'POST', url: '/v1/llm-models', payload: { model: 'manual-llm' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/llm-models/manual-llm/manifest',
      payload: { name: 'My Manual LLM' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('My Manual LLM');
  });
});

describe('llm-catalog', () => {
  it('lists curated LLMs', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/llm-catalog' });
    expect(res.statusCode).toBe(200);
    const { models } = res.json();
    expect(models.length).toBeGreaterThan(10);
    expect(models.find((m: { id: string }) => m.id === 'qwen3-8b')).toBeTruthy();
  });

  it('404s for an unknown catalog model', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/llm-catalog/nope/files' });
    expect(res.statusCode).toBe(404);
  });
});

describe('llm-downloads', () => {
  it('enqueues via /v1/llm-models/download and lists it under /v1/llm-downloads', async () => {
    const enqueue = await app.inject({
      method: 'POST',
      url: '/v1/llm-models/download',
      payload: { model: 'llm-dl-target', type: 'gguf', url: 'https://example.invalid/model.gguf' },
    });
    expect(enqueue.statusCode).toBe(202);
    const task = enqueue.json();
    expect(task.model).toBe('llm-dl-target');
    expect(task.type).toBe('gguf');

    const list = await app.inject({ method: 'GET', url: '/v1/llm-downloads?model=llm-dl-target' });
    expect(list.statusCode).toBe(200);
    expect(list.json().downloads.some((t: { id: string }) => t.id === task.id)).toBe(true);
  });

  it('rejects a non-.gguf download filename', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/llm-models/download',
      payload: { model: 'llm-dl-target', type: 'gguf', url: 'https://example.invalid/model.safetensors' },
    });
    // DOWNLOAD_FAILED is a 502 throughout this codebase (see src/errors.ts) —
    // not a 400 — even though this particular failure is really a client-side
    // request problem (bad extension), matching the existing ModelManager convention.
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('DOWNLOAD_FAILED');
  });
});
