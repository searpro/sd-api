/**
 * Unlike sd-cli/llama-server, almost all of audiocpp_server's configuration
 * (host, port, backend, model registry) lives in the JSON file passed via
 * --config (see src/audio/config-gen.ts), not in flags — so there's very
 * little argv to build here.
 */
export function buildAudioServerArgs(configPath: string): string[] {
  return ['--config', configPath];
}
