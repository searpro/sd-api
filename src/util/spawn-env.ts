import { resolve, dirname, delimiter } from 'node:path';

/**
 * Build a child-process environment that adds a binary's own directory to the
 * dynamic-library search path. Prebuilt releases (stable-diffusion.cpp,
 * llama.cpp) ship their CLI/server binaries next to a shared library, but the
 * binary's RUNPATH points at the build machine, so we must help the loader
 * find the sibling lib regardless of the process's working directory.
 */
export function spawnEnv(binaryPath: string): NodeJS.ProcessEnv {
  if (!binaryPath.includes('/') && !binaryPath.includes('\\')) {
    // Bare command resolved via PATH — assume libs are already discoverable.
    return process.env;
  }
  const binDir = dirname(resolve(binaryPath));
  const env = { ...process.env };
  const prepend = (key: string) => {
    env[key] = env[key] ? `${binDir}${delimiter}${env[key]}` : binDir;
  };
  if (process.platform === 'darwin') {
    prepend('DYLD_LIBRARY_PATH');
    prepend('DYLD_FALLBACK_LIBRARY_PATH');
  } else if (process.platform === 'win32') {
    prepend('PATH'); // Windows resolves DLLs from PATH (and the exe dir).
  } else {
    prepend('LD_LIBRARY_PATH');
  }
  return env;
}
