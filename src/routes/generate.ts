import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  generateSchema,
  generateResponseSchema,
  errorResponseSchema,
} from '../schemas/generate.js';
import { validateDimensions } from '../util/validate.js';

export async function generateRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // Phase 1 + 2: synchronous text-to-image generation.
  app.post(
    '/v1/generate',
    {
      schema: {
        tags: ['generate'],
        summary: 'Generate an image (synchronous)',
        description:
          'Runs stable-diffusion.cpp and waits for the result. For long jobs prefer POST /v1/jobs.',
        body: generateSchema,
        response: {
          200: generateResponseSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          422: errorResponseSchema,
          500: errorResponseSchema,
          504: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const params = req.body;
      validateDimensions(params, app.config.maxImageDim);

      const result = await app.sd.generate({
        params,
        onLog: (line) => req.log.debug({ line }, 'sd'),
      });

      return reply.send({
        image_path: result.imagePath,
        image_url: `/v1/outputs/${result.imageName}`,
        metadata: {
          prompt: result.params.prompt,
          model: result.params.model,
          seed: result.params.seed,
          steps: result.params.steps,
          cfg_scale: result.params.cfg_scale,
          width: result.params.width,
          height: result.params.height,
          sampler: result.params.sampler,
          duration_ms: result.durationMs,
        },
      });
    },
  );

  // Phase 5: Server-Sent Events progress stream for an existing job.
  app.get<{ Params: { id: string } }>(
    '/v1/jobs/:id/stream',
    {
      schema: {
        tags: ['generate', 'jobs'],
        summary: 'Stream job progress via SSE',
        description:
          'Emits `progress` events as sampling proceeds and a terminal `complete` or `error` event.',
        params: z.object({ id: z.string() }),
        produces: ['text/event-stream'],
      },
    },
    async (req, reply) => {
      const job = app.jobs.get(req.params.id);
      if (!job) {
        return reply.code(404).send({
          error: { code: 'JOB_NOT_FOUND', message: `Job not found: ${req.params.id}` },
        });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Replay current state immediately.
      send('status', { status: job.status, progress: job.progress });

      // Terminal already? close right away.
      if (job.status === 'completed') {
        send('complete', job.result);
        reply.raw.end();
        return;
      }
      if (job.status === 'failed') {
        send('error', job.error);
        reply.raw.end();
        return;
      }

      const unsubscribe = app.jobs.subscribe(req.params.id, (event, data) => {
        if (event === 'progress') {
          const p = data as { step: number; total: number; progress: number };
          send('progress', { step: p.step, total: p.total, progress: p.progress });
        } else if (event === 'completed') {
          send('complete', (data as { result: unknown }).result ?? data);
          cleanup();
          reply.raw.end();
        } else if (event === 'failed') {
          send('error', (data as { error: unknown }).error ?? data);
          cleanup();
          reply.raw.end();
        }
      });

      // Heartbeat to keep proxies from closing the connection.
      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      req.raw.on('close', cleanup);
    },
  );
}
