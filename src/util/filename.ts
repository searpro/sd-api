import { randomUUID } from 'node:crypto';

/** Generate a unique, collision-resistant output filename (images, audio, ...). */
export function uniqueOutputName(ext = 'png'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}_${randomUUID()}.${ext}`;
}
