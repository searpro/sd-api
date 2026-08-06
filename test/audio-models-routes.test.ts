import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { makeTestConfig } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer(await makeTestConfig());
});

afterAll(async () => {
  // Writing a valid manifest below now triggers a real audiocpp_server
  // restart (see routes/audio-models.ts) — stop it before closing so the
  // spawned fake-audio-server child doesn't leak past the test run.
  await app.audio.stop();
  await app.close();
});

describe('audio-models (bundles)', () => {
  it('lists installed audio models (empty initially)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/audio-models' });
    expect(res.statusCode).toBe(200);
    expect(res.json().models).toEqual([]);
  });

  it('creates an empty bundle, then deletes it', async () => {
    const create = await app.inject({ method: 'POST', url: '/v1/audio-models', payload: { model: 'audiodlmodel' } });
    expect(create.statusCode).toBe(201);
    expect(create.json().ready).toBe(false);

    const get = await app.inject({ method: 'GET', url: '/v1/audio-models/audiodlmodel' });
    expect(get.statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: '/v1/audio-models/audiodlmodel' });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: '/v1/audio-models/audiodlmodel' });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects a path-traversal model name', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/audio-models/..%2F..%2Fetc' });
    expect(res.statusCode).toBe(400);
  });

  it('writes and reads back a valid model.json sidecar', async () => {
    await app.inject({ method: 'POST', url: '/v1/audio-models', payload: { model: 'manual-audio' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/audio-models/manual-audio/manifest',
      payload: { name: 'My Manual Model', family: 'pocket_tts', task: 'tts' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('My Manual Model');
    expect(res.json().family).toBe('pocket_tts');
  });

  it('rejects a manifest missing family/task before it ever reaches the manager', async () => {
    await app.inject({ method: 'POST', url: '/v1/audio-models', payload: { model: 'incomplete-audio' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/audio-models/incomplete-audio/manifest',
      payload: { name: 'No family or task' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('registers a voice preset via read-merge-write without clobbering the rest of the manifest', async () => {
    await app.inject({ method: 'POST', url: '/v1/audio-models', payload: { model: 'clone-model' } });
    await app.inject({
      method: 'PUT',
      url: '/v1/audio-models/clone-model/manifest',
      payload: { name: 'Clone Model', family: 'chatterbox', task: 'clon' },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/audio-models/clone-model/voice-presets',
      payload: { name: 'alice', voice_ref: '/data/alice.wav', reference_text: 'hello' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().voicePresets).toEqual(['alice']);
    expect(first.json().defaultVoicePreset).toBe('alice'); // first preset auto-becomes default

    // A second preset merges in alongside the first rather than replacing it,
    // and (without makeDefault) doesn't disturb the existing default.
    const second = await app.inject({
      method: 'POST',
      url: '/v1/audio-models/clone-model/voice-presets',
      payload: { name: 'bob', voice_ref: '/data/bob.wav' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().voicePresets.sort()).toEqual(['alice', 'bob']);
    expect(second.json().defaultVoicePreset).toBe('alice');

    // family/task from the original manifest write survived both preset writes.
    expect(second.json().model.family).toBe('chatterbox');
    expect(second.json().model.task).toBe('clon');

    const third = await app.inject({
      method: 'POST',
      url: '/v1/audio-models/clone-model/voice-presets',
      payload: { name: 'bob', voice_ref: '/data/bob-v2.wav', makeDefault: true },
    });
    expect(third.json().defaultVoicePreset).toBe('bob');
  });

  it('rejects a voice preset on a model with no manifest yet', async () => {
    await app.inject({ method: 'POST', url: '/v1/audio-models', payload: { model: 'no-manifest-yet' } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audio-models/no-manifest-yet/voice-presets',
      payload: { name: 'alice', voice_ref: '/data/alice.wav' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_MODEL');
  });
});

describe('audio-catalog', () => {
  it('lists curated audio models', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/audio-catalog' });
    expect(res.statusCode).toBe(200);
    const { models } = res.json();
    expect(models.length).toBeGreaterThanOrEqual(4);
    expect(models.find((m: { id: string }) => m.id === 'pocket-tts')).toBeTruthy();
  });

  it('404s for an unknown catalog model', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/audio-catalog/nope/files' });
    expect(res.statusCode).toBe(404);
  });
});

describe('audio-downloads', () => {
  it('enqueues via /v1/audio-models/download and lists it under /v1/audio-downloads', async () => {
    const enqueue = await app.inject({
      method: 'POST',
      url: '/v1/audio-models/download',
      payload: { model: 'audio-dl-target', type: 'weights', url: 'https://example.invalid/model.gguf' },
    });
    expect(enqueue.statusCode).toBe(202);
    const task = enqueue.json();
    expect(task.model).toBe('audio-dl-target');
    expect(task.type).toBe('weights');

    const list = await app.inject({ method: 'GET', url: '/v1/audio-downloads?model=audio-dl-target' });
    expect(list.statusCode).toBe(200);
    expect(list.json().downloads.some((t: { id: string }) => t.id === task.id)).toBe(true);
  });

  it('rejects an unsupported download extension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audio-models/download',
      payload: { model: 'audio-dl-target', type: 'weights', url: 'https://example.invalid/model.zip' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('DOWNLOAD_FAILED');
  });

  it('rejects "model.json" as a download filename (reserved for the manifest)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audio-models/download',
      payload: {
        model: 'audio-dl-target',
        type: 'aux',
        url: 'https://example.invalid/tokenizer.json',
        name: 'model.json',
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('DOWNLOAD_FAILED');
  });
});
