/**
 * The slug rule for exercise clips, defined once. Used by ingest.ts and
 * covered by src/test/clipNaming.test.ts.
 *
 * vendorKey(file): the deterministic identity of a vendor file. The filename
 *   stem, lower-cased, every run of non-alphanumerics collapsed to one hyphen,
 *   so "0123_Bodyweight_Squat.MP4" and "0123-bodyweight-squat.mp4" are the
 *   same file. A leading number is kept: "180_Jump_Turns" is a number that
 *   means something, and a key must never guess.
 *
 * Matching a file to an exercise, in order:
 *   1. clip-map.csv, matched by vendorKey of its `source` column: the human
 *      decision. Its exercise_id must exist in the library; its slug is
 *      optional and defaults to the exercise_id. A map row always keeps its
 *      exercise: a name match on another file never displaces it.
 *   2. Exact name match. The stem with a trailing male/female token removed
 *      (and the catalogue prefix removed, only when the operator has declared
 *      one with --prefix), normalised the way the app's search does, compared
 *      for equality with every library exercise's name and aliases. Exactly
 *      one hit is a match; zero or several is not. Nothing is stripped that
 *      was not declared: "180 Jump Squat" is not "Jump Squat".
 *   3. Otherwise the file goes to the review list. Near-misses are listed as
 *      suggestions for the human and are never used.
 *
 * The published slug is the exercise_id unless clip-map.csv says otherwise;
 * both are kebab-case and each is claimed by one file. Storage objects are
 * named <slug>-<content hash>.<ext> (see plan.ts), so a path cannot be
 * guessed from a name.
 */

export interface LibraryExercise {
  id: string;
  name: string;
  aliases?: string[];
}

export interface ClipMapEntry {
  source: string;
  exerciseId: string;
  slug?: string;
  note?: string;
}

export type ReviewReason =
  | 'no-match'
  | 'ambiguous'
  | 'unknown-exercise-id'
  | 'bad-slug'
  | 'duplicate-file'
  | 'duplicate-exercise'
  | 'duplicate-slug';

export interface MatcherOptions {
  /**
   * The vendor's catalogue prefix, anchored at the start of the stem, e.g.
   * /^\d{4}[_-]/ for "0123_Bodyweight_Squat". Off by default: a leading number
   * is part of the name until the operator says otherwise.
   */
  stripPrefix?: RegExp;
}

export type Resolution =
  | { kind: 'mapped'; exerciseId: string; slug: string; via: 'map' | 'name' }
  | { kind: 'review'; reason: ReviewReason; detail: string; suggestions: string[] };

export interface ResolvedFile {
  file: string;
  key: string;
  resolution: Resolution;
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(name).toLowerCase());
}

function extensionOf(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

function basename(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

export function stem(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function vendorKey(filename: string): string {
  return slugify(stem(filename));
}

/** Mirrors the app's search normalisation: lower-case words, one trailing "s" dropped. */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/s$/, '');
}

/** The one reading of a vendor stem that is compared against library names. */
export function candidateName(stemText: string, stripPrefix?: RegExp): string {
  const withoutGender = stemText.replace(/[\s_.-]*(male|female)\s*$/i, '');
  return normalizeName(stripPrefix ? withoutGender.replace(stripPrefix, '') : withoutGender);
}

function tokens(text: string): Set<string> {
  return new Set(normalizeName(text).split(' ').filter(Boolean));
}

/** Review-list hints only: the closest library names by token overlap. */
export function suggestions(text: string, library: LibraryExercise[], limit = 3): string[] {
  const wanted = tokens(text);
  if (wanted.size === 0) return [];
  const scored = library
    .map(ex => {
      const have = tokens(ex.name);
      let shared = 0;
      for (const token of wanted) if (have.has(token)) shared++;
      const score = shared / (wanted.size + have.size - shared);
      return { id: ex.id, score };
    })
    .filter(s => s.score >= 0.3)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
  return scored.map(s => `${s.id} (${Math.round(s.score * 100)}%)`);
}

export interface Matcher {
  resolve(filename: string): Resolution;
}

export function createMatcher(library: LibraryExercise[], map: ClipMapEntry[], options: MatcherOptions = {}): Matcher {
  const byId = new Map(library.map(ex => [ex.id, ex]));
  const byName = new Map<string, Set<string>>();
  const index = (name: string, id: string) => {
    const normalized = normalizeName(name);
    if (!normalized) return;
    const ids = byName.get(normalized) ?? new Set<string>();
    ids.add(id);
    byName.set(normalized, ids);
  };
  for (const ex of library) {
    index(ex.name, ex.id);
    for (const alias of ex.aliases ?? []) index(alias, ex.id);
  }
  const byKey = new Map<string, ClipMapEntry>();
  const bySlug = new Map<string, string>();
  for (const entry of map) {
    const key = vendorKey(entry.source);
    if (byKey.has(key)) throw new Error(`clip-map: "${entry.source}" appears twice (vendor key ${key})`);
    byKey.set(key, entry);
    const slug = entry.slug?.trim();
    if (slug) {
      const other = bySlug.get(slug);
      if (other) throw new Error(`clip-map: slug "${slug}" is used by both "${other}" and "${entry.source}"`);
      bySlug.set(slug, entry.source);
    }
  }

  return {
    resolve(filename) {
      const entry = byKey.get(vendorKey(filename));
      if (entry) {
        const ex = byId.get(entry.exerciseId);
        if (!ex) {
          return {
            kind: 'review',
            reason: 'unknown-exercise-id',
            detail: `clip-map maps this file to "${entry.exerciseId}", which is not in the library`,
            suggestions: suggestions(entry.exerciseId.replace(/-/g, ' '), library),
          };
        }
        const slug = entry.slug?.trim() || ex.id;
        if (!SLUG_PATTERN.test(slug)) {
          return { kind: 'review', reason: 'bad-slug', detail: `clip-map slug "${slug}" is not kebab-case`, suggestions: [] };
        }
        return { kind: 'mapped', exerciseId: ex.id, slug, via: 'map' };
      }

      const name = candidateName(stem(filename), options.stripPrefix);
      const hits = [...(byName.get(name) ?? [])].sort();
      if (hits.length === 1) {
        const [id] = hits;
        return { kind: 'mapped', exerciseId: id, slug: id, via: 'name' };
      }
      if (hits.length > 1) {
        return {
          kind: 'review',
          reason: 'ambiguous',
          detail: `name matches more than one exercise: ${hits.join(', ')}`,
          suggestions: hits,
        };
      }
      return {
        kind: 'review',
        reason: 'no-match',
        detail: `no library exercise is named "${name || stem(filename)}"`,
        suggestions: suggestions(name || stem(filename), library),
      };
    },
  };
}

/**
 * Resolves every file, then applies the run-wide rules: a second file with
 * the same vendor key, or a second file resolving to an exercise or slug
 * another file already claimed, goes to review rather than silently winning.
 * Map rows claim first, so a human decision is never displaced by a name
 * match that happens to sort earlier. Files are taken in the order given, so
 * callers pass them sorted.
 */
export function resolveAll(
  files: string[],
  library: LibraryExercise[],
  map: ClipMapEntry[],
  options: MatcherOptions = {},
): ResolvedFile[] {
  const matcher = createMatcher(library, map, options);
  const seenKeys = new Map<string, string>();
  const resolved: ResolvedFile[] = files.map(file => {
    const key = vendorKey(file);
    const earlier = seenKeys.get(key);
    if (earlier !== undefined) {
      return {
        file,
        key,
        resolution: { kind: 'review', reason: 'duplicate-file', detail: `same vendor key as ${earlier}`, suggestions: [] },
      };
    }
    seenKeys.set(key, file);
    return { file, key, resolution: matcher.resolve(file) };
  });

  const claimedExercise = new Map<string, string>();
  const claimedSlug = new Map<string, string>();
  const claim = (entry: ResolvedFile): ResolvedFile => {
    const r = entry.resolution;
    if (r.kind !== 'mapped') return entry;
    const exerciseOwner = claimedExercise.get(r.exerciseId);
    if (exerciseOwner !== undefined) {
      return {
        ...entry,
        resolution: { kind: 'review', reason: 'duplicate-exercise', detail: `${r.exerciseId} is already taken by ${exerciseOwner}`, suggestions: [] },
      };
    }
    const slugOwner = claimedSlug.get(r.slug);
    if (slugOwner !== undefined) {
      return {
        ...entry,
        resolution: { kind: 'review', reason: 'duplicate-slug', detail: `slug ${r.slug} is already taken by ${slugOwner}`, suggestions: [] },
      };
    }
    claimedExercise.set(r.exerciseId, entry.file);
    claimedSlug.set(r.slug, entry.file);
    return entry;
  };
  for (const via of ['map', 'name'] as const) {
    resolved.forEach((entry, i) => {
      if (entry.resolution.kind === 'mapped' && entry.resolution.via === via) resolved[i] = claim(entry);
    });
  }
  return resolved;
}

/**
 * clip-map.csv: `source,exercise_id,slug,note` with a header row. Blank lines
 * and lines starting with # are ignored; fields may be double-quoted.
 */
export function parseClipMap(text: string): ClipMapEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: ClipMapEntry[] = [];
  let header: string[] | null = null;
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const fields = splitCsvLine(line);
    if (!header) {
      header = fields.map(f => f.trim().toLowerCase());
      const required = ['source', 'exercise_id'];
      for (const column of required) {
        if (!header.includes(column)) throw new Error(`clip-map line ${index + 1}: header is missing "${column}"`);
      }
      return;
    }
    const row: Record<string, string> = {};
    header.forEach((column, i) => {
      row[column] = (fields[i] ?? '').trim();
    });
    if (!row.source || !row.exercise_id) {
      throw new Error(`clip-map line ${index + 1}: source and exercise_id are both required`);
    }
    entries.push({
      source: row.source,
      exerciseId: row.exercise_id,
      slug: row.slug || undefined,
      note: row.note || undefined,
    });
  });
  if (!header) throw new Error('clip-map: no header row');
  return entries;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}
