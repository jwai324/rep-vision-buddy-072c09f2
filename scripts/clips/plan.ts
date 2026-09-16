/**
 * Publish planning for the clip ingest: pure decisions, so the resumability
 * rules are testable without Storage. The driver (ingest.ts) does the I/O.
 */

export type ObjectKind = 'webm' | 'mp4' | 'poster';

export interface ObjectSpec {
  kind: ObjectKind;
  /** Object name inside the bucket. */
  path: string;
}

export interface ExistingClipRow {
  exercise_id: string;
  slug: string;
  webm_path: string;
  mp4_path: string;
  poster_path: string;
  source_file: string;
}

export type PublishPlan =
  | { action: 'skip-done' }
  | { action: 'skip-conflict'; detail: string }
  | { action: 'publish'; stale: string[] };

const EXTENSIONS: Record<ObjectKind, string> = { webm: 'webm', mp4: 'mp4', poster: 'webp' };

/**
 * <slug>-<12 hex of the file's sha256>.<ext>. Content-addressed, so a
 * re-encode lands on a new path (no stale CDN cache to wait out) and a path
 * cannot be guessed from an exercise name.
 */
export function objectName(slug: string, kind: ObjectKind, sha256Hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) throw new Error(`objectName: expected a sha256 hex digest, got "${sha256Hex}"`);
  return `${slug}-${sha256Hex.slice(0, 12)}.${EXTENSIONS[kind]}`;
}

export function planPublish(input: {
  existing: ExistingClipRow | null;
  sourceFile: string;
  force: boolean;
  objects: ObjectSpec[];
}): PublishPlan {
  const { existing, sourceFile, force, objects } = input;
  const wanted = new Set(objects.map(o => o.path));
  if (!existing) return { action: 'publish', stale: [] };

  if (existing.source_file !== sourceFile && !force) {
    return {
      action: 'skip-conflict',
      detail: `${existing.exercise_id} already has a clip from "${existing.source_file}"; re-run with --force to replace it`,
    };
  }

  const current = [existing.webm_path, existing.mp4_path, existing.poster_path];
  const unchanged = current.every(p => wanted.has(p)) && wanted.size === current.length;
  if (unchanged && !force) return { action: 'skip-done' };

  return { action: 'publish', stale: current.filter(p => !wanted.has(p)) };
}
