import type { Config } from '../config.js';

/**
 * Build the argv for spawning `llama-server` in router mode (no `-m`): it
 * auto-discovers GGUF models from `--models-dir` and routes requests by the
 * `"model"` field in the request body. Mirrors src/sd/args.ts's data-driven
 * approach — values are pushed as discrete argv elements, never concatenated
 * into a shell string.
 */
export function buildLlamaServerArgs(config: Config): string[] {
  const args: string[] = [];

  args.push('--models-dir', config.llmModelsDir);
  // Never make this configurable: this process must stay loopback-only, our
  // own Fastify app is the public-facing surface (see src/routes/llm.ts).
  args.push('--host', '127.0.0.1');
  args.push('--port', String(config.llmPort));
  args.push('-c', String(config.llmCtxSize));
  // -1 is our sentinel for "omit the flag, let llama-server auto-decide".
  if (config.llmGpuLayers !== -1) args.push('-ngl', String(config.llmGpuLayers));
  if (config.llmJinja) args.push('--jinja');

  return args;
}
