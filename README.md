# sd-api

An HTTP API server that wraps the [`stable-diffusion.cpp`](https://github.com/leejet/stable-diffusion.cpp)
CLI for text-to-image generation. The `sd` binary is treated as a black box and
driven via `child_process.spawn` — no native bindings required.

Built with **Fastify**, **zod** (validation + OpenAPI schemas), and **pino** (logging).

## Features (by phase)

| Phase | Capability | Endpoints |
| ----- | ---------- | --------- |
| 1–2 | Text-to-image, fully parameterized | `POST /v1/generate` |
| 3 | Model management (list / download / delete) | `GET/POST/DELETE /v1/models` |
| 4 | Async job system (in-memory, concurrency-limited) | `POST/GET/DELETE /v1/jobs` |
| 5 | Real-time progress via Server-Sent Events | `GET /v1/jobs/:id/stream` |
| 6 | Image serving (binary or base64) | `GET /v1/outputs/:name` |
| 7 | Config (file + env) | — |
| 8 | OpenAPI 3.1 docs + Swagger UI | `GET /docs` |
| UI | Thin web console (generation + model management) | `GET /` |
| Catalog | Guided model downloads (format + quantization) | `GET /v1/catalog` |
| Editing | img2img + reference-image editing (single/multi) | `POST /v1/inputs` |
| Downloads | Background downloads w/ progress + resume | `GET /v1/downloads` |
| LoRA | Per-model LoRAs, prompt-activated `<lora:name:1>` | `type: lora` |

## Prerequisites

- Node.js >= 20.

The `stable-diffusion.cpp` CLI is **not required up front**: on startup the
server checks whether the configured binary is available and, if not,
downloads the prebuilt release matching the host OS/arch (see
[Binary auto-install](#binary-auto-install)). To use your own build instead,
point `SD_BINARY_PATH` at it and the download is skipped.

## Binary auto-install

When the app initializes, `SdWrapper.ensureBinary()` runs:

1. **Check** if `SD_BINARY_PATH` resolves to an executable — either an explicit
   path or a bare command found on `PATH`.
2. If it does, use it. If not and `SD_AUTO_INSTALL` is enabled, query the
   [stable-diffusion.cpp releases](https://github.com/leejet/stable-diffusion.cpp/releases),
   select the asset for `process.platform` / `process.arch` (and `SD_ACCEL`),
   download + extract it under `SD_INSTALL_DIR`, and repoint the config at the
   unpacked CLI for this process.
3. If the binary is still unavailable (e.g. offline, auto-install off), the
   server still boots — only generation fails until a binary is present.

Notes:
- Asset names embed drifting version numbers, so selection matches by
  OS/arch/accel keyword rather than an exact filename
  ([`src/sd/release.ts`](src/sd/release.ts)).
- The CLI binary is named `sd-cli` and ships beside a shared library
  (`libstable-diffusion.so` / `.dylib` / `.dll`) whose `RUNPATH` points at the
  build machine. The whole archive is extracted in place and the binary's own
  directory is added to the loader path (`LD_LIBRARY_PATH` / `DYLD_*` / `PATH`)
  when spawning, so it runs from any working directory.
- The GitHub API rate-limits unauthenticated requests to 60/hr. Set
  `GITHUB_TOKEN` (or `GH_TOKEN`) to raise that to 5000/hr if you hit it.
- `SD_ACCEL` selects the hardware backend: `cpu` (default), `vulkan`, `cuda`,
  or `rocm`. The matching accelerated build is chosen when available.

## Quick start

```bash
npm install
cp .env.example .env        # then edit SD_BINARY_PATH etc.
npm run build && npm start  # or: npm run dev
```

Drop a model into a bundle (e.g. `<models_dir>/my-model/checkpoint/model.gguf`,
or a single `<models_dir>/my-model.gguf` for a full checkpoint), then:

```bash
curl -X POST localhost:3000/v1/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"a futuristic city","model":"sdxl-base.gguf","steps":20,"cfg_scale":7}'
```

Web console: <http://localhost:3000/> · Interactive API docs: <http://localhost:3000/docs>.

## Web UI

A dependency-free, single-file frontend is served at `/` (no build step —
`public/index.html` talking to the same API). It covers:

- **Generate** — pick a checkpoint, set prompt / negative prompt / steps /
  CFG / width / height / seed / sampler, submit as an async job, and watch
  live SSE progress (bar + step count + log tail) until the image renders.
  Includes cancel.
- **Catalog** — browse supported models and choose format + quantization per
  component, then download + install as a bundle in one click.
- **Models** — list installed models with size/type, delete them, and
  download new components (checkpoint/vae/clip) by URL into a model bundle.

It uses only the public endpoints (`/v1/jobs`, `/v1/jobs/:id/stream`,
`/v1/models`, `/v1/outputs/...`), so it works against any deployment.

## Configuration (Phase 7)

Resolved in order (later wins): `config/default.json` → `config/local.json` → `SD_*` env vars.

| Env var | Config key | Default | Meaning |
| ------- | ---------- | ------- | ------- |
| `SD_BINARY_PATH` | `sd_binary_path` | `sd` | Path to the CLI binary (or a bare command on `PATH`) |
| `SD_AUTO_INSTALL` | `auto_install` | `true` | Download a prebuilt release if the binary is missing |
| `SD_INSTALL_DIR` | `install_dir` | `./data/bin` | Where downloaded binaries are unpacked |
| `SD_RELEASE_TAG` | `release_tag` | `latest` | Release to install (`latest` or a specific tag) |
| `SD_ACCEL` | `accel` | `cpu` | Backend: `cpu`, `vulkan`, `cuda`, `rocm` |
| `SD_MODELS_DIR` | `models_dir` | `./data/models` | Root holding per-model bundle directories |
| `SD_OUTPUTS_DIR` | `outputs_dir` | `./data/outputs` | Generated images |
| `SD_HOST` / `SD_PORT` | `host` / `port` | `0.0.0.0` / `3000` | Listen address |
| `SD_MAX_CONCURRENT_JOBS` | `max_concurrent_jobs` | `2` | Generation queue concurrency |
| `SD_MAX_CONCURRENT_DOWNLOADS` | `max_concurrent_downloads` | `2` | Download queue concurrency |
| `SD_JOB_TIMEOUT_MS` | `job_timeout_ms` | `600000` | Per-process hard timeout |
| `SD_MAX_IMAGE_DIM` | `max_image_dim` | `2048` | Max width/height accepted |
| `SD_LOG_LEVEL` | `log_level` | `info` | pino level |
| `GITHUB_TOKEN` | — | — | Optional; raises GitHub API rate limit for auto-install |

## Models directory layout — per-model bundles

Each model is a **bundle**: its own directory under `<models_dir>/` carrying its
components. The `"model"` request field is the bundle id (the directory name).

```
<models_dir>/
  z-image-turbo/
    model.json            # optional manifest (overrides auto-detection)
    checkpoint/           # the diffusion model / full checkpoint
      z_image_turbo-Q2_K.gguf
    vae/                  # optional standalone VAE
      z_image_vae.safetensors
    clip/                 # optional text encoders: clip_l, clip_g, t5xxl, llm, clip_vision
      qwen3-4b.gguf
    lora/                 # optional LoRA weights, applied via the prompt
      lineart.safetensors
  sdxl.gguf               # a single file at the root = a full checkpoint
```

### How components are wired to sd-cli

At generation time the bundle is resolved and the right flags are emitted
automatically:

- **Checkpoint** → `-m` for a **full** checkpoint, or `--diffusion-model` for a
  **standalone diffusion model**. Auto-detected: if the bundle has a `vae/` or
  `clip/` component it is treated as a split model (`--diffusion-model`),
  otherwise a full model (`-m`).
- **VAE** (`vae/`) → `--vae`.
- **Text encoders** (`clip/`) → `--clip_l`, `--clip_g`, `--t5xxl`, `--llm`, or
  `--clip_vision`, with each file's role inferred from its filename
  (`clip_l…`, `t5xxl…`, `qwen…`/`mistral…` → `llm`, …).

This is why a split model like **Z-Image Turbo** now works: dropping its
diffusion gguf, VAE and Qwen text encoder into the bundle produces
`sd-cli --diffusion-model … --vae … --llm … -p …` instead of just `-m …`.

### `model.json` manifest (optional)

Drop a manifest in the bundle to override auto-detection:

```jsonc
{
  "name": "Z-Image Turbo",
  "load": "diffusion-model",        // or "model", or "auto" (default)
  "components": {                    // pin specific files / roles
    "checkpoint": "z_image_turbo-Q2_K.gguf",
    "vae": "z_image_vae.safetensors",
    "llm": "qwen3-4b.gguf"
  },
  "defaults": { "steps": 8, "cfg_scale": 1, "sampler": "euler" }
}
```

`defaults` are applied to any generation request that omits those fields.

## Model catalog (guided downloads)

Rather than hunting for URLs, the **Catalog** tab lets users pick a supported
model and choose the **format** (`safetensors` / `gguf`) and **quantization**
for each component, then installs it as a ready-to-use bundle.

The catalog itself is a small curated dataset
([`src/catalog/data.ts`](src/catalog/data.ts)) built from the upstream
[docs](https://github.com/leejet/stable-diffusion.cpp/tree/master/docs): each
model maps its components (checkpoint / vae / clip / llm …) to HuggingFace
repos. The actual files and their quantizations are listed **live** via the HF
Hub API, so the options stay current as new quants are published (no giant
hardcoded URL list to maintain).

```bash
curl localhost:3000/v1/catalog                      # curated models + components
curl localhost:3000/v1/catalog/z-image-turbo/files  # live file/quant options per component (HF)
```

Install flow (what the UI does, and you can script):

1. `PUT /v1/models/<name>/manifest` — write `model.json` with the load mode,
   role→filename mapping and default params.
2. `POST /v1/models/download` once per chosen component (checkpoint/vae/clip).
   This enqueues a **background download** (see below) and returns immediately.

Included models (txt2img): SD 1.5 / 2.1, SDXL base / Turbo, SSD-1B, Segmind
Vega, SD3 Medium, SD 3.5 Large, HiDream-O1-Image, FLUX.1 dev/schnell, FLUX.2
dev/klein-4B/klein-9B, Chroma, Chroma1-Radiance, Lens, Qwen-Image, LongCat-Image,
Ovis-Image, Anima, ERNIE-Image (+ Turbo), Boogu-Image, Z-Image (+ Turbo).
Image-edit models (Kontext, Qwen-Image-Edit, …), video models (Wan, LTX-2.3),
PiD and Ideogram4 are omitted because the generation pipeline here is txt2img.
Extend by adding entries to `src/catalog/data.ts`. Set `HF_TOKEN` to raise the
HuggingFace API rate limit used for the file listings.

## Background downloads (progress + resume)

Model-component downloads run as background tasks with byte-level progress and
**resume** support, so multi-GB weights survive interruptions.

- `POST /v1/models/download` enqueues a task and returns it immediately (202).
  Concurrency is capped by `SD_MAX_CONCURRENT_DOWNLOADS`.
- `GET /v1/downloads` (optionally `?model=<id>`) / `GET /v1/downloads/:id` —
  status: `queued | downloading | completed | failed | cancelled`, plus
  `received` / `total` bytes.
- `GET /v1/downloads/:id/stream` — SSE progress.
- `POST /v1/downloads/:id/cancel` — stop a running download, keeping its
  `.part` file for later resuming.
- `POST /v1/downloads/:id/retry` — resume a failed/cancelled download.
- `POST /v1/downloads/resume` `{model,type,name}` — resume an on-disk partial
  (e.g. after a server restart).
- `DELETE /v1/downloads/:id?discard=true` — drop the task (and the partial).

How resume works: each download streams to `<file>.part` with a `<file>.part.json`
sidecar recording the source URL + total size. On resume the manager sends an
HTTP `Range` request from the current `.part` size and appends; if the server
ignores the range it restarts cleanly. The `.part` is promoted to the final
filename only on success, so interrupted downloads never look like valid
components. `GET /v1/models` reports leftover partials per bundle (`partials[]`),
and the web UI shows per-file status with cancel / resume / discard controls.

> The model catalog's "Install" enqueues all components at once and shows live
> per-file progress; a failed file can be resumed from the Models tab.

## LoRA

LoRAs are **per-model**: each lives in the model bundle's `lora/` sub-directory
and is activated from the prompt, matching stable-diffusion.cpp.

- Add a LoRA to a model by downloading it (same background download flow):
  `POST /v1/models/download` with `{ "model": "flux1-dev", "type": "lora", "url": "https://.../lineart.safetensors" }`.
- `GET /v1/models/<id>` lists the bundle's `loras[]` as `{ name, ref, size }`,
  where `ref` is the filename without extension.
- At generation the wrapper passes `--lora-model-dir <bundle>/lora` whenever the
  model has any LoRA files. Activate one by putting `<lora:ref:multiplier>` in
  the prompt, e.g. `a lovely cat <lora:lineart:0.8>`.

In the web UI, the Generate tab shows the selected model's LoRAs as chips —
clicking one inserts `<lora:ref:1>` into the prompt at the cursor. The Models
tab lists/downloads/deletes LoRAs like any other component (`type: lora`).

## Image editing / img2img

The same txt2img pipeline drives editing — you just pass reference image(s).

1. Upload images: `POST /v1/inputs` (multipart `file`, one or more) →
   `{ inputs: [{ name, size }] }`. Retrieve with `GET /v1/inputs/:name`.
2. Reference them by name in a generation request:
   - `ref_images: ["<name>", …]` → repeated `-r` (edit models: FLUX.1-Kontext,
     Qwen-Image-Edit, …). `increase_ref_index: true` for multi-image edits
     (Qwen-Image-Edit-2509).
   - `init_image` + `strength` → `-i` / `--strength` (img2img).
   - `mask` → `--mask` (inpaint). `img_cfg_scale` → `--img-cfg-scale`.

Edit models in the catalog are flagged `edit: true` and install a `model.json`
with any model-specific flags via `extra_args` (e.g. Qwen-Image-Edit-2511 sets
`--qwen-image-zero-cond-t`). The web UI's Generate tab has an "Image editing /
img2img" panel for uploading reference / init images.

Catalog edit models: FLUX.1-Kontext-dev, Qwen-Image-Edit, Qwen-Image-Edit-2509
(multi-ref), Qwen-Image-Edit-2511.

## API overview

### `POST /v1/generate` — synchronous generation

```jsonc
{
  "prompt": "a futuristic city",     // required
  "model": "z-image-turbo",           // required: bundle id (dir name) or a model file
  "negative_prompt": "blurry",
  "steps": 20,                        // omitted fields fall back to the bundle's manifest defaults
  "cfg_scale": 7,
  "width": 512,
  "height": 512,
  "seed": 1234,
  "sampler": "euler_a"
}
```

VAE and text encoders are **not** passed per request — they are resolved from
the model bundle automatically (see the layout section above).

Response:

```json
{
  "image_path": "/abs/path/to/outputs/....png",
  "image_url": "/v1/outputs/....png",
  "metadata": { "prompt": "...", "model": "...", "duration_ms": 1234 }
}
```

### Async jobs + streaming (Phases 4–5)

```bash
ID=$(curl -s -X POST localhost:3000/v1/jobs -H 'content-type: application/json' \
      -d '{"prompt":"a cat","model":"sdxl-base.gguf","steps":20}' | jq -r .id)

curl localhost:3000/v1/jobs/$ID            # { "status": "running", "progress": 0.45 }
curl -N localhost:3000/v1/jobs/$ID/stream  # SSE: progress events then complete/error
```

### Models (bundles)

```bash
curl localhost:3000/v1/models                 # list bundles + their components
curl localhost:3000/v1/models/z-image-turbo   # one bundle

# Create an empty bundle (checkpoint/ vae/ clip/)
curl -X POST localhost:3000/v1/models -H 'content-type: application/json' \
  -d '{"model":"z-image-turbo"}'

# Download a component into a bundle (auto-creates it if new)
curl -X POST localhost:3000/v1/models/download -H 'content-type: application/json' \
  -d '{"model":"z-image-turbo","type":"checkpoint","url":"https://.../z_image_turbo-Q2_K.gguf"}'
curl -X POST localhost:3000/v1/models/download -H 'content-type: application/json' \
  -d '{"model":"z-image-turbo","type":"vae","url":"https://.../z_image_vae.safetensors"}'
curl -X POST localhost:3000/v1/models/download -H 'content-type: application/json' \
  -d '{"model":"z-image-turbo","type":"clip","url":"https://.../qwen3-4b.gguf"}'

curl -X DELETE localhost:3000/v1/models/z-image-turbo                       # whole bundle
curl -X DELETE localhost:3000/v1/models/z-image-turbo/vae/z_image_vae.safetensors  # one file
```

## CLI flag mapping (Spec section 3)

API parameters map directly to `stable-diffusion.cpp` flags in
[`src/sd/args.ts`](src/sd/args.ts) via a single data-driven table:

| API | CLI flag |
| --- | -------- |
| `prompt` | `-p` |
| `negative_prompt` | `-n` |
| `model` (checkpoint) | `-m` (full) or `--diffusion-model` (split) |
| bundle `vae/` | `--vae` |
| bundle `clip/` | `--clip_l` / `--clip_g` / `--t5xxl` / `--llm` / `--clip_vision` |
| `steps` | `--steps` |
| `cfg_scale` | `--cfg-scale` |
| `width` / `height` | `-W` / `-H` |
| `seed` | `-s` |
| `sampler` | `--sampling-method` |
| `vae` / `clip_l` / `clip_g` / `t5xxl` | `--vae` / `--clip_l` / `--clip_g` / `--t5xxl` |

Arguments are passed as a discrete argv array — never a shell string — so prompt
text cannot inject extra flags or shell commands.

## Error format (Spec section 4)

```json
{ "error": { "code": "MODEL_NOT_FOUND", "message": "Model not found: x.gguf" } }
```

Codes: `VALIDATION_ERROR`, `MODEL_NOT_FOUND`, `INVALID_MODEL`, `MISSING_WEIGHTS`,
`GENERATION_FAILED`, `PROCESS_TIMEOUT`, `BINARY_NOT_FOUND`, `JOB_NOT_FOUND`,
`OUTPUT_NOT_FOUND`, `INVALID_PATH`, `DOWNLOAD_FAILED`, `INTERNAL_ERROR`.

## Security (Spec section 5)

- All model/output names are validated against directory traversal (`src/util/paths.ts`).
- Image dimensions are capped (`SD_MAX_IMAGE_DIM`).
- Concurrent jobs are bounded; each process has a hard timeout (`SIGKILL`).
- Downloads validate URL protocol + file extension and stream to a temp file.

## Project layout

```
src/
  index.ts          # entry: load config, build server, listen
  server.ts         # Fastify app: services, swagger, error handling, routes
  config.ts         # config resolution (file + env, zod-validated)
  errors.ts         # AppError + structured error codes
  schemas/          # zod request/response schemas
  sd/               # CLI wrapper, arg mapping, progress parsing,
                    #   release selection + auto-installer
  models/           # bundle resolver + model manager (list/delete/paths)
  downloads/        # background download manager (progress + resume)
  catalog/          # curated model catalog + HuggingFace file listing
  jobs/             # in-memory job queue + manager
  routes/           # generate, jobs, models, outputs, health
  util/             # path safety, filename, validation
public/             # thin web UI (single static index.html, no build step)
test/               # vitest unit + integration tests (uses a fake `sd` binary)
```

## Development

```bash
npm run dev        # watch mode (tsx)
npm run typecheck
npm test           # vitest — runs against a stub `sd` binary, no model needed
```

Contributing / AI agents: start with **CLAUDE.md** (conventions + invariants)
and **docs/ARCHITECTURE.md** (internals). The repo ships Claude Code config under
`.claude/` — skills (`add-catalog-model`, `sd-cli-args`, `local-verify`) and
commands (`/check`, `/new-route`).

## Future extensions (not yet implemented)

ControlNet, persistent job/download store, GPU scheduling, distributed workers,
video models (Wan, LTX-2.3), externalized catalog (designed, deferred).
