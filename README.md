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
| HF auth | Token (env) for gated/private models + verify | `GET /v1/auth/hf` |
| LoRA | Per-model LoRAs, prompt-activated `<lora:name:1>` | `type: lora` |
| LLM | OpenAI-compatible LLM/VLM serving via llama.cpp, streaming | `POST /v1/llm/chat/completions` |
| LLM catalog | Guided LLM downloads (curated GGUF models, < 30B) | `GET /v1/llm-catalog` |
| LLM models | LLM bundle management + background downloads | `GET /v1/llm-models` |
| Audio | OpenAI-style TTS/transcription via audio.cpp (proxy) | `POST /v1/audio/speech` |

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
cp .env.example .env        # then edit SD_BINARY_PATH, SD_PORT, etc.
npm run build && npm start  # or: npm run dev
```

`.env` (project root, git-ignored) is loaded automatically at startup via
`dotenv/config` — no extra flags needed. A real environment variable (set by
your shell, Docker, systemd, CI, …) always takes precedence over the same key
in `.env`. To run on a different port, either set `SD_PORT` in `.env` or export
it: `SD_PORT=8080 npm start`.

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
- **LLM** — chat against any installed model (streaming), install more from
  the LLM catalog, and manage LLM bundles — three sub-tabs mirroring the
  Generate/Catalog/Models flow above for `llama-server`.
- **Audio** — a Speak/Transcribe playground (type text and hear it back, or
  upload a file and see the transcript), plus Models and Catalog sub-tabs for
  audio.cpp — same install flow as the LLM tab.
- **Logs** — a live tail of the app's own logs (requests, errors,
  health-checks, `sd-cli`/`llama-server`/`audio-server` child-process
  output), filterable by category, so terminal-only NDJSON isn't the only way
  to see what's happening. See [Live logs](#live-logs-v1logs) below.

It talks to the same public API documented throughout this file (jobs,
models, LLM, audio, logs, ...), so it works against any deployment.

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
| `SD_OUTPUTS_DIR` | `outputs_dir` | `./data/outputs` | Generated images and (non-streaming) generated speech audio |
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

## HuggingFace authentication

Some models are **gated** (license-accept required) or **private**; downloading
them — and listing their files in the catalog — needs a HuggingFace token.

**Phase 1 (current): token from the environment.**

1. Create a token at <https://huggingface.co/settings/tokens> (read scope is
   enough) and, for each gated model, accept its license on the model page.
2. Set it for the server: `HF_TOKEN=hf_xxx` (or `HUGGING_FACE_HUB_TOKEN`).
3. The token is attached as a Bearer header on HuggingFace requests only — the
   catalog file listing (`src/catalog/hf.ts`) and model downloads
   (`src/downloads/manager.ts`). It is never sent to a non-HuggingFace host
   (e.g. a CDN redirect target).

Check / verify:

```bash
curl localhost:3000/v1/auth/hf          # { configured, source, masked }
curl -X POST localhost:3000/v1/auth/hf/verify   # whoami -> { ok, user: { name } }
```

The web UI's **Catalog** tab shows a HuggingFace status badge with a **Verify**
button. When a download fails on a gated/private model, the error explains that
`HF_TOKEN` is needed and the license must be accepted.

> **Phase 2 (planned): OAuth in the UI.** Let a user connect their HuggingFace
> account from the browser instead of an env var. The plumbing is ready — the
> token resolver (`src/util/hf-auth.ts`) already supports an in-memory override
> via `setHfToken()`; a future `POST /v1/auth/hf` (+ HF OAuth callback) would set
> it at runtime. See `docs/ARCHITECTURE.md` → "HuggingFace auth".

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

## LLM serving (llama.cpp)

Alongside image generation, sd-api also serves LLMs (including vision-language
models) via an embedded [`llama-server`](https://github.com/ggml-org/llama.cpp)
process, exposed as a strict **OpenAI-compatible** API at `/v1/llm/*`.

`llama-server` runs in **router mode**: it's started once (no `-m` flag),
auto-discovers GGUF models under the configured LLM models directory, and
loads/routes each request by the `"model"` field in the JSON body — the same
way an OpenAI-compatible client already expects. sd-api reverse-proxies
`/v1/llm/*` to it byte-for-byte (streaming and non-streaming alike), so any
OpenAI SDK client works unmodified by pointing `base_url` at `.../v1/llm`.

A curated **catalog** of popular GGUF-quantized LLMs (< 30B params, including
several vision-language models) is browsable and installable straight from the
UI or API — same guided-download flow as the image-model catalog, resolving
real files/quantizations live from HuggingFace. LoRA/preset/restart-policy
support for `llama-server` remain future work.

### Quick start

```bash
# Place a GGUF model (and an optional mmproj-*.gguf for vision) under the LLM
# models directory (default ./data/llm-models), e.g.:
mkdir -p ./data/llm-models/qwen3-4b
cp ~/downloads/qwen3-4b-Q4_K_M.gguf ./data/llm-models/qwen3-4b/

npm start   # llama-server is auto-installed and started alongside sd-api
```

The model id an OpenAI client passes as `"model"` is simply the subdirectory
name under the LLM models directory (`qwen3-4b` above).

### OpenAI Python client

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1/llm", api_key="unused")

resp = client.chat.completions.create(
    model="qwen3-4b",
    messages=[{"role": "user", "content": "Explain diffusion models in one sentence."}],
)
print(resp.choices[0].message.content)
```

### Streaming

```bash
curl -N localhost:3000/v1/llm/chat/completions -H 'content-type: application/json' -d '{
  "model": "qwen3-4b",
  "messages": [{"role": "user", "content": "Count to 5."}],
  "stream": true
}'
# data: {"choices":[{"delta":{"content":"1"},...}]}
# ...
# data: [DONE]
```

### Vision / multimodal

For a model paired with an `mmproj-*.gguf` vision projector, pass image
content parts exactly as documented by llama.cpp — a remote URL, a local
file path, or an inline base64 data URI:

```bash
curl localhost:3000/v1/llm/chat/completions -H 'content-type: application/json' -d '{
  "model": "qwen2.5-vl",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What is in this image?"},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KG..."}}
    ]
  }]
}'
```

### Endpoints

All strictly OpenAI-shaped and proxied to `llama-server` unmodified:

| Endpoint | Notes |
| --- | --- |
| `POST /v1/llm/chat/completions` | Streaming (`stream:true`) and multimodal content parts |
| `POST /v1/llm/completions` | Legacy text completions |
| `POST /v1/llm/embeddings` | Embeddings |
| `GET /v1/llm/models` | Lists models discovered by `llama-server` |

`/v1/llm/*` is reserved exclusively for this OpenAI-compatible surface — our
own LLM bundle/catalog management lives at the flat siblings below, not
nested under `/v1/llm/`.

### Model management (`/v1/llm-models`)

Each LLM model is a flat bundle directory — no checkpoint/vae/clip split like
the image side, since llama.cpp doesn't need one:

```
<llmModelsDir>/
  qwen3-8b/
    model.json               # optional sidecar (display name only)
    Qwen_Qwen3-8B-Q4_K_M.gguf
  gemma-3-4b-it/
    google_gemma-3-4b-it-Q4_K_M.gguf
    mmproj-google_gemma-3-4b-it-f16.gguf   # vision projector (VLM)
```

```bash
curl localhost:3000/v1/llm-models                 # list installed bundles
curl -X POST localhost:3000/v1/llm-models \
  -d '{"model":"qwen3-8b"}' -H 'content-type: application/json'
curl -X POST localhost:3000/v1/llm-models/download -H 'content-type: application/json' \
  -d '{"model":"qwen3-8b","type":"gguf","url":"https://.../Qwen_Qwen3-8B-Q4_K_M.gguf"}'
curl -X DELETE localhost:3000/v1/llm-models/qwen3-8b
```

Downloads run through the same background download engine as the image side
(progress, resume, cancel) via `/v1/llm-downloads` — `DownloadManager` was
generalized to a `ComponentPathResolver<TType>` interface so both domains
share one tested implementation (see `docs/ARCHITECTURE.md`).

### Model catalog (`/v1/llm-catalog`)

A curated catalog of popular open-weight LLMs
([`src/llm-catalog/data.ts`](src/llm-catalog/data.ts)) spanning two
deployment tiers — each entry carries a `tier` (`mac` / `cloud` / `both`,
default `both`) plus `params`/`activeParams` so the UI and API can surface
"what will this actually cost to run":

- **`mac`** — fits comfortably in ~24GB unified memory (M-series Mac) at a
  reasonable quant. Mostly dense models ≤ 14B, or MoE models with a small
  total footprint (e.g. `gpt-oss-20b`, `Qwen3.6-35B-A3B`).
- **`cloud`** — needs a real GPU. Typically a large-total/small-*active*
  MoE — `activeParams` is what actually drives inference cost/speed, since a
  MoE model keeps every expert resident in memory even though only a subset
  computes per token (e.g. `gpt-oss-120b`: 117B total, only 5.1B active).

Families: Llama, Qwen (2.5/3/3.6/Next), Mistral, Gemma (2/3/4), Phi,
DeepSeek-R1-distill, gpt-oss, GLM, Nemotron, plus vision-language models
(Gemma 3/4, Qwen2.5-VL, Qwen3.6, GLM-4.6V, SmolVLM2). Like the image
catalog, only repo ids are hardcoded; the actual quantization files are
resolved **live** via the HuggingFace Hub API (shared `src/catalog/hf.ts`,
extended to recognize llama.cpp's `IQ*` imatrix and `MXFP4` quant naming).
Two filters are applied to every live listing regardless of model: files
matching a shard pattern (`-00001-of-00003.gguf`) are excluded, since this
app's downloader only fetches one file per component; so are
speculative-decoding draft files (`mtp-`/`dflash-`/`eagle3-` prefixes) that
several newer model repos ship alongside the real weights.

```bash
curl localhost:3000/v1/llm-catalog                        # curated models (incl. tier/activeParams)
curl localhost:3000/v1/llm-catalog/qwen3-8b/files         # live quant options (HF)
```

The web UI's **LLM → Catalog** sub-tab drives the same install flow as the
image Catalog tab — plus a tier filter (All / Mac / Cloud) — pick a model →
pick a quantization per component → writes `model.json` then enqueues the
download(s).

### Configuration

| Env var | Config key | Default | Meaning |
| ------- | ---------- | ------- | ------- |
| `SD_LLM_BINARY_PATH` | `llm_binary_path` | `llama-server` | Path to the binary (or a bare command on `PATH`) |
| `SD_LLM_AUTO_INSTALL` | `llm_auto_install` | `true` | Download a prebuilt release if the binary is missing |
| `SD_LLM_INSTALL_DIR` | `llm_install_dir` | `./data/llm-bin` | Where downloaded binaries are unpacked |
| `SD_LLM_RELEASE_TAG` | `llm_release_tag` | `latest` | Release to install (`latest` or a specific tag) |
| `SD_LLM_ACCEL` | `llm_accel` | `cpu` | Backend: `cpu`, `vulkan`, `cuda`, `rocm` |
| `SD_LLM_MODELS_DIR` | `llm_models_dir` | `./data/llm-models` | Root scanned by `llama-server --models-dir` |
| `SD_LLM_PORT` | `llm_port` | `8090` | Internal port `llama-server` listens on (`127.0.0.1` only, not exposed directly) |
| `SD_LLM_CTX_SIZE` | `llm_ctx_size` | `4096` | Context size (`-c`) |
| `SD_LLM_GPU_LAYERS` | `llm_gpu_layers` | `-1` | GPU layers (`-ngl`); `-1` omits the flag (auto) |
| `SD_LLM_JINJA` | `llm_jinja` | `true` | Enable chat-template/tool-calling support (`--jinja`) |
| `SD_LLM_STARTUP_TIMEOUT_MS` | `llm_startup_timeout_ms` | `30000` | How long to wait for `/health` before giving up |

If `llama-server` fails to install or start, sd-api logs a warning and keeps
serving image generation — `/v1/llm/*` requests fail with
`LLM_SERVER_UNAVAILABLE` until it's fixed and the process restarted.

## Audio generation (audio.cpp)

sd-api also serves audio models — text-to-speech, voice cloning, and
transcription — via an embedded
[`audiocpp_server`](https://github.com/0xShug0/audio.cpp) process, exposed as
an **OpenAI-audio-shaped** API at `/v1/audio/*`. Architecturally this follows
the same reverse-proxy pattern as LLM serving above (a persistent,
health-checked child process sd-api proxies to byte-for-byte) rather than the
image side's per-request CLI spawn, since `audiocpp_server` — like
`llama-server` — is itself a long-running HTTP server.

One real difference from `llama-server`: `audiocpp_server` has no
`--models-dir` auto-discovery. It loads an explicit model registry from a
generated config file (`data/audio-server-config.generated.json`), rebuilt
from every audio model bundle's `model.json` manifest (`family` + `task`)
before each (re)start — a bundle without one isn't servable, since audio.cpp
needs that information to pick the right loading code and none of it can be
inferred from files alone:

```
<audioModelsDir>/
  pocket-tts/
    model.json          # {"family": "pocket_tts", "task": "tts"}
    <weights...>
```

```bash
curl -X POST localhost:3000/v1/audio/speech -H 'content-type: application/json' \
  -o out.wav -d '{"model": "pocket-tts", "input": "Hello from sd-api."}'

curl -X POST localhost:3000/v1/audio/transcriptions \
  -F model=qwen3-asr -F file=@sample.wav

curl 'localhost:3000/v1/audio/voices?model=pocket-tts'
```

| Endpoint | Notes |
| --- | --- |
| `POST /v1/audio/speech` | TTS; `audio/wav` by default, or `response_format:"json"` for base64, or streaming for `mode:"streaming"` models. Non-streaming responses are saved into `outputsDir` (alongside generated images) — the saved filename comes back as the `X-Output-Name` response header, fetchable again via `GET /v1/outputs/:name`. Streaming (`stream_format`/`stream`) isn't persisted. |
| `POST /v1/audio/transcriptions` | JSON (`{"model","audio":"<server path>"}`) or multipart upload (OpenAI Whisper convention) |
| `GET /v1/audio/voices` | Cached voice ids / configured presets for a TTS model |
| `GET /v1/audio/models` | OpenAI-shape listing of currently configured models |
| `POST /v1/audio/tasks/run` | Generic escape hatch for tasks without a dedicated route (voice conversion, music generation, source separation, ...) |
| `POST /v1/audio-voice-refs` | Upload a reference voice WAV (multipart) — see "Voice cloning" below |
| `POST /v1/audio-models/:model/voice-presets` | Register an uploaded reference as a named, selectable voice preset |

### Model management (`/v1/audio-models`)

Each audio model is a flat bundle directory — same shape as LLM bundles, but
`model.json` is **required**, not an optional display-name sidecar, since
`family`/`task` are what let the generated `--config` registry (above)
actually register the model:

```bash
curl localhost:3000/v1/audio-models                 # list installed bundles
curl -X POST localhost:3000/v1/audio-models \
  -d '{"model":"pocket-tts"}' -H 'content-type: application/json'
curl -X PUT localhost:3000/v1/audio-models/pocket-tts/manifest \
  -H 'content-type: application/json' -d '{"family":"pocket_tts","task":"tts"}'
curl -X POST localhost:3000/v1/audio-models/download -H 'content-type: application/json' \
  -d '{"model":"pocket-tts","type":"weights","url":"https://.../pocket-tts-english-q8_0.gguf"}'
curl -X DELETE localhost:3000/v1/audio-models/pocket-tts
```

Downloads run through the same background download engine as the image/LLM
sides (progress, resume, cancel) via `/v1/audio-downloads` —
`DownloadManager`'s `ComponentPathResolver<TType>` generalization now backs a
third domain. A completed download debounce-restarts `audiocpp_server` (same
pattern as LLM auto-restart) so the new model becomes servable without a
manual restart. `PUT .../manifest` restarts synchronously instead, so a
family/task/voice-preset edit is live by the time the response comes back.

#### Voice cloning / conversion models (e.g. Chatterbox)

Some TTS families are cloning-only — they reject plain text input and need a
reference voice WAV. Confirmed against the real binary: `audiocpp_server`
doesn't take a reference file directly on a `/v1/audio/speech` request body;
it has to be pre-registered as a named **voice preset** in the model's
`model.json`, then selected per-request via the OpenAI-shape `"voice"` field.
Also note the model's own `task` must match what the family actually
implements — audio.cpp's task enum includes `"tts"` generically, but e.g.
Chatterbox only implements `"clon"`/`"vc"` and hard-rejects `"tts"`.

```bash
# 1. Upload a reference WAV (mirrors /v1/inputs for images).
curl -X POST localhost:3000/v1/audio-voice-refs -F file=@alice.wav
# -> {"voiceRefs":[{"name":"<uuid>.wav","path":"/abs/path/<uuid>.wav", ...}]}

# 2. Register it as a named voice preset (read-merge-write over model.json,
#    doesn't clobber existing presets; restarts audiocpp_server synchronously).
curl -X POST localhost:3000/v1/audio-models/chatterbox/voice-presets \
  -H 'content-type: application/json' \
  -d '{"name":"alice","voice_ref":"/abs/path/<uuid>.wav","reference_text":"optional transcript"}'

# 3. Select it by name.
curl -X POST localhost:3000/v1/audio/speech -o out.wav \
  -H 'content-type: application/json' \
  -d '{"model":"chatterbox","input":"Hello!","voice":"alice"}'
```

The web UI's Speak tab has an expandable "Voice reference" section that
drives the same flow (upload/pick a WAV, optional transcript, then Generate
speech registers the preset — once per unique file, cached client-side — and
calls speech with `voice` set).

### Model catalog (`/v1/audio-catalog`)

A small curated catalog
([`src/audio-catalog/data.ts`](src/audio-catalog/data.ts)), verified against
audio.cpp's own community GGUF mono-repo
([`audio-cpp/audio.cpp-gguf`](https://huggingface.co/audio-cpp/audio.cpp-gguf))
rather than guessed — spans TTS (PocketTTS, Qwen3-TTS, Chatterbox) and ASR
(Qwen3-ASR). Each entry carries `family`/`task`, so installing from the
catalog writes the `model.json` manifest automatically — no hand-authoring
needed, unlike a manual install. Like the image/LLM catalogs, only repo
paths are hardcoded; quantizations resolve **live** via the HuggingFace Hub
API (shared `src/catalog/hf.ts`). audio.cpp covers 40+ model families total;
this list is deliberately small to start and grows the same way the LLM/
image catalogs did.

```bash
curl localhost:3000/v1/audio-catalog                        # curated models
curl localhost:3000/v1/audio-catalog/pocket-tts/files       # live quant options (HF)
```

The web UI's **Audio** tab (Speak/Transcribe, Models, Catalog sub-tabs)
drives the same install flow as the LLM tab — pick a model → pick a file per
component → writes `model.json` then enqueues the download(s) — plus a
playground: type text and hear it back (`/v1/audio/speech`), or upload a
file and see the transcript (`/v1/audio/transcriptions`).

**Binary availability**: unlike stable-diffusion.cpp/llama.cpp, upstream
audio.cpp (`0xShug0/audio.cpp`) currently only publishes **Windows**
prebuilt releases — `SD_AUDIO_AUTO_INSTALL` will fail with a clear error on
Linux/macOS until that changes. Confirmed by actually building it
(`scripts/build_linux.sh`, GCC 13+/CMake) — it produces a working,
self-contained binary (only depends on glibc/libstdc++/libgomp, no sibling
shared lib to manage) — so `SD_AUDIO_RELEASES_REPO` lets the installer point
at a fork/mirror that publishes Linux/macOS builds instead of upstream, with
no code change. Until one exists, build from source and point
`SD_AUDIO_BINARY_PATH` at the result; a ready-to-use GitHub Actions workflow
for building+publishing both Linux (CPU) and macOS (Metal) releases from
such a fork is not included in this repo but was drafted alongside this
change (build with `--native-cpu OFF --deployment-build` — portable across
host CPUs, and embeds `model_specs` so the binary runs standalone without
the source checkout alongside it).

**Gotcha confirmed against the real binary**: `audiocpp_server` refuses to
start at all with an empty `models` array in its config (unlike
`llama-server`, which is happy to start with zero GGUF files) — so
`AudioServerManager` skips spawning entirely until at least one bundle has a
valid `model.json`, rather than treating "no models installed yet" as a
startup failure.

| Env var | Config key | Default | Meaning |
| ------- | ---------- | ------- | ------- |
| `SD_AUDIO_BINARY_PATH` | `audio_binary_path` | `audiocpp_server` | Path to the binary (or a bare command on `PATH`) |
| `SD_AUDIO_AUTO_INSTALL` | `audio_auto_install` | `true` | Download a prebuilt release if the binary is missing (Windows-only assets upstream today — see above) |
| `SD_AUDIO_INSTALL_DIR` | `audio_install_dir` | `./data/audio-bin` | Where downloaded binaries are unpacked |
| `SD_AUDIO_RELEASES_REPO` | `audio_releases_repo` | `0xShug0/audio.cpp` | `owner/repo` to query for releases — override with a fork/mirror that publishes Linux/macOS builds |
| `SD_AUDIO_RELEASE_TAG` | `audio_release_tag` | `latest` | Release to install (`latest` or a specific tag) |
| `SD_AUDIO_ACCEL` | `audio_accel` | `cpu` | Backend: `cpu`, `vulkan`, `cuda`, `rocm` |
| `SD_AUDIO_MODELS_DIR` | `audio_models_dir` | `./data/audio-models` | Root scanned for `model.json`-registered bundles |
| `SD_AUDIO_PORT` | `audio_port` | `8091` | Internal port `audiocpp_server` listens on (`127.0.0.1` only, not exposed directly) |
| `SD_AUDIO_STARTUP_TIMEOUT_MS` | `audio_startup_timeout_ms` | `30000` | How long to wait for `/health` before giving up |
| `SD_AUDIO_REQUEST_TIMEOUT_MS` | `audio_request_timeout_ms` | `300000` | Generated config's `busy_timeout_ms` (how long a request waits for a busy model); `0` disables the guard |

If `audiocpp_server` fails to install or start, sd-api logs a warning and
keeps serving everything else — `/v1/audio/*` requests fail with
`AUDIO_SERVER_UNAVAILABLE` until it's fixed and the process restarted.

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

### Live logs (`/v1/logs`)

Every log line the app emits (Fastify request/response logging, service
`app.log.*` calls, forwarded `sd-cli`/`llama-server` child-process output)
is teed into an in-memory ring buffer (last 2000 entries, resets on
restart — terminal stdout is unaffected) and tagged with a `category`:
`http`, `healthcheck`, `error`, `sd-cli`, `llama-server`, `app`. A 4xx/5xx
response is always tagged `error`, even if nothing threw. Requests to
`/health` are tagged `healthcheck` rather than `http` so they're easy to
filter out.

```bash
curl localhost:3000/v1/logs                       # last 300 entries (default)
curl localhost:3000/v1/logs?category=error         # only errors
curl localhost:3000/v1/logs?level=warn&limit=50    # last 50 warnings

curl -N localhost:3000/v1/logs/stream              # SSE: replay burst, then live entries
```

The web UI's **Logs** tab consumes `/v1/logs/stream` with filter chips per
category, a text search, and pause/clear controls.

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
`OUTPUT_NOT_FOUND`, `INPUT_NOT_FOUND`, `INVALID_PATH`, `DOWNLOAD_FAILED`,
`LLM_BINARY_NOT_FOUND`, `LLM_STARTUP_FAILED`, `LLM_SERVER_UNAVAILABLE`,
`LLM_UPSTREAM_ERROR`, `AUDIO_BINARY_NOT_FOUND`, `AUDIO_STARTUP_FAILED`,
`AUDIO_SERVER_UNAVAILABLE`, `AUDIO_UPSTREAM_ERROR`, `INTERNAL_ERROR`.

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
  downloads/        # generic background download manager (progress + resume)
                    #   + ComponentPathResolver interface (resolver.ts)
  catalog/          # curated model catalog + HuggingFace file listing
  jobs/             # in-memory job queue + manager
  llm/              # llama-server process manager, arg mapping, installer
  llm-models/       # LLM bundle resolver + manager (flat <id>/ layout)
  llm-catalog/      # curated LLM catalog (reuses catalog/hf.ts)
  logs/             # in-memory ring buffer tee'd from pino (buffer.ts)
  audio/            # audiocpp_server process manager, generated server-config, installer
  audio-models/     # audio bundle resolver + manager (flat <id>/ layout, required model.json)
  audio-catalog/    # curated audio catalog (reuses catalog/hf.ts)
  routes/           # generate, jobs, models, outputs, health, llm, llm-models, llm-catalog, logs,
                    #   audio, audio-models, audio-catalog
  util/             # path safety, filename, validation
public/             # thin web UI (single static index.html, no build step)
test/               # vitest unit + integration tests (uses fake `sd`/`llama-server`/`audiocpp_server` binaries)
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
video models (Wan, LTX-2.3), externalized catalog (designed, deferred),
HuggingFace OAuth in the UI (Phase 2 of HF auth — token-from-env ships today).

LLM serving: model management and a downloadable catalog now ship (see
above); image-attach in the Chat UI and LoRA/restart-policy/preset support
for `llama-server` remain planned follow-ups.

Audio (audio.cpp): model management, a downloadable catalog, and a web UI tab
now ship (see above). Auto-install once upstream ships Linux/macOS releases,
`/v1/audio/transcriptions/live` (raw chunked-PCM streaming transcription),
and dedicated routes for audio.cpp's other tasks (voice conversion, music
generation, source separation — reachable today via the generic
`/v1/audio/tasks/run`) remain planned follow-ups.
