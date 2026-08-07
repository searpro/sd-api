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
  (`app.llmDownloads`), `LlmCatalogManager`, `LogBuffer` (`app.logs`),
  `AudioServerManager` (`app.audio`), `AudioModelManager`
  (`app.audioModels`), a third `DownloadManager<AudioComponentType>`
  instance (`app.audioDownloads`), `AudioCatalogManager`
  (`app.audioCatalog`). Augmented onto `FastifyInstance` in `src/types.ts`.

## Request → image/video lifecycle

1. `POST /v1/jobs` (or `/v1/generate`) validates the body with
   `generateSchema` (`src/schemas/generate.ts`).
2. `JobManager.create()` enqueues; a concurrency-limited worker calls
   `SdWrapper.generate()`.
3. `resolveBundle(modelsDir, id)` (`src/models/bundle.ts`) finds the checkpoint
   + components, decides `loadMode` (`-m` full vs `--diffusion-model` split)
   and `mode` (`image` vs `video` — from the manifest, see below).
4. Manifest `defaults` merge under request params; input images
   (`init_image`/`mask`/`ref_images`) resolve to validated paths under `inputsDir`
   (Wan I2V's conditioning image reuses `init_image`, same as img2img).
5. `buildArgs()` (`src/sd/args.ts`) produces the argv (flag map + weights +
   edit flags + `--lora-model-dir` + manifest `extra_args`; `-M vid_gen` +
   `--video-frames`/`--flow-shift` when `bundle.mode === 'video'`).
6. `SdWrapper.run()` spawns `sd-cli` with `spawnEnv()` (lib path), streams
   stdout/stderr through `parseProgress()` (`src/sd/progress.ts`), enforces a
   timeout (`jobTimeoutMs`, or `videoJobTimeoutMs` for video — much
   longer-running), and on exit validates the output file (`.png` or `.webm`,
   picked by `bundle.mode` — sd-cli's `-o` for video only supports
   `.avi`/`.webm`/animated `.webp`, confirmed via `--help`; `.mp4` gets
   silently written as `<path>.avi` instead of erroring, which is why the
   file-existence check would otherwise "succeed" with nothing at the
   expected path).
7. Progress + completion are emitted as events; `GET /v1/jobs/:id/stream` relays
   them as SSE. `GenerateResult`/`Job.result` carry a `kind: 'image'|'video'`
   discriminant — routes populate `image_path`/`image_url` or
   `video_path`/`video_url` accordingly (the wire schema keeps both pairs
   optional rather than repurposing the image fields for video).

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
- **`mode: 'image' | 'video'`** (manifest, default `'image'`) is the sole
  switch for Wan T2V/I2V — no separate SUBDIRS entry or bundle shape needed
  since Wan fits the existing `diffusion-model` + `vae`/`t5xxl`/`clip_vision`
  layout. Wan2.2's dual-stage A14B (needs a *second* simultaneous checkpoint
  via `--high-noise-diffusion-model`) would need a new component slot — not
  implemented.

## sd-cli arg mapping (`src/sd/args.ts`)

`FLAG_MAP` (prompt/negative/steps/cfg/W/H/seed/sampler/video_frames/flow_shift)
+ `WEIGHT_FLAG` (vae/clip_l/clip_g/clip_vision/t5xxl/llm/llm_vision) + edit
flags (`-i`/`--strength`/`--mask`/`-r`/`--increase-ref-index`/`--img-cfg-scale`)
+ `--lora-model-dir` + `bundle.extraArgs`. `-M vid_gen` is prepended when
`bundle.mode === 'video'`. The prompt (incl. `<lora:…>` tags) is passed
verbatim as one argv element. Verify against the real CLI help when in doubt
— see the `sd-cli` binary's `--help` (flags drift between releases).

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

## Logs (`src/logs/buffer.ts`, `src/routes/logs.ts`)

`server.ts` builds the pino instance itself (rather than passing
`{ logger: {...} }` to `Fastify()`) so it can tee output two ways via
`pino.multistream()`: to `process.stdout` (unchanged terminal behavior) and
into a `LogBuffer` (an `EventEmitter` that also satisfies pino's
`DestinationStream` — just a `write(msg: string)` method). Fastify's
`logger` option is options-only and can't take a pre-built instance; the
separate `loggerInstance` option is what accepts it. The constructed logger
is explicitly typed `FastifyBaseLogger` before being passed in — leaving it
as the inferred concrete `pino.Logger<...>` type makes Fastify's `Logger`
generic default to that instead of `FastifyBaseLogger`, which breaks every
route plugin (all typed against the default).

`LogBuffer` keeps the last 2000 parsed records (in-memory, resets on
restart — same posture as jobs/downloads/catalog) and derives a `category`
per record at write time so neither the API nor the UI has to re-derive it:
`error` (an `err` field, `level >= 50`, or a completed request with
`statusCode >= 400` — most 4xx/5xx responses never call `.error()`, since
the `AppError`/`ZodError` branches in `setErrorHandler` don't), `healthcheck`
(`/health` requests), `http` (everything else completed), `sd-cli` /
`llama-server` (matched by the `msg` field child-process output logs under —
`'sd'` in `routes/generate.ts`, `'llama-server'` in
`llm/server-manager.ts`), else `app`. Fastify logs each request as two
separate lines correlated by `reqId` — `"incoming request"` (has `req.url`,
no status yet) and `"request completed"` (has `res.statusCode`, no `req`).
`LogBuffer` never stores the first: it holds a transient `reqId → url` map
just long enough to tag the second line, which roughly halves buffered
volume for free.

`routes/logs.ts` follows the same "replay then subscribe" SSE shape as jobs
and downloads (`GET /v1/logs` for a filtered snapshot, `GET /v1/logs/stream`
for the replay burst + live tail), except it subscribes to one shared
`LogBuffer` instance rather than a `Map<id, EventEmitter>` — there's no
per-resource id here, just one process-wide log stream.

## Catalog (`src/catalog/`, `src/llm-catalog/`, `src/audio-catalog/`)

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

`audio-catalog/` is the same shape again, smaller still (4 entries to start —
spans TTS and ASR, deliberately not attempting audio.cpp's full 40+ family
surface at once). All four point into audio.cpp's own community GGUF
mono-repo, `audio-cpp/audio.cpp-gguf` — one repo, per-family sub-folders —
verified against that repo's real file listing rather than guessed, same
diligence bar as the LLM catalog's repo ids. Each `AudioCatalogModel` carries
`family`/`task` (and optional `mode`) directly, matching the exact
`model_specs/<family>.json` identifiers from the audio.cpp repo (confirmed
from source, not inferred) — `AudioCatalogManager` doesn't need `hf.ts`
extended at all, since `listComponentFiles()` was already generic; only the
shard-exclusion filter carries over (defensively — no sharded audio.cpp GGUF
package has actually been observed), since there's no mmproj/draft-file
equivalent on the audio side. The install flow (UI and API) writes the
catalog entry's `family`/`task` into `model.json` automatically — unlike a
hand-authored install, the user never has to know or type them.

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

## Audio generation (`src/audio/`, `src/routes/audio.ts`)

Same persistent-process-and-reverse-proxy shape as LLM serving, not
`sd-cli`'s per-request spawn — `audiocpp_server` (audio.cpp) is itself a
long-running HTTP server with OpenAI-audio-shaped endpoints
(`/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/audio/voices`).
`AudioServerManager` (`src/audio/server-manager.ts`) is `LlamaServerManager`
copied almost line-for-line — same `startPromise` coalescing guard, same
`/health` poll loop, same `SIGTERM`-then-`SIGKILL` stop, same
non-restart-on-crash policy (the proxy's own `fetch()` failure is the source
of truth for "is it up", not a pre-check).

**The one real divergence**: `llama-server` auto-discovers GGUF files from
`--models-dir`; `audiocpp_server` has no directory-scan equivalent — it loads
an explicit JSON model registry via `--config`. `src/audio/config-gen.ts`
generates that file by scanning `audioModelsDir` for bundles carrying a
`model.json` manifest (`{family, task, mode?}` — information that can't be
inferred from files alone, so an unregistered bundle is silently skipped,
not fatal) and writes it to `<dirname(audioModelsDir)>/audio-server-config.generated.json`.
`AudioServerManager.doStart()` calls this **before every spawn/restart**, so
`scheduleRestart()` (same debounced-restart-after-download pattern as LLM)
both regenerates the registry and restarts in one step — a newly-downloaded
model becomes servable without any change to the trigger point LLM already
established.

**Gotcha (confirmed by actually building and running the real binary, not
just reading its docs) — `audiocpp_server` hard-refuses to start with an
empty `models` array** (`"server config requires a non-empty models
array"`, exit 1), unlike `llama-server`, which is perfectly happy to start
with zero GGUF files and just serve an empty registry. `doStart()` checks
`writeAudioServerConfig()`'s returned `modelIds` *before* spawning: if
empty, it skips the spawn/health-poll cycle entirely, leaves `status`
`'stopped'`, and returns normally rather than throwing — a fresh install
with no audio models yet is an expected state, not a startup failure. The
next `scheduleRestart()` after the first model's manifest lands regenerates
a non-empty config and spawns for real.

`src/routes/audio.ts` reverse-proxies the same way `routes/llm.ts` does
(`fetch` → `pipeline(Readable.fromWeb(...), reply.raw)`, one code path for
JSON/binary/SSE alike, `reply.raw` — not `req.raw` — is what abort-on-
disconnect must watch; see the LLM section above for why). One addition:

**Multipart transcription uploads are forwarded raw, not re-parsed.**
`@fastify/multipart` is registered globally (`server.ts`, for `/v1/inputs`),
but content-type parsers are cloned per encapsulated plugin context (`fastify/
lib/content-type-parser.js`'s `buildContentTypeParser()`), so `audioRoutes`
can safely swap in a no-op parser for `multipart/form-data` scoped to just
its own routes — `/v1/inputs` is unaffected. The clone already *contains*
the inherited global parser at the point `audioRoutes` registers, though, so
`addContentTypeParser()` alone throws `FST_ERR_CTP_ALREADY_PRESENT`;
`removeContentTypeParser()` must run first in that same scope. With the
no-op in place, the handler reads `req.raw` directly — still an unconsumed
stream, since the parser never touched it — and forwards it as the upstream
`fetch()`'s body via `Readable.toWeb(req.raw)` with `duplex: 'half'`, letting
`audiocpp_server`'s own multipart parsing see the exact bytes the client
sent (boundary and all) instead of us decoding and re-encoding a form we
have no need to inspect.

**Binary install**: `src/audio/installer.ts` mirrors `LlamaInstaller`/
`SdInstaller` exactly (stage → extract → chmod → atomic rename), reusing
`selectAsset()` unchanged — but upstream audio.cpp's releases are
Windows-only as of this writing, so `selectAsset()` throwing on Linux/macOS
against the default repo is expected, not a bug. Unlike `LlamaInstaller`/
`SdInstaller`, the releases repo is configurable
(`AudioInstallerConfig.releasesRepo`, defaulting to `0xShug0/audio.cpp`, set
from `config.audioReleasesRepo`/`SD_AUDIO_RELEASES_REPO`) specifically so a
fork/mirror publishing Linux/macOS builds can be pointed at without a code
change, once one exists — confirmed viable by actually building from source
(`scripts/build_linux.sh --backend cpu --native-cpu OFF --deployment-build`)
and running the result against a real `AudioServerManager`; no CMake-invoking
installer was added (a materially bigger undertaking than "download a
release zip", and not something either other backend does), just this hook
for wherever the eventual build ends up.

### Model management (`src/audio-models/`, `src/routes/audio-models.ts`, `src/routes/audio-downloads.ts`)

`AudioModelManager` (`src/audio-models/manager.ts`) is `LlmModelManager`
copied structurally — flat `<audioModelsDir>/<id>/<files...>` layout,
`implements ComponentPathResolver<AudioComponentType>` so it plugs straight
into the existing generic `DownloadManager<TType>` as its third domain (image
models, LLM models, now audio models — no changes needed to `DownloadManager`
or the resolver interface itself, exactly the "one generic engine, N
domains" the Downloads section above describes). `AudioComponentType =
'weights' | 'aux'` — deliberately coarser than the LLM side's `'gguf' |
'mmproj'`, since audio.cpp families vary widely in what auxiliary files they
need (tokenizer/vocoder/speaker-embedding), so there's no single second role
worth naming; `bundle.ts`'s `AudioBundleInfo` reflects this by listing every
real file generically (`files: AudioComponentFile[]`) rather than picking out
"the weights file" the way `inspectLlmBundle()` does for `.gguf`.

**The one real divergence from `LlmModelManager`**: `model.json` is
*required*, not an optional display-name sidecar — `writeManifest()` rejects
a manifest missing `family`/`task` (`errors.invalidModel`, mirrored at the
route layer by a required zod schema), since those two fields are what
`config-gen.ts` (above) needs to ever register the bundle. `fileNameFor()`
also refuses the literal filename `"model.json"` (case-insensitive) — without
that guard, a component download with an attacker- or mistake-supplied
`name` could silently overwrite the manifest sidecar it lives next to.

`AudioModelManager`'s `ALLOWED_EXT` is broader than the LLM side's
GGUF-only set (`.gguf`, `.safetensors`, `.json`, `.bin`, `.pt`, `.txt`) to
cover the heterogeneous auxiliary files real families need — archive
extraction (`.zip`/`.tar.gz`) is explicitly not supported, since
`DownloadManager` has no post-download processing step; a catalog entry
whose package requires one simply isn't a fit for this app today.

`src/server.ts` wires a second `DownloadManager<AudioComponentType>`
instance (`app.audioDownloads`) with the same `onSettle` → `scheduleRestart()`
hook LLM downloads use, and `routes/audio-models.ts` / `routes/audio-downloads.ts`
mirror their `llm-models.ts` / `llm-downloads.ts` counterparts endpoint for
endpoint.

**Gotcha (found while wiring this up, not audio-specific) — `pino.multistream()`
does not inherit the logger's own level.** `server.ts` builds the pino
instance as `pino({ level: config.logLevel }, pino.multistream([...]))` to
tee output to stdout and `LogBuffer`; each stream entry in that array
defaults to level `'info'` unless given its own explicit `level`, silently
overriding `config.logLevel` for *every* destination. In practice this meant
`this.log.debug(...)` — which every child-process line (`sd-cli`,
`llama-server`, and now `audio-server`) is logged at — never reached stdout
*or* the log buffer, regardless of `SD_LOG_LEVEL`, even before this feature
existed. Both stream entries now pass `level: config.logLevel` explicitly.

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
- Reuse: `errors.*`, `safeResolve`/`assertSafeName`, `uniqueOutputName`,
  `parseProgress`, `DownloadManager` for any new downloadable artifact.
- In-memory state only (unless explicitly asked otherwise).
