// Load .env into process.env before anything reads config. Real environment
// variables (e.g. set by the shell, Docker, systemd) always win — dotenv does
// not override a variable that is already set.
import 'dotenv/config';

import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { hfTokenSource } from './util/hf-auth.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  // Note HuggingFace auth status (needed for gated/private models).
  const hfSource = hfTokenSource();
  app.log.info(
    { hfAuth: hfSource },
    hfSource === 'none'
      ? 'HuggingFace: no token configured — gated/private models will fail to download (set HF_TOKEN)'
      : 'HuggingFace: token configured',
  );

  // Ensure a usable sd binary exists, auto-installing a prebuilt release if
  // configured. Non-fatal: model management and docs still work without it.
  try {
    await app.sd.ensureBinary();
  } catch (err) {
    app.log.warn(
      { err: (err as Error).message },
      'stable-diffusion.cpp binary unavailable; generation will fail until it is installed',
    );
  }

  // Ensure a usable llama-server binary exists and start it (router mode).
  // Non-fatal: the rest of the app stays usable if this fails; /v1/llm/*
  // requests will surface a clean LLM_SERVER_UNAVAILABLE until it's fixed.
  try {
    await app.llm.ensureBinary();
    await app.llm.start();
  } catch (err) {
    app.log.warn(
      { err: (err as Error).message },
      'llama-server unavailable; /v1/llm/* requests will fail until it is installed/running',
    );
  }

  // Ensure a usable audiocpp_server binary exists and start it. Non-fatal,
  // same posture as llama-server above — /v1/audio/* requests will surface a
  // clean AUDIO_SERVER_UNAVAILABLE until it's fixed. Auto-install is
  // expected to fail on Linux/macOS today (audio.cpp only publishes Windows
  // prebuilt releases so far); see src/audio/installer.ts.
  try {
    await app.audio.ensureBinary();
    await app.audio.start();
  } catch (err) {
    app.log.warn(
      { err: (err as Error).message },
      'audiocpp_server unavailable; /v1/audio/* requests will fail until it is installed/running',
    );
  }

  const close = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.llm.stop();
    await app.audio.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `sd-api listening on http://${config.host}:${config.port} (docs at /docs)`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
