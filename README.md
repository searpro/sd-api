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

## Prerequisites

1. Build the `stable-diffusion.cpp` CLI per its
   [build instructions](https://github.com/leejet/stable-diffusion.cpp#build) and note the
   path to the resulting `sd` executable.
2. Node.js >= 20.

## Quick start

```bash
npm install
cp .env.example .env        # then edit SD_BINARY_PATH etc.
npm run build && npm start  # or: npm run dev
```

Drop a `.gguf` checkpoint into `<models_dir>/checkpoints/`, then:

```bash
curl -X POST localhost:3000/v1/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"a futuristic city","model":"sdxl-base.gguf","steps":20,"cfg_scale":7}'
```

Interactive docs: <http://localhost:3000/docs>.

## Configuration (Phase 7)

Resolved in order (later wins): `config/default.json` → `config/local.json` → `SD_*` env vars.

| Env var | Config key | Default | Meaning |
| ------- | ---------- | ------- | ------- |
| `SD_BINARY_PATH` | `sd_binary_path` | `sd` | Path to the `sd` executable (or a bare command on `PATH`) |
| `SD_MODELS_DIR` | `models_dir` | `./data/models` | Root of `checkpoints/`, `vae/`, `clip/` |
| `SD_OUTPUTS_DIR` | `outputs_dir` | `./data/outputs` | Generated images |
| `SD_HOST` / `SD_PORT` | `host` / `port` | `0.0.0.0` / `3000` | Listen address |
| `SD_MAX_CONCURRENT_JOBS` | `max_concurrent_jobs` | `2` | Queue concurrency |
| `SD_JOB_TIMEOUT_MS` | `job_timeout_ms` | `600000` | Per-process hard timeout |
| `SD_MAX_IMAGE_DIM` | `max_image_dim` | `2048` | Max width/height accepted |
| `SD_LOG_LEVEL` | `log_level` | `info` | pino level |

## Models directory layout (Phase 3)

```
<models_dir>/
  checkpoints/   # .gguf (and .safetensors/.ckpt) checkpoints — referenced by "model"
  vae/           # optional VAE weights — referenced by "vae"
  clip/          # optional CLIP / T5 weights — clip_l, clip_g, t5xxl
```

## API overview

### `POST /v1/generate` — synchronous generation

```jsonc
{
  "prompt": "a futuristic city",     // required
  "model": "sdxl-base.gguf",          // required, name under checkpoints/
  "negative_prompt": "blurry",
  "steps": 20,
  "cfg_scale": 7,
  "width": 512,
  "height": 512,
  "seed": 1234,
  "sampler": "euler_a",
  "vae": "sdxl-vae.safetensors"       // optional weights by name
}
```

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

### Models (Phase 3)

```bash
curl localhost:3000/v1/models
curl -X POST localhost:3000/v1/models/download \
  -H 'content-type: application/json' \
  -d '{"url":"https://.../model.gguf","type":"checkpoint"}'
curl -X DELETE localhost:3000/v1/models/model.gguf
```

## CLI flag mapping (Spec section 3)

API parameters map directly to `stable-diffusion.cpp` flags in
[`src/sd/args.ts`](src/sd/args.ts) via a single data-driven table:

| API | CLI flag |
| --- | -------- |
| `prompt` | `-p` |
| `negative_prompt` | `-n` |
| `model` | `-m` |
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
  sd/               # CLI wrapper: args mapping, spawn, progress parsing
  models/           # model manager (list/download/delete)
  jobs/             # in-memory job queue + manager
  routes/           # generate, jobs, models, outputs, health
  util/             # path safety, filename, validation
test/               # vitest unit + integration tests (uses a fake `sd` binary)
```

## Development

```bash
npm run dev        # watch mode (tsx)
npm run typecheck
npm test           # vitest — runs against a stub `sd` binary, no model needed
```

## Future extensions (not yet implemented)

LoRA, ControlNet, img2img, inpainting, persistent job store, GPU scheduling,
distributed workers.
