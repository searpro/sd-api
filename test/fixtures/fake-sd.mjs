#!/usr/bin/env node
// A stand-in for the stable-diffusion.cpp `sd` binary used in tests.
// It mimics the CLI contract: parses -o/--steps, prints a progress bar to
// stderr, then writes a tiny valid PNG to the output path.
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const output = flag('-o') ?? flag('--output');
const steps = Number(flag('--steps') ?? 4);

if (process.env.FAKE_SD_FAIL === '1') {
  process.stderr.write('fatal: simulated failure\n');
  process.exit(2);
}

// Emit progress like the real CLI's sampling bar.
for (let i = 1; i <= steps; i++) {
  process.stderr.write(`  |====>      | ${i}/${steps} - 0.12s/it\n`);
}

// 1x1 transparent PNG.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
if (output) writeFileSync(output, png);
process.stdout.write('done\n');
process.exit(0);
