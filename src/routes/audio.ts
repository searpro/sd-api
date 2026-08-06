import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { errors } from '../errors.js';

/**
 * OpenAI-audio-shaped reverse proxy to a locally-supervised `audiocpp_server`
 * (see src/audio/server-manager.ts). Structurally mirrors src/routes/llm.ts:
 * requests are forwarded byte-for-byte, so one code path handles JSON, SSE,
 * and binary (audio/wav) responses alike — we never buffer or reshape the
 * upstream body, only relay it.
 *
 * `.passthrough()` on JSON body schemas is required: fastify-type-provider-zod
 * replaces `request.body` with the *parsed* value, and a plain zod object
 * strips unknown keys by default — without passthrough we'd silently drop
 * fields like `voice_ref`, `stream_format`, `options`, etc.
 */

const speechSchema = z.object({ model: z.string().min(1), input: z.string().min(1) }).passthrough();
const transcriptionJsonSchema = z
  .object({ model: z.string().min(1), audio: z.string().min(1) })
  .passthrough();
const tasksRunSchema = z.object({ model: z.string().min(1), request: z.record(z.unknown()) }).passthrough();

export async function audioRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Forward a JSON request to audiocpp_server and relay its response
   * (status, content-type, body) verbatim to the client, aborting the
   * upstream call if the client disconnects. No response validation/
   * reshaping — passthrough for maximum client compatibility.
   */
  async function proxyToAudio(
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
      upstream = await fetch(`${app.audio.baseUrl}${upstreamPath}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return; // client already gone
      throw errors.audioServerUnavailable(
        `Could not reach audiocpp_server at ${app.audio.baseUrl}: ${(err as Error).message}`,
      );
    }

    await relay(req, reply, upstream, controller);
  }

  /**
   * Same as proxyToAudio, but forwards the raw incoming request body
   * unparsed (used for multipart/form-data transcription uploads — see the
   * addContentTypeParser registration below) instead of re-encoding JSON.
   */
  async function proxyToAudioRaw(
    req: FastifyRequest,
    reply: FastifyReply,
    upstreamPath: string,
    contentType: string,
  ): Promise<void> {
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    let upstream: Response;
    try {
      upstream = await fetch(`${app.audio.baseUrl}${upstreamPath}`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: Readable.toWeb(req.raw) as ReadableStream,
        duplex: 'half',
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      throw errors.audioServerUnavailable(
        `Could not reach audiocpp_server at ${app.audio.baseUrl}: ${(err as Error).message}`,
      );
    }

    await relay(req, reply, upstream, controller);
  }

  async function relay(
    req: FastifyRequest,
    reply: FastifyReply,
    upstream: Response,
    controller: AbortController,
  ): Promise<void> {
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
        req.log.warn({ err: (err as Error).message }, 'audiocpp_server upstream stream error');
      }
      // Response is already committed (headers sent) — nothing more we can do
      // but ensure the socket is closed.
      reply.raw.destroy();
    }
  }

  // Replace the @fastify/multipart parser (registered globally in server.ts)
  // with a no-op for just this plugin's routes, so a multipart transcription
  // upload reaches the handler as an unconsumed raw stream instead of being
  // parsed into fields/files we'd have to re-encode. Content-type parsers
  // are cloned (not shared) per encapsulated plugin context, so this swap
  // only affects audioRoutes — /v1/inputs' multipart uploads are unaffected
  // — but the clone already contains the inherited global parser, so it must
  // be removed here first or addContentTypeParser rejects the duplicate key.
  app.removeContentTypeParser('multipart/form-data');
  app.addContentTypeParser('multipart/form-data', (_req, _payload, done) => done(null, undefined));

  app.post(
    '/v1/audio/speech',
    {
      schema: {
        tags: ['audio'],
        summary: 'OpenAI-style text-to-speech (proxied to audiocpp_server)',
        description:
          'Returns audio/wav by default; set response_format:"json" for base64 WAV, or ' +
          'stream_format:"sse"/"audio" for a streaming-capable model. The request body is ' +
          'forwarded to audiocpp_server unmodified.',
        body: speechSchema,
      },
    },
    async (req, reply) => proxyToAudio(req, reply, '/v1/audio/speech', 'POST', req.body),
  );

  app.post(
    '/v1/audio/transcriptions',
    {
      schema: {
        tags: ['audio'],
        summary: 'OpenAI-style transcription (proxied to audiocpp_server)',
        description:
          'Accepts a JSON body with a server-local audio path ({"model","audio"}), or a ' +
          'multipart/form-data upload (model, language?, file) matching the OpenAI Whisper ' +
          'convention. Routed by Content-Type; multipart uploads are streamed through unparsed.',
      },
    },
    async (req, reply) => {
      const contentType = req.headers['content-type'] ?? '';
      if (contentType.toLowerCase().startsWith('multipart/form-data')) {
        return proxyToAudioRaw(req, reply, '/v1/audio/transcriptions', contentType);
      }
      const body = transcriptionJsonSchema.parse(req.body);
      return proxyToAudio(req, reply, '/v1/audio/transcriptions', 'POST', body);
    },
  );

  app.get<{ Querystring: { model?: string } }>(
    '/v1/audio/voices',
    {
      schema: {
        tags: ['audio'],
        summary: 'List cached voice ids / presets for a TTS model (proxied to audiocpp_server)',
        querystring: z.object({ model: z.string().min(1).optional() }),
      },
    },
    async (req, reply) => {
      const qs = req.query.model ? `?model=${encodeURIComponent(req.query.model)}` : '';
      return proxyToAudio(req, reply, `/v1/audio/voices${qs}`, 'GET');
    },
  );

  app.get(
    '/v1/audio/models',
    {
      schema: {
        tags: ['audio'],
        summary: 'OpenAI-compatible model listing (proxied to audiocpp_server)',
        description:
          'This is the strict OpenAI-shape endpoint for the models audiocpp_server currently ' +
          'has configured — not our own model/bundle management API.',
      },
    },
    async (req, reply) => proxyToAudio(req, reply, '/v1/models', 'GET'),
  );

  app.post(
    '/v1/audio/tasks/run',
    {
      schema: {
        tags: ['audio'],
        summary: 'Generic audio.cpp framework request (proxied to audiocpp_server)',
        description:
          'Escape hatch for tasks without a dedicated route (voice conversion, music ' +
          'generation, source separation, ...): {"model","request":{...}} using the same ' +
          'request fields as audiocpp_cli, passed through unmodified.',
        body: tasksRunSchema,
      },
    },
    async (req, reply) => proxyToAudio(req, reply, '/v1/tasks/run', 'POST', req.body),
  );
}
