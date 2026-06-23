---
name: local-verify
description: Run the sd-api server (or exercise a feature end-to-end) locally without a real stable-diffusion.cpp binary or GPU, using the fake sd-cli. Use when asked to run, smoke-test, or verify the app/an endpoint by actually starting it.
---

# Run & verify locally (no real model/GPU)

The repo ships a stub `sd-cli` (`test/fixtures/fake-sd.mjs`) that parses the same
flags and writes a 1×1 PNG. Use it to start the real server and hit endpoints.

## Build first

```bash
npm run build
```

## Start the server with the fake binary

```bash
cp test/fixtures/fake-sd.mjs /tmp/ && printf '#!/bin/sh\nexec node /tmp/fake-sd.mjs "$@"\n' > /tmp/sd && chmod +x /tmp/sd
R=/tmp/sd-run; rm -rf $R; mkdir -p $R/models $R/outputs $R/inputs
SD_BINARY_PATH=/tmp/sd SD_AUTO_INSTALL=false \
  SD_MODELS_DIR=$R/models SD_OUTPUTS_DIR=$R/outputs SD_INPUTS_DIR=$R/inputs \
  SD_PORT=3970 SD_LOG_LEVEL=info node dist/index.js
```

Key env (see `src/config.ts`): `SD_BINARY_PATH`, `SD_AUTO_INSTALL=false` (skip
GitHub download), `SD_MODELS_DIR`/`SD_OUTPUTS_DIR`/`SD_INPUTS_DIR`, `SD_PORT`,
`SD_LOG_LEVEL`.

## Seed a model bundle, then generate

```bash
mkdir -p $R/models/m/checkpoint && echo x > $R/models/m/checkpoint/model.gguf
curl -s localhost:3970/v1/models
curl -s -X POST localhost:3970/v1/generate -H 'content-type: application/json' \
  -d '{"prompt":"a cat","model":"m","steps":2}'
```

- The server logs the exact argv (`"msg":"spawning stable-diffusion.cpp"`) —
  grep `srv.log` for `"args":[...]` to confirm flags (e.g. `--diffusion-model`,
  `--vae`, `-r`, `--lora-model-dir`).
- UI at `/`, Swagger at `/docs`.

## Notes

- Background downloads need an HTTP source. Stand up a tiny local file server
  (see `test/downloads.test.ts` for a Range-capable example) instead of relying
  on HuggingFace, which is often blocked in sandboxes.
- Prefer this over `npm test` only when you specifically need a live server;
  otherwise `npm test` (vitest, also uses the fake binary) is faster.
- Clean up `/tmp/sd`, `/tmp/fake-sd.mjs`, `$R` when done.
