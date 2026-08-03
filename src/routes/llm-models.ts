import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../schemas/generate.js';
import { llmDownloadTaskSchema } from './llm-downloads.js';
import type { LlmModelManifest } from '../llm-models/bundle.js';

const componentFileSchema = z.object({ name: z.string(), size: z.number() });

const partialSchema = z.object({
  type: z.enum(['gguf', 'mmproj']),
  name: z.string(),
  received: z.number(),
  total: z.number().nullable(),
});

const bundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  weights: componentFileSchema.nullable(),
  mmproj: componentFileSchema.nullable(),
  size: z.number(),
  modified: z.string(),
  ready: z.boolean(),
  partials: z.array(partialSchema),
});

const componentType = z.enum(['gguf', 'mmproj']);

const createSchema = z.object({ model: z.string().min(1) });

const downloadSchema = z.object({
  model: z.string().min(1),
  type: componentType.default('gguf'),
  url: z.string().url(),
  name: z.string().optional(),
});

export async function llmModelRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List LLM model bundles.
  app.get(
    '/v1/llm-models',
    {
      schema: {
        tags: ['llm'],
        summary: 'List installed LLM model bundles',
        response: { 200: z.object({ models: z.array(bundleSchema) }) },
      },
    },
    async () => ({ models: await app.llmModels.list() }),
  );

  // Get one LLM model bundle.
  app.get<{ Params: { model: string } }>(
    '/v1/llm-models/:model',
    {
      schema: {
        tags: ['llm'],
        summary: 'Get an LLM model bundle',
        params: z.object({ model: z.string() }),
        response: { 200: bundleSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const bundle = await app.llmModels.get(req.params.model);
      if (!bundle) {
        return reply
          .code(404)
          .send({ error: { code: 'MODEL_NOT_FOUND', message: `LLM model not found: ${req.params.model}` } });
      }
      return reply.send(bundle);
    },
  );

  // Create an empty bundle directory.
  app.post(
    '/v1/llm-models',
    {
      schema: {
        tags: ['llm'],
        summary: 'Create an empty LLM model bundle',
        body: createSchema,
        response: { 201: bundleSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.llmModels.createBundle(req.body.model);
      const bundle = await app.llmModels.get(req.body.model);
      if (!bundle) {
        return reply
          .code(400)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create bundle' } });
      }
      return reply.code(201).send(bundle);
    },
  );

  // Write/replace a bundle's model.json sidecar (display name only).
  app.put<{ Params: { model: string } }>(
    '/v1/llm-models/:model/manifest',
    {
      schema: {
        tags: ['llm'],
        summary: 'Write an LLM bundle sidecar (model.json)',
        params: z.object({ model: z.string() }),
        body: z.object({ name: z.string().optional() }),
        response: { 200: bundleSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.llmModels.writeManifest(req.params.model, req.body as LlmModelManifest);
      const bundle = await app.llmModels.get(req.params.model);
      if (!bundle) {
        return reply
          .code(400)
          .send({ error: { code: 'INTERNAL_ERROR', message: 'Failed to write manifest' } });
      }
      return reply.send(bundle);
    },
  );

  // Enqueue a background download of a component into an LLM bundle.
  app.post(
    '/v1/llm-models/download',
    {
      schema: {
        tags: ['llm'],
        summary: 'Enqueue a background download of an LLM model component',
        description:
          'Returns a download task immediately. Track progress via GET /v1/llm-downloads/:id.',
        body: downloadSchema,
        response: { 202: llmDownloadTaskSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const task = app.llmDownloads.enqueue(req.body);
      return reply.code(202).send(task);
    },
  );

  // Delete a whole LLM model bundle.
  app.delete<{ Params: { model: string } }>(
    '/v1/llm-models/:model',
    {
      schema: {
        tags: ['llm'],
        summary: 'Delete an LLM model bundle',
        params: z.object({ model: z.string() }),
        response: { 200: z.object({ deleted: z.string() }), 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.llmModels.deleteModel(req.params.model);
      return reply.send({ deleted: req.params.model });
    },
  );

  // Delete a single file within an LLM bundle.
  app.delete<{ Params: { model: string; type: 'gguf' | 'mmproj'; name: string } }>(
    '/v1/llm-models/:model/:type/:name',
    {
      schema: {
        tags: ['llm'],
        summary: 'Delete a single file within an LLM bundle',
        params: z.object({ model: z.string(), type: componentType, name: z.string() }),
        response: { 200: z.object({ deleted: z.string() }), 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      await app.llmModels.deleteComponent(req.params.model, req.params.type, req.params.name);
      return reply.send({ deleted: `${req.params.model}/${req.params.type}/${req.params.name}` });
    },
  );
}
