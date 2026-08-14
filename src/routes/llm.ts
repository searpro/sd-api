import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { errors } from '../errors.js';
import { upstreamFetch } from '../util/upstream-fetch.js';

/**
 * OpenAI-compatible reverse proxy to a locally-supervised `llama-server`
 * (see src/llm/server-manager.ts). Requests are forwarded byte-for-byte —
 * both streaming (SSE) and non-streaming responses share one code path,
 * since we never buffer or reshape the upstream body, only relay it.
 *
 * `.passthrough()` on every body schema is required: fastify-type-provider-zod
 * replaces `request.body` with the *parsed* value, and a plain zod object
 * strips unknown keys by default — without passthrough we'd silently drop
 * fields like `tools`, `response_format`, `chat_template_kwargs`, etc.
 */

// Only validate what we need for a clear error; everything else rides along.
const chatCompletionsSchema = z
  .object({ model: z.string().min(1), messages: z.array(z.record(z.unknown())).min(1) })
  .passthrough();
const completionsSchema = z
  .object({ model: z.string().min(1), prompt: z.unknown() })
  .passthrough();
const embeddingsSchema = z.object({ model: z.string().min(1), input: z.unknown() }).passthrough();

export async function llmRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Forward a request to llama-server and relay its response (status,
   * content-type, body) verbatim to the client, aborting the upstream call if
   * the client disconnects. No response validation/reshaping — passthrough
   * for maximum client compatibility.
   */
  async function proxyToLlama(
    req: FastifyRequest,
    reply: FastifyReply,
    upstreamPath: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<void> {
    const controller = new AbortController();
    // `req.raw` ('close') fires as soon as the request body is fully read —
    // not when the client disconnects (a well-known Node IncomingMessage
    // quirk) — which would abort the upstream fetch immediately on every
    // request. `reply.raw` ('close') correctly reflects the response socket
    // closing prematurely.
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    let upstream: Response;
    try {
      upstream = await upstreamFetch(
        `${app.llm.baseUrl}${upstreamPath}`,
        {
          method,
          headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        },
        app.config.llmRequestTimeoutMs,
      );
    } catch (err) {
      if (controller.signal.aborted) return; // client already gone
      throw errors.llmServerUnavailable(
        `Could not reach llama-server at ${app.llm.baseUrl}: ${(err as Error).message}`,
      );
    }

    if (!upstream.body) {
      reply.raw.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      reply.raw.end();
      return;
    }

    reply.raw.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    try {
      await pipeline(
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
        reply.raw,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        req.log.warn({ err: (err as Error).message }, 'llama-server upstream stream error');
      }
      // Response is already committed (headers sent) — nothing more we can do
      // but ensure the socket is closed.
      reply.raw.destroy();
    }
  }

  // Multimodal messages carry base64-embedded images/audio/video, which can
  // easily exceed the global 1 MiB body limit (see src/server.ts) — override
  // it for the two request shapes that can include such content parts.
  const MULTIMODAL_BODY_LIMIT = 32 * 1024 * 1024; // 32 MiB

  app.post(
    '/v1/llm/chat/completions',
    {
      bodyLimit: MULTIMODAL_BODY_LIMIT,
      schema: {
        tags: ['llm'],
        summary: 'OpenAI-compatible chat completions (proxied to llama-server)',
        description:
          'Supports streaming (stream:true, SSE) and multimodal content parts ' +
          '(image_url/input_audio/input_video) exactly as documented by llama.cpp — ' +
          'the request body is forwarded to llama-server unmodified.',
        body: chatCompletionsSchema,
      },
    },
    async (req, reply) => proxyToLlama(req, reply, '/v1/chat/completions', 'POST', req.body),
  );

  app.post(
    '/v1/llm/completions',
    {
      bodyLimit: MULTIMODAL_BODY_LIMIT,
      schema: {
        tags: ['llm'],
        summary: 'OpenAI-compatible legacy completions (proxied to llama-server)',
        body: completionsSchema,
      },
    },
    async (req, reply) => proxyToLlama(req, reply, '/v1/completions', 'POST', req.body),
  );

  app.post(
    '/v1/llm/embeddings',
    {
      schema: {
        tags: ['llm'],
        summary: 'OpenAI-compatible embeddings (proxied to llama-server)',
        body: embeddingsSchema,
      },
    },
    async (req, reply) => proxyToLlama(req, reply, '/v1/embeddings', 'POST', req.body),
  );

  app.get(
    '/v1/llm/models',
    {
      schema: {
        tags: ['llm'],
        summary: 'OpenAI-compatible model listing (proxied to llama-server)',
        description:
          'This is the strict OpenAI-shape endpoint an SDK client calls when baseURL is ' +
          'set to .../v1/llm — it is not our own model/bundle management API.',
      },
    },
    async (req, reply) => proxyToLlama(req, reply, '/v1/models', 'GET'),
  );
}
