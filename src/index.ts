import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  // Warn early if the binary is not reachable, but don't refuse to boot:
  // model management and docs are still useful without it.
  try {
    await app.sd.checkBinary();
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'stable-diffusion.cpp binary check failed');
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
