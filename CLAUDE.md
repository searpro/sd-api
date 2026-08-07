# CLAUDE.md

HTTP API (Fastify + TypeScript) wrapping the **stable-diffusion.cpp** CLI
(`sd-cli`) for text-to-image generation, editing, model management and a web UI.
Full product/API docs: **README.md**. Internals: **docs/ARCHITECTURE.md**.

## Commands

```bash
npm run typecheck   # tsc --noEmit  (run before finishing)
npm test            # vitest run    (run before finishing)
npm run build       # tsc -> dist/
npm run dev         # tsx watch src/index.ts
npm start           # node dist/index.js
npx vitest run test/args.test.ts   # single test file
```

Always run `npm run typecheck && npm test` before declaring a change done.

## Hard rules (read before editing)

- **ESM + NodeNext**: every relative import MUST end in `.js` (even importing a
  `.ts` file), e.g. `import { x } from './util/paths.js'`. `"type":"module"`.
- **`strict` + `noUnusedLocals`** are on — no unused imports/vars or the build
  fails. Node >= 20.
- **Never build shell strings for `sd-cli`.** Args are a discrete argv array
  built in `src/sd/args.ts`; values pass as separate elements (no injection).
- **Path safety**: pass every user-supplied name through `assertSafeName` /
  `safeResolve` (`src/util/paths.ts`). Never `join`/`resolve` raw user input.
- **Errors**: throw `AppError` from `src/errors.ts` with a known code; the global
  handler serializes `{ "error": { "code", "message" } }`. Don't invent ad-hoc
  error shapes. Codes: VALIDATION_ERROR, MODEL_NOT_FOUND, INVALID_MODEL,
  MISSING_WEIGHTS, GENERATION_FAILED, PROCESS_TIMEOUT, BINARY_NOT_FOUND,
  JOB_NOT_FOUND, OUTPUT_NOT_FOUND, INPUT_NOT_FOUND, INVALID_PATH,
  DOWNLOAD_FAILED, INTERNAL_ERROR.
- **Validation is zod-first**: request/response schemas use zod via
  `fastify-type-provider-zod`. Routes call `fastify.withTypeProvider<ZodTypeProvider>()`.

## Architecture (1 minute)

Thin HTTP layer (`src/routes/*`) over services built once in
`buildServer()` (`src/server.ts`) and decorated on the Fastify instance
(types in `src/types.ts`):

| `app.*` | Service | Responsibility |
| --- | --- | --- |
| `sd` | `src/sd/wrapper.ts` | resolve bundle → build argv → spawn `sd-cli`, parse progress, install binary |
| `models` | `src/models/manager.ts` | list/create/delete bundles, component paths, manifests |
| `downloads` | `src/downloads/manager.ts` | background downloads w/ progress + resume (`.part` + sidecar) |
| `jobs` | `src/jobs/manager.ts` | in-memory async generation queue + SSE |
| `catalog` | `src/catalog/manager.ts` | curated model catalog + live HuggingFace file/quant listing |

Generation flow: route → `jobs.create()` → `sd.generate()` →
`resolveBundle()` (`src/models/bundle.ts`) → `buildArgs()` → spawn → SSE progress.

## Key invariants

- **State is in-memory** (jobs, downloads, catalog) — resets on restart, by
  design. Don't add a DB without being asked.
- **Model bundle layout** (`models/<id>/`): `checkpoint/ vae/ clip/ lora/` +
  optional `model.json` manifest. A single file at `models/` root = a full
  checkpoint. See the `add-catalog-model` skill / docs/ARCHITECTURE.md.
- **LoRA** is prompt-activated (`<lora:name:mult>`) + `--lora-model-dir`; it is
  NOT a CLI weight flag.
- **Video generation** (Wan T2V/I2V only) reuses the image pipeline end to
  end — no separate domain/routes. A bundle's `model.json` sets
  `"mode": "video"`, which makes `buildArgs()` emit `-M vid_gen` and
  `wrapper.ts` write a `.webm` instead of `.png` (sd-cli's `-o` only supports
  `.avi`/`.webm`/animated `.webp` for video, NOT `.mp4` — it silently appends
  `.avi` if you ask for an unrecognized extension). Wan2.2 A14B (dual-stage),
  FLF2V, V2V, and other video engines (MiniMax-H3, LTX-2.3, HunyuanVideo,
  LingBot-Video) are not implemented.
- **Logger** type in services is `FastifyBaseLogger` (not pino's `Logger`).

## Conventions

- Match the surrounding style; comments explain *why*, not *what*. Keep them
  sparse and purposeful (see existing files).
- New endpoint = a route plugin in `src/routes/`, registered in `server.ts`,
  with zod schemas and a test in `test/`. See the `/new-route` command.
- Reuse helpers: `safeResolve`/`assertSafeName`, `errors.*`, `uniqueOutputName`,
  `parseProgress`. Don't reimplement.

## Testing

- `vitest`. Tests run against a **fake `sd` binary** (`test/fixtures/fake-sd.mjs`)
  via `makeTestConfig()` in `test/helpers.ts` — no real model or GPU needed.
- Network (HuggingFace, GitHub API) may be blocked in sandboxes; stub `fetch`
  in tests (see `test/catalog.test.ts`, `test/downloads.test.ts`).

## Gotchas

- Prebuilt `sd-cli` needs its sibling shared lib on the loader path; handled by
  `SdWrapper.spawnEnv()` (LD_LIBRARY_PATH / DYLD_* / PATH). Don't move the
  binary out of its extracted dir.
- To run locally without a real binary, use the `local-verify` skill (fake-sd +
  `SD_*` env). `raw.githubusercontent.com` and GitHub release downloads usually
  work even when the HF/GitHub *API* is rate-limited/blocked.
