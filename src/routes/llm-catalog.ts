import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../schemas/generate.js';
import { AppError } from '../errors.js';

const fileSchema = z.object({
  filename: z.string(),
  path: z.string(),
  url: z.string(),
  size: z.number(),
  format: z.literal('gguf'),
  quant: z.string().nullable(),
});

const componentFilesSchema = z.object({
  role: z.enum(['gguf', 'mmproj']),
  label: z.string(),
  required: z.boolean(),
  quantizable: z.boolean(),
  files: z.array(fileSchema),
  error: z.string().optional(),
});

export async function llmCatalogRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Browse the curated LLM catalog (static; no network).
  app.get(
    '/v1/llm-catalog',
    {
      schema: {
        tags: ['llm'],
        summary: 'List catalog LLMs available to download',
        description:
          'Curated GGUF-quantized LLMs (< 30B params). Not the OpenAI-compatible surface — see /v1/llm/* for that.',
      },
    },
    async () => ({ models: app.llmCatalog.list() }),
  );

  // Resolve the selectable GGUF quant files for a model.
  app.get<{ Params: { id: string } }>(
    '/v1/llm-catalog/:id/files',
    {
      schema: {
        tags: ['llm'],
        summary: 'List downloadable GGUF quantizations for a catalog LLM',
        description: 'Queries the HuggingFace Hub for the real files of each component.',
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ id: z.string(), components: z.array(componentFilesSchema) }),
          404: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      if (!app.llmCatalog.get(req.params.id)) {
        throw new AppError('MODEL_NOT_FOUND', `Unknown LLM catalog model: ${req.params.id}`, 404);
      }
      const components = await app.llmCatalog.files(req.params.id);
      return reply.send({ id: req.params.id, components });
    },
  );
}
