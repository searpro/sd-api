import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateSchema, errorResponseSchema } from '../schemas/generate.js';
import { validateDimensions } from '../util/validate.js';

const jobSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.number(),
  step: z.number().optional(),
  totalSteps: z.number().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export async function jobRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  // Phase 4: create an async job.
  app.post(
    '/v1/jobs',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Enqueue an async generation job',
        body: generateSchema,
        response: { 202: jobSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      validateDimensions(req.body, app.config.maxImageDim);
      const job = app.jobs.create(req.body);
      return reply.code(202).send(job);
    },
  );

  // Phase 4: list jobs.
  app.get(
    '/v1/jobs',
    {
      schema: {
        tags: ['jobs'],
        summary: 'List jobs',
        response: { 200: z.object({ jobs: z.array(jobSchema) }) },
      },
    },
    async () => ({ jobs: app.jobs.list() }),
  );

  // Phase 4: job status.
  app.get<{ Params: { id: string } }>(
    '/v1/jobs/:id',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Get job status',
        params: z.object({ id: z.string() }),
        response: { 200: jobSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const job = app.jobs.get(req.params.id);
      if (!job) {
        return reply
          .code(404)
          .send({ error: { code: 'JOB_NOT_FOUND', message: `Job not found: ${req.params.id}` } });
      }
      return reply.send(job);
    },
  );

  // Cancel a job.
  app.delete<{ Params: { id: string } }>(
    '/v1/jobs/:id',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Cancel a queued or running job',
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ cancelled: z.string() }), 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const ok = app.jobs.cancel(req.params.id);
      if (!ok) {
        return reply
          .code(404)
          .send({ error: { code: 'JOB_NOT_FOUND', message: `Job not found: ${req.params.id}` } });
      }
      return reply.send({ cancelled: req.params.id });
    },
  );
}
