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

// A minimal (silent, 1-sample) WAV file — same fixture bytes as
// test/fixtures/fake-audio-server.mjs, just enough to be a valid file.
const WAV = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
  0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00,
  0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
]);

function multipart(boundary: string, filename: string, content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

describe('audio voice references', () => {
  it('uploads a reference WAV, lists it, fetches it, then deletes it', async () => {
    const boundary = '----sdapitest-voiceref';
    const up = await app.inject({
      method: 'POST',
      url: '/v1/audio-voice-refs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, 'my-voice.wav', WAV),
    });
    expect(up.statusCode).toBe(201);
    const uploaded = up.json().voiceRefs[0];
    expect(uploaded.name).toMatch(/\.wav$/);
    expect(uploaded.path).toMatch(/\.wav$/);
    expect(uploaded.size).toBe(WAV.length);

    const list = await app.inject({ method: 'GET', url: '/v1/audio-voice-refs' });
    expect(list.statusCode).toBe(200);
    expect(list.json().voiceRefs.map((v: { name: string }) => v.name)).toContain(uploaded.name);

    const get = await app.inject({ method: 'GET', url: `/v1/audio-voice-refs/${uploaded.name}` });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('audio/wav');
    expect(get.rawPayload.length).toBe(WAV.length);

    const del = await app.inject({ method: 'DELETE', url: `/v1/audio-voice-refs/${uploaded.name}` });
    expect(del.statusCode).toBe(200);

    const getAfter = await app.inject({ method: 'GET', url: `/v1/audio-voice-refs/${uploaded.name}` });
    expect(getAfter.statusCode).toBe(404);
    expect(getAfter.json().error.code).toBe('AUDIO_VOICE_REF_NOT_FOUND');
  });

  it('rejects a non-wav upload', async () => {
    const boundary = '----sdapitest-voiceref2';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audio-voice-refs',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart(boundary, 'evil.mp3', Buffer.from('nope')),
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s deleting an unknown voice ref', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/audio-voice-refs/does-not-exist.wav' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('AUDIO_VOICE_REF_NOT_FOUND');
  });
});
