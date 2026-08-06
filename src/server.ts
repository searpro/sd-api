import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { fileURLToPath } from 'node:url';
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
import { CatalogManager } from './catalog/manager.js';
import { DownloadManager } from './downloads/manager.js';
import { LlamaServerManager } from './llm/server-manager.js';
import { LlmModelManager, type LlmComponentType } from './llm-models/manager.js';
import { LlmCatalogManager } from './llm-catalog/manager.js';
import { LogBuffer } from './logs/buffer.js';
import { AudioServerManager } from './audio/server-manager.js';
import { AudioModelManager, type AudioComponentType } from './audio-models/manager.js';
import { AudioCatalogManager } from './audio-catalog/manager.js';
import { AppError } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { generateRoutes } from './routes/generate.js';
import { modelRoutes } from './routes/models.js';
import { catalogRoutes } from './routes/catalog.js';
import { downloadRoutes } from './routes/downloads.js';
import { jobRoutes } from './routes/jobs.js';
import { outputRoutes } from './routes/outputs.js';
import { inputRoutes } from './routes/inputs.js';
import { llmRoutes } from './routes/llm.js';
import { llmModelRoutes } from './routes/llm-models.js';
import { llmDownloadRoutes } from './routes/llm-downloads.js';
import { llmCatalogRoutes } from './routes/llm-catalog.js';
import { logRoutes } from './routes/logs.js';
import { audioRoutes } from './routes/audio.js';
import { audioModelRoutes } from './routes/audio-models.js';
import { audioDownloadRoutes } from './routes/audio-downloads.js';
import { audioCatalogRoutes } from './routes/audio-catalog.js';
import { audioVoiceRefRoutes } from './routes/audio-voice-refs.js';
import './types.js';

export async function buildServer(config: Config): Promise<FastifyInstance> {
  // Tee every log line to stdout (unchanged terminal behavior) and into an
  // in-memory ring buffer that backs the web UI's Logs tab (GET /v1/logs,
  // GET /v1/logs/stream). Fastify's `logger` option is options-only — a
  // pre-built pino instance needs the separate `loggerInstance` option.
  const logs = new LogBuffer();
  // Widened to FastifyBaseLogger (not the concrete pino.Logger<...> type) so
  // TS infers Fastify's Logger generic as its default — otherwise every
  // route plugin (typed against the default FastifyInstance) stops matching.
  // pino.multistream() defaults each stream entry to level 'info' unless
  // told otherwise — it does NOT inherit the logger's own `level` below —
  // so both destinations need it stated explicitly, or every debug() call
  // (including the sd-cli/llama-server/audio-server child-process line
  // forwarding LogBuffer.categorize() depends on) is silently dropped
  // before it reaches either stdout or the buffer, regardless of logLevel.
  const pinoLogger: FastifyBaseLogger = pino(
    { level: config.logLevel },
    pino.multistream([
      { stream: process.stdout, level: config.logLevel },
      { stream: logs, level: config.logLevel },
    ]),
  );

  const app = Fastify({
    loggerInstance: pinoLogger,
    // Idle keep-alive sockets (e.g. an OpenAI-client connection pool sitting
    // on /v1/llm/*) otherwise make close() hang waiting for them to end
    // naturally — force them shut so shutdown/test teardown is bounded.
    forceCloseConnections: true,
    bodyLimit: 1024 * 1024, // 1 MiB — requests are small JSON payloads.
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Services (Phase 7 config wired into each component).
  const sd = new SdWrapper(config, app.log);
  const models = new ModelManager(config, app.log);
  const jobs = new JobManager(config, sd, app.log);
  const catalog = new CatalogManager(app.log);
  const downloads = new DownloadManager(config, models, app.log);
  const llm = new LlamaServerManager(config, app.log);
  const llmModels = new LlmModelManager(config, app.log);
  // llama-server only discovers models from --models-dir at startup, so a
  // model downloaded while it's already running is otherwise invisible to it
  // until a manual restart — auto-restart (debounced) once a download lands.
  const llmDownloads = new DownloadManager<LlmComponentType>(config, llmModels, app.log, (task) => {
    if (task.status === 'completed') llm.scheduleRestart();
  });
  const llmCatalog = new LlmCatalogManager(app.log);
  const audio = new AudioServerManager(config, app.log);
  const audioModels = new AudioModelManager(config, app.log);
  // audiocpp_server (like llama-server) only picks up its model registry at
  // startup — regenerate the --config file and restart (debounced) once a
  // download lands, so a newly-installed model becomes servable without a
  // manual restart.
  const audioDownloads = new DownloadManager<AudioComponentType>(config, audioModels, app.log, (task) => {
    if (task.status === 'completed') audio.scheduleRestart();
  });
  const audioCatalog = new AudioCatalogManager(app.log);
  app.decorate('config', config);
  app.decorate('sd', sd);
  app.decorate('models', models);
  app.decorate('jobs', jobs);
  app.decorate('catalog', catalog);
  app.decorate('downloads', downloads);
  app.decorate('llm', llm);
  app.decorate('llmModels', llmModels);
  app.decorate('llmDownloads', llmDownloads);
  app.decorate('llmCatalog', llmCatalog);
  app.decorate('logs', logs);
  app.decorate('audio', audio);
  app.decorate('audioModels', audioModels);
  app.decorate('audioDownloads', audioDownloads);
  app.decorate('audioCatalog', audioCatalog);

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
        { name: 'catalog', description: 'Downloadable model catalog' },
        { name: 'downloads', description: 'Background model downloads' },
        { name: 'inputs', description: 'Input images for img2img / editing' },
        { name: 'outputs', description: 'Generated images' },
        { name: 'auth', description: 'HuggingFace authentication' },
        {
          name: 'llm',
          description:
            'LLM serving (llama.cpp): OpenAI-compatible chat/completions (/v1/llm/*), plus our own ' +
            'model management (/v1/llm-models) and catalog (/v1/llm-catalog)',
        },
        { name: 'system', description: 'Health & meta' },
        { name: 'logs', description: 'Live log viewer (in-memory ring buffer, tees stdout)' },
        {
          name: 'audio',
          description:
            'Audio generation (audio.cpp): OpenAI-style TTS/transcription (/v1/audio/*), plus our ' +
            'own model management (/v1/audio-models) and catalog (/v1/audio-catalog)',
        },
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

  // File uploads (input images for img2img / edit).
  await app.register(fastifyMultipart, {
    limits: { fileSize: 64 * 1024 * 1024, files: 16 },
  });

  // Routes.
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(generateRoutes);
  await app.register(modelRoutes);
  await app.register(catalogRoutes);
  await app.register(downloadRoutes);
  await app.register(inputRoutes);
  await app.register(jobRoutes);
  await app.register(outputRoutes);
  await app.register(llmRoutes);
  await app.register(llmModelRoutes);
  await app.register(llmDownloadRoutes);
  await app.register(llmCatalogRoutes);
  await app.register(logRoutes);
  await app.register(audioRoutes);
  await app.register(audioModelRoutes);
  await app.register(audioDownloadRoutes);
  await app.register(audioCatalogRoutes);
  await app.register(audioVoiceRefRoutes);

  // Thin web UI (static, no build step). Served at "/"; API routes above take
  // precedence over the static wildcard. public/ sits next to src/ and dist/.
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../public', import.meta.url)),
    prefix: '/',
    index: ['index.html'],
  });

  // Ensure runtime directories exist.
  await models.init();
  await llmModels.init();
  await audioModels.init();

  return app;
}
