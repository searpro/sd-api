import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../schemas/generate.js';

export const downloadTaskSchema = z.object({
  id: z.string(),
  model: z.string(),
  type: z.enum(['checkpoint', 'vae', 'clip']),
  name: z.string(),
  url: z.string(),
  status: z.enum(['queued', 'downloading', 'completed', 'failed', 'cancelled']),
  received: z.number(),
  total: z.number().nullable(),
  resumed: z.boolean(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export async function downloadRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List downloads (optionally filtered by model).
  app.get<{ Querystring: { model?: string } }>(
    '/v1/downloads',
    {
      schema: {
        tags: ['downloads'],
        summary: 'List download tasks',
        querystring: z.object({ model: z.string().optional() }),
        response: { 200: z.object({ downloads: z.array(downloadTaskSchema) }) },
      },
    },
    async (req) => ({ downloads: app.downloads.list(req.query.model) }),
  );

  // Get a single download task.
  app.get<{ Params: { id: string } }>(
    '/v1/downloads/:id',
    {
      schema: {
        tags: ['downloads'],
        summary: 'Get a download task',
        params: z.object({ id: z.string() }),
        response: { 200: downloadTaskSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const task = app.downloads.get(req.params.id);
      if (!task) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: `Download not found: ${req.params.id}` } });
      }
      return reply.send(task);
    },
  );

  // SSE progress stream for a download.
  app.get<{ Params: { id: string } }>(
    '/v1/downloads/:id/stream',
    {
      schema: {
        tags: ['downloads'],
        summary: 'Stream download progress via SSE',
        params: z.object({ id: z.string() }),
        produces: ['text/event-stream'],
      },
    },
    async (req, reply) => {
      const task = app.downloads.get(req.params.id);
      if (!task) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: `Download not found: ${req.params.id}` } });
      }
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (event: string, data: unknown) =>
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('progress', task);
      if (task.status !== 'queued' && task.status !== 'downloading') {
        send('done', task);
        reply.raw.end();
        return;
      }
      const unsubscribe = app.downloads.subscribe(req.params.id, (event, data) => {
        send(event, data);
        if (event === 'done') {
          cleanup();
          reply.raw.end();
        }
      });
      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.raw.on('close', cleanup);
    },
  );

  // Retry / resume a failed or cancelled download.
  app.post<{ Params: { id: string } }>(
    '/v1/downloads/:id/retry',
    {
      schema: {
        tags: ['downloads'],
        summary: 'Retry (resume) a failed or cancelled download',
        params: z.object({ id: z.string() }),
        response: { 202: downloadTaskSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const task = app.downloads.retry(req.params.id);
      if (!task) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: `Download not found: ${req.params.id}` } });
      }
      return reply.code(202).send(task);
    },
  );

  // Cancel a running/queued download (keeps the partial for resuming).
  app.post<{ Params: { id: string } }>(
    '/v1/downloads/:id/cancel',
    {
      schema: {
        tags: ['downloads'],
        summary: 'Cancel a running download (keeps the partial file)',
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ cancelled: z.string() }), 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      if (!app.downloads.cancel(req.params.id)) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: `Download not found: ${req.params.id}` } });
      }
      return reply.send({ cancelled: req.params.id });
    },
  );

  // Remove a task record (optionally discarding the partial file).
  app.delete<{ Params: { id: string }; Querystring: { discard?: string } }>(
    '/v1/downloads/:id',
    {
      schema: {
        tags: ['downloads'],
        summary: 'Remove a download task (optionally discard the partial)',
        params: z.object({ id: z.string() }),
        querystring: z.object({ discard: z.enum(['true', 'false']).optional() }),
        response: { 200: z.object({ removed: z.string() }), 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const ok = await app.downloads.remove(req.params.id, req.query.discard === 'true');
      if (!ok) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: `Download not found: ${req.params.id}` } });
      }
      return reply.send({ removed: req.params.id });
    },
  );

  // Resume a partial download discovered on disk (uses its sidecar URL).
  app.post<{ Body: { model: string; type: 'checkpoint' | 'vae' | 'clip'; name: string } }>(
    '/v1/downloads/resume',
    {
      schema: {
        tags: ['downloads'],
        summary: 'Resume an on-disk partial download by model/type/name',
        body: z.object({
          model: z.string(),
          type: z.enum(['checkpoint', 'vae', 'clip']),
          name: z.string(),
        }),
        response: { 202: downloadTaskSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const task = await app.downloads.resumePartial(req.body.model, req.body.type, req.body.name);
      return reply.code(202).send(task);
    },
  );
}
