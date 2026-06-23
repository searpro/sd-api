---
description: Scaffold a new Fastify route plugin (zod schemas + registration + test) following repo conventions
argument-hint: <resource> e.g. "presets" or "GET /v1/presets"
---

Add a new route for: **$ARGUMENTS**

Follow the existing pattern exactly (look at `src/routes/jobs.ts` and
`src/routes/models.ts` first). Steps:

1. Create `src/routes/<resource>.ts` exporting
   `export async function <resource>Routes(fastify: FastifyInstance)` that does
   `const app = fastify.withTypeProvider<ZodTypeProvider>();` and defines the
   endpoint(s) with a zod `schema` (`tags`, `summary`, `body`/`params`/
   `querystring`, and `response` incl. `errorResponseSchema` from
   `src/schemas/generate.ts`).
2. Use a service on `app.*` for logic (don't put filesystem/spawn logic in the
   route). If new state is needed, add a service under `src/<area>/manager.ts`,
   construct + `app.decorate(...)` it in `src/server.ts`, and augment
   `src/types.ts`.
3. Throw `AppError` (`src/errors.ts`) with a known code for error cases; never
   invent ad-hoc error JSON.
4. Validate any user-supplied path/name via `assertSafeName`/`safeResolve`.
5. Register the plugin in `src/server.ts` (and add a Swagger tag if new).
6. Add a test in `test/api.test.ts` (or a new `test/<resource>.test.ts`) using
   `makeTestConfig()` + `buildServer()` and `app.inject(...)`.
7. Run `npm run typecheck && npm test`.

Remember: relative imports end in `.js`; no unused imports (noUnusedLocals).
Keep the diff minimal and match surrounding style.
