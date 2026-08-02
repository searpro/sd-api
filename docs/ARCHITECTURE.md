# Architecture

Internal design reference for `sd-api`. Read this on demand (it is not loaded
into every session). For the always-on summary see `CLAUDE.md`; for the
product/API surface see `README.md`.

## Layers

```
HTTP (routes/*)  ──►  Services (decorated on app)  ──►  sd-cli / filesystem / HuggingFace
```

- **Entry**: `src/index.ts` loads config, builds the server, runs non-fatal
  startup steps (`app.sd.ensureBinary()`), then listens.
- **Server**: `src/server.ts` `buildServer(config)` registers the zod
  validator/serializer, Swagger (`/docs`), static UI (`public/`), multipart,
  the global error handler, constructs services, decorates them, and registers
  route plugins.
- **Services** (constructed once, shared): `SdWrapper`, `ModelManager`,
  `JobManager`, `DownloadManager`, `CatalogManager`. Augmented onto
  `FastifyInstance` in `src/types.ts`.

## Request → image lifecycle

1. `POST /v1/jobs` (or `/v1/generate`) validates the body with
   `generateSchema` (`src/schemas/generate.ts`).
2. `JobManager.create()` enqueues; a concurrency-limited worker calls
   `SdWrapper.generate()`.
3. `resolveBundle(modelsDir, id)` (`src/models/bundle.ts`) finds the checkpoint
   + components and decides `loadMode` (`-m` full vs `--diffusion-model` split).
4. Manifest `defaults` merge under request params; input images
   (`init_image`/`mask`/`ref_images`) resolve to validated paths under `inputsDir`.
5. `buildArgs()` (`src/sd/args.ts`) produces the argv (flag map + weights +
   edit flags + `--lora-model-dir` + manifest `extra_args`).
6. `SdWrapper.run()` spawns `sd-cli` with `spawnEnv()` (lib path), streams
   stdout/stderr through `parseProgress()` (`src/sd/progress.ts`), enforces the
   timeout, and on exit validates the output PNG.
7. Progress + completion are emitted as events; `GET /v1/jobs/:id/stream` relays
   them as SSE.

## Model bundles (`src/models/bundle.ts`)

A model is a directory `models/<id>/` with component sub-dirs:

```
models/<id>/
  model.json     # optional manifest (overrides auto-detection)
  checkpoint/    # diffusion model / full checkpoint  (-m | --diffusion-model)
  vae/           # --vae
  clip/          # text encoders: clip_l, clip_g, t5xxl, llm, clip_vision, llm_vision
  lora/          # LoRAs, prompt-activated via <lora:name:mult> + --lora-model-dir
```

- A single file at `models/<id>` (not a dir) = a full checkpoint (`-m`).
- `inspectBundle()` lists components for the API (+ `.part` `partials[]` +
  `loras[]`); `resolveBundle()` returns the absolute paths used for generation.
- **Role detection**: clip/ filenames map to flags via `detectClipRole()`
  (e.g. `qwen…`→`llm`, `t5xxl…`→`t5xxl`, `mmproj…`→`llm_vision`); a `model.json`
  `components` map overrides it. `load`/`extra_args`/`defaults` come from the
  manifest. `.part`/`.part.json` are excluded from component resolution.

## sd-cli arg mapping (`src/sd/args.ts`)

`FLAG_MAP` (prompt/negative/steps/cfg/W/H/seed/sampler) + `WEIGHT_FLAG`
(vae/clip_l/clip_g/clip_vision/t5xxl/llm/llm_vision) + edit flags
(`-i`/`--strength`/`--mask`/`-r`/`--increase-ref-index`/`--img-cfg-scale`) +
`--lora-model-dir` + `bundle.extraArgs`. The prompt (incl. `<lora:…>` tags) is
passed verbatim as one argv element. Verify against the real CLI help when in
doubt — see the `sd-cli` binary's `--help` (flags drift between releases).

## Downloads (`src/downloads/manager.ts`)

Background, concurrency-limited (`maxConcurrentDownloads`). Each download
streams to `<file>.part` with a `<file>.part.json` sidecar (url + total).
**Resume** sends an HTTP `Range` from the current `.part` size and appends
(206); a `200` means the server ignored the range → clean restart; `416` with a
full `.part` → promote to final. The `.part` becomes the final filename only on
success. Tasks: `queued|downloading|completed|failed|cancelled`; cancel keeps
the partial; `retry`/`resume` continue it. `ModelManager.resolveComponentPaths`
provides the on-disk targets.

## Catalog (`src/catalog/`)

`data.ts` is a curated `CatalogModel[]` (txt2img + edit models). `manager.ts`
returns summaries (`list()`), full entries (`get()`), and **live** per-component
file/quant options (`files()`) by querying the HuggingFace tree API in
`hf.ts` (cached 10 min; `parseQuant()` extracts the quant token; `resolveUrl()`
builds the download URL). Install (UI): write `model.json` manifest →
enqueue a download per chosen component. See the deferred plan to externalize
this list: `/root/.claude/plans/i-want-to-pull-federated-pixel.md`.

## HuggingFace auth (`src/util/hf-auth.ts`)

Gated/private models need a HuggingFace token. The resolver returns
`override ?? (HF_TOKEN | HUGGING_FACE_HUB_TOKEN)`. `hfAuthHeaders(url?)` attaches
`Authorization: Bearer …` for HuggingFace hosts only (never leaks to a CDN
redirect target). Used by `catalog/hf.ts` (listing) and `downloads/manager.ts`
(download); both turn a 401/403 into an actionable `gatedHint()` message.
`hfWhoami()` validates the token (cached 60s) and powers `GET /v1/auth/hf` /
`POST /v1/auth/hf/verify` (`src/routes/auth.ts`) + the Catalog tab badge.

- **Phase 1 (current)**: token from the env. No runtime setter is exposed.
- **Phase 2 (planned)**: UI OAuth. `setHfToken()` already provides an in-memory
  override slot, so a future `POST /v1/auth/hf` + HF OAuth callback can set the
  token at runtime without an env var. Keep secrets out of logs/responses
  (`maskToken` only).

## Binary install (`src/sd/installer.ts`, `src/sd/release.ts`)

On boot, if `sd-cli` isn't found and `autoInstall` is on, download the GitHub
release matching `process.platform`/`arch`/`accel` (`selectAsset()` matches by
keyword since asset names embed versions), extract, locate `sd-cli`, and
repoint config. Prebuilt binaries ship a sibling shared lib whose RUNPATH points
at the build machine → `SdWrapper.spawnEnv()` adds the binary's dir to the
loader path.

## Config (`src/config.ts`)

Resolution: `config/default.json` → `config/local.json` → `SD_*` env (zod
validated). Paths resolve relative to cwd. To add a setting, mirror an existing
field across: the zod schema, the `Config` interface, the env map, and the final
transform (use the `bool()`/`num()` helpers).

`.env` is loaded via `import 'dotenv/config'` as the first line of
`src/index.ts` (before `loadConfig()` runs), so `SD_*` vars in `.env` populate
`process.env` the same as real shell vars — dotenv never overrides a variable
that's already set, so real env still wins. `config.ts` itself has no dotenv
dependency (it just reads `process.env`), which keeps it side-effect-free for
tests that construct a `Config` directly (see `test/helpers.ts`).

## Conventions in practice

- A new route is a plugin: `export async function xRoutes(fastify) { const app =
  fastify.withTypeProvider<ZodTypeProvider>(); app.get(...) }`, registered in
  `server.ts`, with zod `schema` (tags/summary/body/response) and a test.
- Services take `(config, …deps, log: FastifyBaseLogger)`.
- Reuse: `errors.*`, `safeResolve`/`assertSafeName`, `uniqueImageName`,
  `parseProgress`, `DownloadManager` for any new downloadable artifact.
- In-memory state only (unless explicitly asked otherwise).
