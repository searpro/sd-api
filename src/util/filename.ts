import { randomUUID } from 'node:crypto';

/** Generate a unique, collision-resistant output filename (Phase 6). */
export function uniqueImageName(ext = 'png'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}_${randomUUID()}.${ext}`;
}
