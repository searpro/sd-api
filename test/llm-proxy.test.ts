import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { makeTestConfig } from './helpers.js';

let app: FastifyInstance;
let baseUrl: string;

async function waitFor(pred: () => Promise<boolean> | boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const config = await makeTestConfig();
  app = await buildServer(config);
  await app.llm.start();
  // A real listening socket is required here (not app.inject()): the
  // client-disconnect test needs a genuine TCP connection to abort, and
  // streaming responses need real backpressure/piping, neither of which
  // app.inject() models.
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await app.llm.stop();
  await app.close();
});

describe('LLM proxy — non-streaming', () => {
  it('relays a non-streaming chat completion', async () => {
    const res = await fetch(`${baseUrl}/v1/llm/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fake-model', messages: [{ role: 'user', content: 'hi' }], stream: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('Hello from fake llama');
  });

  it('proxies GET /v1/llm/models to the OpenAI-shape listing', async () => {
    const res = await fetch(`${baseUrl}/v1/llm/models`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('list');
    expect(body.data[0].id).toBe('fake-model');
  });

  it('rejects a missing model/messages with 400 before touching the upstream', async () => {
    const before = await (await fetch(`${app.llm.baseUrl}/__debug`)).json();
    const res = await fetch(`${baseUrl}/v1/llm/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fake-model' }), // missing `messages`
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const after = await (await fetch(`${app.llm.baseUrl}/__debug`)).json();
    // +1 for this very `after` /__debug hit — the rejected POST itself must
    // not have reached the upstream at all.
    expect(after.requestCount).toBe(before.requestCount + 1);
  });

  it('forwards unknown/extra fields via passthrough (e.g. tool-call params)', async () => {
    const res = await fetch(`${baseUrl}/v1/llm/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fake-model',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    });
    expect(res.status).toBe(200); // fixture ignores extra fields but must not reject them
  });
});

describe('LLM proxy — streaming', () => {
  it('relays SSE chunks and the terminal [DONE]', async () => {
    const res = await fetch(`${baseUrl}/v1/llm/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fake-model', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    let sawDone = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        if (line === '[DONE]') {
          sawDone = true;
          continue;
        }
        const chunk = JSON.parse(line);
        full += chunk.choices[0].delta.content;
      }
    }
    expect(full).toBe('Hello from fake llama');
    expect(sawDone).toBe(true);
  });

  it('aborts the upstream request when the client disconnects mid-stream', async () => {
    const before = await (await fetch(`${app.llm.baseUrl}/__debug`)).json();
    const controller = new AbortController();
    const resPromise = fetch(`${baseUrl}/v1/llm/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fake-model', messages: [{ role: 'user', content: 'hi' }], stream: true }),
      signal: controller.signal,
    });
    const res = await resPromise;
    // Read one chunk to be sure the stream is actually flowing, then bail.
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();

    await waitFor(async () => {
      const stats = await (await fetch(`${app.llm.baseUrl}/__debug`)).json();
      return stats.abortedStreams > before.abortedStreams;
    });
  });
});
