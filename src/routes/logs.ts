import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const categorySchema = z.enum([
  'http',
  'healthcheck',
  'error',
  'sd-cli',
  'llama-server',
  'audio-server',
  'app',
]);

// Passthrough: pino records carry arbitrary bindings (req, res, err, line,
// responseTime, ...) depending on what logged them — no fixed shape to
// enumerate, same rationale as the .passthrough() LLM proxy schemas.
const logRecordSchema = z
  .object({
    time: z.number(),
    level: z.number(),
    levelLabel: z.string(),
    msg: z.string().optional(),
    category: categorySchema,
    reqId: z.string().optional(),
  })
  .passthrough();

const DEFAULT_REPLAY_LIMIT = 300;

export async function logRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get<{ Querystring: { limit?: number; level?: string; category?: string } }>(
    '/v1/logs',
    {
      schema: {
        tags: ['logs'],
        summary: 'List recent buffered log entries',
        description: 'In-memory ring buffer (last 2000 entries) — resets on restart, like all other app state.',
        querystring: z.object({
          limit: z.coerce.number().int().positive().optional(),
          level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
          category: categorySchema.optional(),
        }),
        response: { 200: z.object({ logs: z.array(logRecordSchema) }) },
      },
    },
    async (req) => ({
      logs: app.logs.list({
        limit: req.query.limit,
        level: req.query.level,
        category: req.query.category as z.infer<typeof categorySchema> | undefined,
      }),
    }),
  );

  // SSE live tail: replay the recent buffer, then stream new entries as they arrive.
  app.get(
    '/v1/logs/stream',
    {
      schema: {
        tags: ['logs'],
        summary: 'Stream log entries via SSE',
        produces: ['text/event-stream'],
      },
    },
    async (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (event: string, data: unknown) =>
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      send('replay', app.logs.list({ limit: DEFAULT_REPLAY_LIMIT }));

      const unsubscribe = app.logs.subscribe((record) => send('log', record));
      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.raw.on('close', cleanup);
    },
  );
}
