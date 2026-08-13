# Running sd-api as a RunPod Serverless Worker

This packages sd-api as a [RunPod Serverless](https://docs.runpod.io/serverless/overview)
worker: RunPod handles the job queue, autoscaling, and scale-to-zero; a thin
Python handler (`runpod/handler.py`) spawns sd-api as a background process
inside the container and proxies each job to it over `localhost`. No `src/`
code is involved — this is deployment packaging only.

Persistence for this trial setup uses **RunPod's own Network Volume**
(mounted at `/runpod-volume`), so models and auto-installed binaries survive
worker restarts instead of re-downloading every cold start. (An
external-storage alternative, for cost reasons, is a separate follow-up —
not part of this setup.)

## 1. Build and push the image

```bash
docker build -t <your-registry>/sd-api-runpod:latest .
docker push <your-registry>/sd-api-runpod:latest
```

Any registry RunPod can pull from works — Docker Hub or GHCR are the usual
choices. If the registry is private, you'll add its pull credentials in the
RunPod console when creating the endpoint (Settings → Container Registry
Auth).

The image bakes in `SD_ACCEL=cuda` / `SD_LLM_ACCEL=cuda` /
`SD_AUDIO_ACCEL=cuda` and `SD_AUDIO_RELEASES_REPO=searpro/audio.cpp`
(your fork) as defaults — override any of these as endpoint env vars if
needed. Auto-install stays on for all three binaries (sd-cli, llama-server,
audiocpp_server), so a worker with an empty Network Volume installs them on
its first cold start and reuses them afterwards.

`searpro/audio.cpp` now publishes a Linux CUDA build (release tag
`linux-cuda-test`, resolved automatically as "latest" since it's GitHub's
most recently published non-draft release) alongside Linux CPU and macOS
Metal — verified end-to-end in this repo (asset selection, download,
extraction, and the resulting `audiocpp_server` binary's linked libraries)
against the real release. It bundles its own CUDA runtime libraries
(`libcublas`, `libcudart`, `libcufft`, `libcublasLt` — see the archive's
`BUILD_INFO.txt`), so it needs only an NVIDIA driver on the RunPod host,
not a CUDA toolkit. The `linux-cuda-test` tag name suggests it may be
provisional — if it gets renamed/replaced later, `SD_AUDIO_RELEASE_TAG`
defaulting to "latest" means no config change is needed either way.

## 2. Create a Network Volume

RunPod console → **Storage → Network Volumes → New Network Volume**.
Pick a datacenter that has the GPU type you want (the volume pins your
endpoint to this datacenter) and a size that comfortably fits your models +
installed binaries (a few GB for binaries, plus whatever your checkpoints
need — SDXL-class checkpoints alone are several GB each).

## 3. Create the Serverless Endpoint

RunPod console → **Serverless → New Endpoint**:

- **Container Image**: the image you pushed in step 1.
- **GPU**: any CUDA-capable type available in the volume's datacenter.
- **Network Volume**: attach the one from step 2 (mounts at `/runpod-volume`
  automatically — `runpod/entrypoint.sh` detects it and redirects
  `SD_MODELS_DIR`, `SD_LLM_MODELS_DIR`, `SD_AUDIO_MODELS_DIR`,
  `SD_INSTALL_DIR`, `SD_LLM_INSTALL_DIR`, `SD_AUDIO_INSTALL_DIR` onto it; no
  manual env var setup needed for this part).
- **Env vars**: none required for a trial run. Optionally set
  `SD_MAX_CONCURRENT_JOBS`, `SD_LLM_CTX_SIZE`, `HF_TOKEN` (for
  gated/private HuggingFace models), etc. — anything in `.env.example`
  works the same way here.
- **Min/Max Workers**: 0/1 is fine for a trial. Min 0 means every request
  after idle pays a cold-start cost (binary install, if the volume doesn't
  have them yet, plus sd-api boot); raising min workers to 1 keeps a worker
  warm at idle cost.
- **Idle Timeout**: RunPod's default is fine to start.

Deploy. RunPod builds the endpoint and gives you an endpoint ID and API key
(Settings → API Keys, if you don't have one already).

## 4. Load a model (one-time, per volume)

The worker itself doesn't come with any models — same as a normal sd-api
install. Easiest path: send a job that hits the existing model-management
API to download one from the built-in catalog, e.g.:

```bash
curl -s -X POST https://api.runpod.ai/v2/<endpoint-id>/runsync \
  -H "Authorization: Bearer <runpod-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "path": "/v1/models/catalog/<catalog-id>/download",
      "method": "POST",
      "body": { }
    }
  }'
```

(Check `GET /v1/models/catalog` — proxied the same way — for available
catalog IDs and their expected body, or use the web UI locally against the
same volume-backed `SD_MODELS_DIR` if you mount it elsewhere first.) Once
downloaded, the model persists on the Network Volume for all future workers
on this endpoint.

## 5. Generate

```bash
curl -s -X POST https://api.runpod.ai/v2/<endpoint-id>/runsync \
  -H "Authorization: Bearer <runpod-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "path": "/v1/generate",
      "method": "POST",
      "body": {
        "prompt": "a red panda reading a book, studio lighting",
        "model": "<model-id>"
      }
    }
  }'
```

## Job input/output contract

The handler is a generic proxy — any sd-api HTTP route works, not just
`/v1/generate`:

```json
{
  "input": {
    "path": "/v1/generate",
    "method": "POST",
    "body": { "prompt": "...", "model": "..." },
    "query": { "format": "base64" },
    "headers": {}
  }
}
```

- `path` defaults to `/v1/generate` if omitted.
- `method` defaults to `POST`.
- Response shape:
  ```json
  { "status": 200, "content_type": "application/json", "body": { ... } }
  ```
  For non-JSON responses (e.g. `GET /v1/outputs/:name` without
  `?format=base64`, or `/v1/audio/speech`'s WAV output), `body` becomes
  `{"base64": "..."}` instead.
- sd-api's own application errors (`VALIDATION_ERROR`, `MODEL_NOT_FOUND`,
  etc.) come back as a normal response with the matching `status` and a
  `body.error.code`/`message` — they are **not** RunPod's top-level
  `"error"` field. That field is reserved for the proxy itself failing to
  reach sd-api (crashed process, connection refused, timeout).

## Local testing without a GPU or RunPod account

`runpod`'s Python SDK supports invoking the handler directly for one job,
without any RunPod infrastructure:

```bash
cd runpod && pip install -r requirements.txt
SD_ACCEL=cpu SD_LLM_ACCEL=cpu SD_AUDIO_ACCEL=cpu \
SD_AUTO_INSTALL=false SD_LLM_AUTO_INSTALL=false SD_AUDIO_AUTO_INSTALL=false \
SD_BINARY_PATH=<path-to-fake-or-real-sd-binary> \
python3 handler.py --test_input '{"input": {"path": "/health", "method": "GET"}}'
```

This exercises the real spawn → health-poll → proxy path end to end (see
`test/fixtures/fake-sd.mjs` and `test/helpers.ts` for how the test suite
fakes the binaries — the same approach works here for a smoke test without
real weights or a GPU).

`docker build .` and `docker run` (no `--gpus`, `SD_ACCEL=cpu` etc.) have
also been verified directly: the image builds, and the container starts
cleanly — `entrypoint.sh` correctly falls back to local `./data` with no
Network Volume attached, sd-api boots (binary auto-installs fail only
because of this test environment's GitHub API rate limit, non-fatally, as
designed), `/health` responds, and the RunPod SDK initializes. Real GPU
inference still needs an actual GPU to verify.

## Out of scope for this setup

- Streaming job progress (`GET /v1/jobs/:id/stream`) through RunPod's
  generator/streaming handler mode — the synchronous proxy above covers the
  common case; not wired up here.
- External object storage (S3/MinIO/R2) instead of RunPod's Network Volume
  — a deliberate follow-up, tracked separately, once a storage design is
  chosen.
