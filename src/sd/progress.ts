/**
 * Parse step progress out of stable-diffusion.cpp output (Phase 5).
 *
 * The CLI renders a sampling progress bar that includes a `step/total`
 * fragment, e.g.:
 *   |==============>      | 7/20 - 1.13s/it
 * We extract the first `N/M` pair on such lines. Tolerant by design: the exact
 * formatting varies across builds, so we match the numeric fragment rather than
 * the surrounding decoration.
 */

const STEP_RE = /(?:^|[\s|>\]])(\d+)\s*\/\s*(\d+)(?=[\s\-]|s\/it|it\/s|$)/;

export interface StepProgress {
  step: number;
  total: number;
  progress: number; // 0..1
}

export function parseProgress(line: string): StepProgress | null {
  const m = STEP_RE.exec(line);
  if (!m) return null;
  const step = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(step) || !Number.isFinite(total) || total <= 0) return null;
  if (step > total) return null;
  return { step, total, progress: total === 0 ? 0 : step / total };
}
