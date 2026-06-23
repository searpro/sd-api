---
name: add-catalog-model
description: Add or fix a model in the downloadable catalog (src/catalog/data.ts) — choosing HuggingFace repos/paths, formats, quantization, edit/lora flags. Use when the user asks to add a new model, fix a wrong repo/path, or extend the Catalog tab.
---

# Add a model to the catalog

The catalog is a curated `CatalogModel[]` in `src/catalog/data.ts`. Each entry's
components point at HuggingFace repos; the app lists the real files/quants live
via `src/catalog/hf.ts` at request time (so do NOT hardcode file URLs).

## Steps

1. Read the model's page in the upstream docs:
   `https://github.com/leejet/stable-diffusion.cpp/tree/master/docs` (fetch the
   relevant `<model>.md` raw file to get the exact HF repos/paths).
2. Append a `CatalogModel` to `CATALOG` in `src/catalog/data.ts` (copy the
   nearest existing entry of the same family). Shape (`src/catalog/types.ts`):

```ts
{
  id: 'kebab-id',
  name: 'Display Name',
  description: '…',
  loadMode: 'diffusion-model',   // 'model' for a single full checkpoint
  edit: true,                    // optional: needs reference image(s) at gen
  extraArgs: ['--flow-shift', '3'], // optional model-specific sd-cli flags
  reference: `${DOCS}/<model>.md`,
  defaults: { cfg_scale: 1, sampler: 'euler' },
  components: [
    { role: 'checkpoint', bundleType: 'checkpoint', label: 'Diffusion model',
      required: true, quantizable: true,
      sources: { gguf: { repo: 'owner/Repo-GGUF' },
                 safetensors: { repo: 'owner/Repo', path: 'split_files/diffusion_models' } } },
    { role: 'vae', bundleType: 'vae', label: 'VAE', required: true, quantizable: false,
      sources: { safetensors: { repo: 'black-forest-labs/FLUX.1-dev', match: 'ae' } } },
    // clip text encoders: role ∈ clip_l|clip_g|t5xxl|llm|clip_vision|llm_vision, bundleType 'clip'
  ],
}
```

## Conventions / gotchas

- `role` → bundle dir + sd-cli flag: checkpoint→`-m`/`--diffusion-model`,
  vae→`--vae`, clip_l/clip_g/t5xxl/llm/clip_vision/llm_vision→`--clip_l` etc.
  `bundleType` is the storage dir: `checkpoint` | `vae` | `clip` (text encoders
  all go in `clip`).
- **`match`** is a case-insensitive substring to pick the right file when a repo
  holds several (e.g. `match: 'ae'` for the VAE, `match: 't5xxl'`). Omit it to
  let the user pick from the dropdown.
- **`quantizable: true`** for GGUF repos with many quants (checkpoint, llm);
  `false` for single-file safetensors (vae, clip_l/g, t5xxl).
- **`loadMode`**: `diffusion-model` (split: has vae/clip) vs `model` (one full
  checkpoint). Edit models still use the same components as their base + `edit: true`.
- **`extraArgs`** are written verbatim into the bundle `model.json` on install
  (e.g. Qwen-Image-Edit-2511 needs `--qwen-image-zero-cond-t`).
- Image-edit/video/`--uncond-diffusion-model` models are out of scope unless the
  generate pipeline supports them (txt2img + ref-image edit only today).

## Verify

- `npm run typecheck && npx vitest run test/catalog.test.ts`.
- Live: `GET /v1/catalog` lists it; `GET /v1/catalog/<id>/files` returns real
  files (needs HuggingFace reachable — may be blocked in sandboxes; the parsing
  is covered by `test/catalog.test.ts` with a stubbed `fetch`).
