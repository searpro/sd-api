import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

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

  const close = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
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
