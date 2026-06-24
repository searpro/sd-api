import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getHfToken, hfTokenSource, maskToken, hfWhoami } from '../util/hf-auth.js';

/**
 * HuggingFace authentication status (Phase 1: token from the environment).
 * Setting the token is done via the HF_TOKEN env var; these endpoints only
 * report and verify it. A future phase may add a runtime/OAuth setter.
 */
export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Is a HuggingFace token configured? (no network)
  app.get(
    '/v1/auth/hf',
    {
      schema: {
        tags: ['auth'],
        summary: 'HuggingFace auth status',
        response: {
          200: z.object({
            configured: z.boolean(),
            source: z.enum(['override', 'env', 'none']),
            masked: z.string().optional(),
          }),
        },
      },
    },
    async () => {
      const token = getHfToken();
      return {
        configured: Boolean(token),
        source: hfTokenSource(),
        ...(token ? { masked: maskToken(token) } : {}),
      };
    },
  );

  // Validate the token against HuggingFace and return the account (network).
  app.post(
    '/v1/auth/hf/verify',
    {
      schema: {
        tags: ['auth'],
        summary: 'Verify the configured HuggingFace token (whoami)',
        response: {
          200: z.object({
            ok: z.boolean(),
            configured: z.boolean(),
            user: z.object({ name: z.string(), fullname: z.string().optional() }).optional(),
            error: z.string().optional(),
          }),
        },
      },
    },
    async () => {
      if (!getHfToken()) {
        return { ok: false, configured: false, error: 'No HuggingFace token configured (set HF_TOKEN).' };
      }
      try {
        const user = await hfWhoami();
        return user
          ? { ok: true, configured: true, user }
          : { ok: false, configured: true, error: 'Token configured but whoami returned no user.' };
      } catch (err) {
        return { ok: false, configured: true, error: (err as Error).message };
      }
    },
  );
}
