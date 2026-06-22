import Fastify, { type FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { SdWrapper } from './sd/wrapper.js';
import { ModelManager } from './models/manager.js';
import { JobManager } from './jobs/manager.js';
import { AppError } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { generateRoutes } from './routes/generate.js';
import { modelRoutes } from './routes/models.js';
import { jobRoutes } from './routes/jobs.js';
import { outputRoutes } from './routes/outputs.js';
import './types.js';

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 1024 * 1024, // 1 MiB — requests are small JSON payloads.
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Services (Phase 7 config wired into each component).
  const sd = new SdWrapper(config, app.log);
  const models = new ModelManager(config, app.log);
  const jobs = new JobManager(config, sd, app.log);
  app.decorate('config', config);
  app.decorate('sd', sd);
  app.decorate('models', models);
  app.decorate('jobs', jobs);

  // OpenAPI 3.1 docs (Phase 8).
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'stable-diffusion.cpp API',
        description:
          'HTTP API wrapping the stable-diffusion.cpp CLI for text-to-image generation.',
        version: '0.1.0',
      },
      tags: [
        { name: 'generate', description: 'Image generation' },
        { name: 'jobs', description: 'Async job system' },
        { name: 'models', description: 'Model management' },
        { name: 'outputs', description: 'Generated images' },
        { name: 'system', description: 'Health & meta' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // Structured error handling (Spec section 4).
  app.setErrorHandler((err: Error & { validation?: unknown }, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(err.toResponse());
    }
    if (err instanceof ZodError || err.validation) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
          details: err.validation,
        },
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.url}` },
    });
  });

  // Routes.
  await app.register(healthRoutes);
  await app.register(generateRoutes);
  await app.register(modelRoutes);
  await app.register(jobRoutes);
  await app.register(outputRoutes);

  // Ensure runtime directories exist.
  await models.init();

  return app;
}
