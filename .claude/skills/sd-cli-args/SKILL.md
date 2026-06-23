---
name: sd-cli-args
description: Reference for how API params map to stable-diffusion.cpp (sd-cli) argv, and how a model bundle resolves to flags. Use when changing generation arguments, adding a CLI flag, debugging the spawned command, or wiring a new model/edit/lora feature.
---

# sd-cli argument mapping

Args are built in `src/sd/args.ts` (`buildArgs`) from a `ResolvedBundle`
(`src/models/bundle.ts`) + validated `GenerateParams`. Values are pushed as
**discrete argv elements** — never concatenated into a shell string.

## Order produced by buildArgs

1. Checkpoint: `-m <path>` (full) **or** `--diffusion-model <path>` (split) —
   chosen by `bundle.loadMode`.
2. Weights (`WEIGHT_FLAG`): `--vae`, `--clip_l`, `--clip_g`, `--clip_vision`,
   `--t5xxl`, `--llm`, `--llm_vision` — from `bundle.weights` (resolved from the
   `vae/` and `clip/` dirs).
3. LoRA: `--lora-model-dir <bundle>/lora` when the bundle has loras. LoRAs are
   applied by `<lora:name:mult>` tags **in the prompt** (left verbatim).
4. Edit/img2img inputs: `-i` (init), `--mask`, `-r` (each ref image, repeatable),
   `--strength`, `--img-cfg-scale`, `--increase-ref-index`.
5. `-o <output.png>`, then `-p <prompt>`.
6. Params (`FLAG_MAP`): `-n` (negative), `--steps`, `--cfg-scale`, `-W`, `-H`,
   `-s` (seed), `--sampling-method`.
7. `bundle.extraArgs` (manifest `extra_args`) appended verbatim.

## To add a new flag

- Param-driven flag: add the field to `generateSchema`
  (`src/schemas/generate.ts`) → read it in `buildArgs` → cover it in
  `test/args.test.ts`.
- Weight/component flag: add the role to `ClipRole` (`bundle.ts`),
  `WEIGHT_FLAG` (`args.ts`), and `detectClipRole` filename heuristics.
- Model-specific one-off flag: prefer the bundle manifest `extra_args` (no code
  change) over a new param.

## Verifying against the real CLI

Flags drift between `sd-cli` releases. To check the authoritative list, run the
installed binary's help (it needs its sibling lib on the loader path):

```bash
LD_LIBRARY_PATH="$(dirname "$BIN")" "$BIN" --help
```

`buildArgs` is unit-tested in `test/args.test.ts` with fake bundles — assert new
flags there. The wrapper logs the exact argv at info level (`spawning
stable-diffusion.cpp`), useful when debugging a real run.
