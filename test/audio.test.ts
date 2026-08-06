import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { makeTestConfig } from './helpers.js';

let app: FastifyInstance;
let baseUrl: string;
let config: Config;

beforeAll(async () => {
  config = await makeTestConfig();
  // A registered model so /v1/audio/models and /v1/audio/voices have
  // something real to reflect back through the fake server.
  await mkdir(join(config.audioModelsDir, 'pocket-tts'), { recursive: true });
  await writeFile(
    join(config.audioModelsDir, 'pocket-tts', 'model.json'),
    JSON.stringify({ family: 'pocket_tts', task: 'tts' }),
  );

  app = await buildServer(config);
  await app.audio.start();
  // A real listening socket (not app.inject()) — the multipart streaming
  // test needs a genuine TCP connection to carry a real FormData body.
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await app.audio.stop();
  await app.close();
});

describe('Audio proxy — speech', () => {
  it('returns a WAV response for a plain speech request', async () => {
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'pocket-tts', input: 'hello there' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    // RIFF magic bytes — proves this is the fixture's real WAV, not empty/garbled.
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
  });

  it('returns base64 JSON when response_format is "json"', async () => {
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'pocket-tts', input: 'hello', response_format: 'json' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe('pocket-tts');
    expect(typeof body.audio_base64).toBe('string');
  });

  it('rejects a missing model/input with 400 before touching the upstream', async () => {
    const before = await (await fetch(`${app.audio.baseUrl}/__debug`)).json();
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'pocket-tts' }), // missing `input`
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const after = await (await fetch(`${app.audio.baseUrl}/__debug`)).json();
    // +1 for this very `after` /__debug hit — the rejected POST must not
    // have reached the upstream at all.
    expect(after.requestCount).toBe(before.requestCount + 1);
  });
});

describe('Audio proxy — transcriptions', () => {
  it('proxies a JSON transcription request', async () => {
    const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'pocket-tts', audio: '/data/sample.wav' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toContain('/data/sample.wav');
  });

  it('streams a multipart upload through unparsed (raw passthrough)', async () => {
    const form = new FormData();
    form.set('model', 'pocket-tts');
    form.set('language', 'en');
    form.set('file', new Blob([new Uint8Array(1000).fill(1)], { type: 'audio/wav' }), 'sample.wav');

    const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The fixture only counts raw bytes (it doesn't parse multipart either),
    // so this proves the whole multipart body — boundaries, headers, the
    // 1000-byte "file" field, and all — reached the upstream intact.
    expect(body.text).toMatch(/received \d+ multipart bytes/);
    const receivedBytes = Number(body.text.match(/received (\d+)/)[1]);
    expect(receivedBytes).toBeGreaterThan(1000);
  });
});

describe('Audio proxy — voices, models, tasks/run', () => {
  it('proxies GET /v1/audio/voices with the model query param', async () => {
    const res = await fetch(`${baseUrl}/v1/audio/voices?model=pocket-tts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe('pocket-tts');
    expect(body.voices).toContain('alba');
  });

  it('proxies GET /v1/audio/models to the OpenAI-shape listing', async () => {
    const res = await fetch(`${baseUrl}/v1/audio/models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('list');
    expect(body.data.map((m: { id: string }) => m.id)).toContain('pocket-tts');
  });

  it('proxies POST /v1/audio/tasks/run as a generic escape hatch', async () => {
    const res = await fetch(`${baseUrl}/v1/audio/tasks/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'pocket-tts', request: { text: 'hi', seed: 1 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('fake-task-result');
  });
});
