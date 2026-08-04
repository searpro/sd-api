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
  `JobManager`, `DownloadManager`, `CatalogManager`, `LlamaServerManager`,
  `LlmModelManager`, a second `DownloadManager<LlmComponentType>` instance
  (`app.llmDownloads`), `LlmCatalogManager`. Augmented onto `FastifyInstance`
  in `src/types.ts`.

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
the partial; `retry`/`resume` continue it.

`DownloadManager<TType extends string = ComponentType>` is generic over a
`ComponentPathResolver<TType>` (`src/downloads/resolver.ts` —
`resolveComponentPaths()` + `fileNameFor()`) rather than a concrete
`ModelManager`, so the same tested resume/progress/cancel implementation
serves two independent domains: `ModelManager implements
ComponentPathResolver<ComponentType>` (image models, `checkpoint/vae/clip/lora`
sub-dirs) and `LlmModelManager implements ComponentPathResolver<LlmComponentType>`
(LLM models, flat layout, `.gguf`-only `ALLOWED_EXT`). `server.ts` constructs
**two separate `DownloadManager` instances** (`app.downloads`,
`app.llmDownloads`) rather than merging both `type` unions into one class —
keeps each domain's API contract (and `ALLOWED_EXT`) from leaking into the
other's.

## Catalog (`src/catalog/`, `src/llm-catalog/`)

`catalog/data.ts` is a curated `CatalogModel[]` (txt2img + edit image models).
`catalog/manager.ts` returns summaries (`list()`), full entries (`get()`), and
**live** per-component file/quant options (`files()`) by querying the
HuggingFace tree API in `catalog/hf.ts` (cached 10 min; `parseQuant()`
extracts the quant token — recognizes both SD-style `Q4_K_M`/`BF16` and
llama.cpp's `IQ*` imatrix naming like `IQ4_XS`; `resolveUrl()` builds the
download URL). Install (UI): write `model.json` manifest → enqueue a download
per chosen component.

`llm-catalog/` is a parallel, simpler catalog for LLMs (`data.ts` curates
models across Llama/Qwen/Mistral/Gemma/Phi/DeepSeek-R1-distill/gpt-oss/GLM/
Nemotron families, sourced primarily from ggml-org's, bartowski's and
unsloth's GGUF conversions — repo ids verified to exist against the real HF
API, not memorized; `ggml-org` publishing a conversion is treated as the
strongest signal that mainline `llama.cpp` actually supports the
architecture, since that's the project's own account) — **reuses
`catalog/hf.ts`'s `listComponentFiles()` unchanged**, since it's already
generic over repo/path/match/format. Each `LlmCatalogModel` carries `params`
(total, drives download size/memory footprint) and an optional
`activeParams` (MoE models only — what actually drives inference cost, since
every expert stays resident in memory regardless of how many activate per
token) plus a `tier` (`'mac' | 'cloud' | 'both'`, defaults to `'both'` via
`LlmCatalogManager.list()` the same way `vision` defaults to `false`) so
clients can filter by "what will this cost to run."

`LlmCatalogManager.files()` applies two filters to every live HF listing,
regardless of role:
- **Shard exclusion** (`SHARD_RE`, `-\d{5}-of-\d{5}\.gguf$`): several newer,
  larger repos publish some quants as multi-part shards once a file crosses
  ~50GB, alongside other single-file quants of the same model — but this
  app's downloader only fetches one file per component, so a lone shard
  would install as a silently truncated, unusable bundle. Excluded outright
  rather than surfaced with a warning, since there's no partial-file
  detection anywhere downstream. (This is also why `MiniMax-M2` — otherwise
  a strong efficiency pick — isn't in the catalog: every quant it ships is
  shard-split except an unusably low-bit ternary one.)
- **Draft-file exclusion** (`AUX_DRAFT_RE`, `mtp-`/`dflash-`/`eagle3-`
  prefixes): several newer repos (Qwen3.6, Gemma 4, gpt-oss, GLM) ship
  speculative-decoding draft-model files alongside the real weights: applied
  only to `role === 'gguf'` (weights) responses, same as the pre-existing
  `isMmproj()` (`llm-models/bundle.ts`) filter it sits alongside — without
  both, either could surface as a bogus "weights" option.

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

## LLM serving (`src/llm/`, `src/routes/llm.ts`)

Unlike `sd-cli` (spawned fresh per request, one-shot — see `SdWrapper.run()`),
`llama-server` is a **persistent process**: started once, kept alive across
requests, and reverse-proxied to. `LlamaServerManager` (`src/llm/server-manager.ts`)
owns that lifecycle:

- `start()`/`ensureRunning()` spawn `llama-server` in **router mode** (no `-m` —
  see `buildLlamaServerArgs()` in `src/llm/args.ts`) and poll `GET /health`
  until ready or `llmStartupTimeoutMs` elapses (`LLM_STARTUP_FAILED`).
  Concurrent callers coalesce onto one in-flight spawn via a `startPromise`
  guard checked **synchronously before any `await`** — checking `status`
  alone isn't sufficient here, since `doStart()`'s first line (`await
  mkdir(...)`) leaves a window where `status` is still `'stopped'` even
  though a spawn is already in flight; a second caller landing in that window
  would otherwise spawn a duplicate process onto the same port.
- `stop()` sends `SIGTERM`, waits up to `STOP_GRACE_MS`, then `SIGKILL`.
- No restart-on-crash policy (`handleExit()` just sets `status='failed'` and
  logs); the proxy's own `fetch()` failure is the single source of truth for
  "is llama-server up", not a pre-check (`isReady()`), avoiding a TOCTOU race.
- `src/index.ts` calls `ensureBinary()` + `start()` non-fatally at boot
  (mirrors `app.sd.ensureBinary()`) and wires `stop()` into the shutdown
  handler; a failure here only logs a warning — image generation stays up.
- Binary resolution/install (`src/llm/installer.ts`) mirrors `SdInstaller`
  against `ggml-org/llama.cpp` releases, reusing `selectAsset()` from
  `src/sd/release.ts` unchanged. `src/util/spawn-env.ts` (loader-path env vars
  for the binary's sibling shared lib) was extracted out of `SdWrapper` so
  both binaries share it.

`src/routes/llm.ts` reverse-proxies `/v1/llm/*` to `llama-server` **byte for
byte** — one code path for both streaming and non-streaming, since the body is
never buffered or reshaped:

```
fetch(`${app.llm.baseUrl}${upstreamPath}`, { body, signal }) 
  → reply.raw.writeHead(upstream.status, { content-type })
  → pipeline(Readable.fromWeb(upstream.body), reply.raw)
```

Only `model` (+ `messages`/`prompt`/`input` per endpoint) is validated; every
other field rides through via `.passthrough()` zod schemas (`tools`,
`response_format`, multimodal `image_url` content parts, …) — without it,
`fastify-type-provider-zod` would silently strip unknown keys before
forwarding, since it replaces `request.body` with the *parsed* value.

**Gotcha — abort-on-disconnect must watch `reply.raw`, not `req.raw`/`req`**:
Node's `IncomingMessage` (`req.raw` on the Fastify side, or the analogous
`req` in the `fake-llama-server.mjs` test fixture) fires its `'close'` event
once the request body is fully read — **not** when the client actually
disconnects. Wiring the abort-controller to that event aborts the upstream
`fetch()` on every single request, immediately, before any response is
relayed (symptom: every proxied request silently comes back as an empty `200`
with no body). The response object (`reply.raw` / `res`) is what correctly
reflects the connection closing prematurely — listen there instead. This bit
both the production proxy and the test fixture identically; if a future
change touches either, re-verify with a live disconnect, not just
`app.inject()` (which can't model a real socket teardown at all).

`buildServer()` also sets `forceCloseConnections: true` on the Fastify
instance — without it, `app.close()` hangs indefinitely waiting for idle
keep-alive sockets (e.g. an OpenAI client's connection pool against
`/v1/llm/*`) to close on their own, which Node's default `server.close()`
never forces.

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
