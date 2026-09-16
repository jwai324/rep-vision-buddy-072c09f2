/**
 * Batch ingest of vendor exercise clips. One-time tooling, not product code:
 * nothing under scripts/ is reachable from the app bundle.
 *
 *   npx tsx scripts/clips/ingest.ts --src <vendor dir> --out <work dir>
 *       [--map scripts/clips/clip-map.csv] [--encode-only] [--force]
 *       [--limit N] [--width 512] [--dry-run]
 *
 * Environment, publish only: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Per file, in order:
 *   plan     every file is resolved to an exercise up front (naming.ts) and
 *            <out>/review.tsv is written before any encoding starts.
 *   encode   scripts/clips/encode.sh into <out>/work/<key>/; the outputs then
 *            move into <out>/encoded/ as <key>.webm, .mp4, .webp (poster) and
 *            .json (meta, written last). Every readable file is encoded,
 *            matched or not, so an overnight run is not wasted on the files
 *            the map does not cover yet. Skipped when all four outputs exist.
 *   publish  matched files only. Objects are named by content hash (plan.ts),
 *            uploaded when not already in the bucket, and the row upserted.
 *
 * Resumable by construction: an interrupted encode leaves nothing in
 * <out>/encoded/ (outputs move in only after ffmpeg finishes, meta last), an
 * interrupted upload leaves no object (a Storage upload is one request), and
 * the row upsert is idempotent. Re-running skips everything already done.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EXERCISE_DATABASE } from '../../src/data/exercises';
import type { Database } from '../../src/integrations/supabase/types';
import { isVideoFile, parseClipMap, resolveAll, stem, type ResolvedFile } from './naming';
import { objectName, planPublish, type ObjectKind } from './plan';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENCODE_SH = path.join(HERE, 'encode.sh');
const DEFAULT_MAP = path.join(HERE, 'clip-map.csv');
const BUCKET = 'exercise-clips';
// Objects are content-addressed, so they never change under a path.
const CACHE_CONTROL = String(365 * 24 * 60 * 60);
const MAX_CONSECUTIVE_ENCODE_FAILURES = 5;
const REQUIRED_ENCODERS = ['libvpx-vp9', 'libx264', 'libwebp'];

interface Options {
  src: string;
  out: string;
  map: string;
  encodeOnly: boolean;
  force: boolean;
  limit: number | null;
  width: number;
  dryRun: boolean;
}

interface EncodedMeta {
  key: string;
  sourceFile: string;
  bg: 'white' | 'green';
  width: number;
  height: number;
  durationMs: number;
  encodedAt: string;
}

type Client = SupabaseClient<Database>;
type ClipInsert = Database['public']['Tables']['exercise_clips']['Insert'];

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    'usage: npx tsx scripts/clips/ingest.ts --src <dir> --out <dir> [--map <csv>] [--encode-only] [--force] [--limit N] [--width 512] [--dry-run]',
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { src: '', out: '', map: DEFAULT_MAP, encodeOnly: false, force: false, limit: null, width: 512, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) usage(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--src': opts.src = value(); break;
      case '--out': opts.out = value(); break;
      case '--map': opts.map = value(); break;
      case '--limit': opts.limit = Number(value()); break;
      case '--width': opts.width = Number(value()); break;
      case '--encode-only': opts.encodeOnly = true; break;
      case '--force': opts.force = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--help': case '-h': usage(); break;
      default: usage(`unknown argument ${arg}`);
    }
  }
  if (!opts.src || !opts.out) usage('--src and --out are required');
  if (opts.limit !== null && !(Number.isInteger(opts.limit) && opts.limit > 0)) usage('--limit must be a positive integer');
  if (!(Number.isInteger(opts.width) && opts.width > 0)) usage('--width must be a positive integer');
  opts.src = path.resolve(opts.src);
  opts.out = path.resolve(opts.out);
  return opts;
}

function preflight(opts: Options): void {
  if (!fs.existsSync(opts.src) || !fs.statSync(opts.src).isDirectory()) usage(`--src ${opts.src} is not a directory`);
  if (!fs.existsSync(opts.map)) usage(`--map ${opts.map} does not exist`);
  if (!fs.existsSync(ENCODE_SH)) usage(`${ENCODE_SH} is missing`);
  const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (encoders.status !== 0) usage('ffmpeg is not on PATH');
  for (const encoder of REQUIRED_ENCODERS) {
    if (!encoders.stdout.includes(` ${encoder} `)) usage(`this ffmpeg build lacks the ${encoder} encoder`);
  }
  if (spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status !== 0) usage('ffprobe is not on PATH');
  if (!opts.encodeOnly && !opts.dryRun && !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    usage('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to publish (or pass --encode-only)');
  }
}

function listVideos(dir: string, out: string): string[] {
  const found: string[] = [];
  const outPrefix = out + path.sep;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (full === out || full.startsWith(outPrefix)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isVideoFile(entry.name)) found.push(full);
    }
  };
  walk(dir);
  return found.map(f => path.relative(dir, f)).sort();
}

class ReviewList {
  private rows = 0;

  constructor(private readonly file: string) {
    fs.writeFileSync(file, 'file\tvendor_key\treason\tdetail\tsuggestions\n');
  }

  add(file: string, key: string, reason: string, detail: string, suggestions: string[] = []): void {
    const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
    fs.appendFileSync(this.file, [file, key, reason, detail, suggestions.join('; ')].map(clean).join('\t') + '\n');
    this.rows++;
  }

  get count(): number {
    return this.rows;
  }
}

function encodedPaths(out: string, key: string) {
  const dir = path.join(out, 'encoded');
  return {
    dir,
    webm: path.join(dir, `${key}.webm`),
    mp4: path.join(dir, `${key}.mp4`),
    poster: path.join(dir, `${key}.webp`),
    meta: path.join(dir, `${key}.json`),
  };
}

function readMeta(out: string, key: string): EncodedMeta | null {
  const p = encodedPaths(out, key);
  if (![p.webm, p.mp4, p.poster, p.meta].every(f => fs.existsSync(f) && fs.statSync(f).size > 0)) return null;
  return JSON.parse(fs.readFileSync(p.meta, 'utf8')) as EncodedMeta;
}

function writeFileAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function run(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// The alpha channel only decodes through libvpx; the native VP9 decoder
// silently drops it, which would bake the poster onto black.
function extractPoster(webm: string, dest: string): void {
  for (const frame of [10, 0]) {
    fs.rmSync(dest, { force: true });
    const r = run('ffmpeg', [
      '-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', webm,
      '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1',
      '-c:v', 'libwebp', '-q:v', '80', '-pix_fmt', 'yuva420p', dest,
    ]);
    if (r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  }
  throw new Error(`poster extraction failed for ${webm}`);
}

function probeVideo(file: string): { width: number; height: number; durationMs: number } {
  const r = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file,
  ]);
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr.trim()}`);
  const info = JSON.parse(r.stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
  const stream = info.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const durationMs = Math.round(Number(info.format?.duration) * 1000);
  if (!(width > 0 && height > 0 && durationMs > 0)) throw new Error(`ffprobe gave no usable dimensions for ${file}: ${r.stdout}`);
  return { width, height, durationMs };
}

type EncodeResult =
  | { status: 'encoded' | 'skipped'; meta: EncodedMeta }
  | { status: 'review'; reason: string };

function encodeOne(srcPath: string, key: string, opts: Options): EncodeResult {
  const done = readMeta(opts.out, key);
  if (done && !opts.force) return { status: 'skipped', meta: done };

  const work = path.join(opts.out, 'work', key);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const encode = run('bash', [ENCODE_SH, srcPath, work, String(opts.width)]);
  if (encode.status === 3) {
    fs.rmSync(work, { recursive: true, force: true });
    const reason = encode.stderr.trim().split('\n').pop() ?? 'background not recognised';
    return { status: 'review', reason: reason.replace(/^SKIP [^:]*: /, '') };
  }
  if (encode.status !== 0) throw new Error(`encode.sh exited ${encode.status}: ${encode.stderr.trim()}`);

  const name = stem(srcPath);
  const webm = path.join(work, `${name}.webm`);
  const mp4 = path.join(work, `${name}.mp4`);
  const bg = fs.readFileSync(path.join(work, `${name}.bg`), 'utf8').trim();
  if (bg !== 'white' && bg !== 'green') throw new Error(`encode.sh reported an unexpected background "${bg}"`);
  const poster = path.join(work, 'poster.webp');
  extractPoster(webm, poster);
  const probe = probeVideo(mp4);

  const meta: EncodedMeta = { key, sourceFile: path.basename(srcPath), bg, ...probe, encodedAt: new Date().toISOString() };
  const final = encodedPaths(opts.out, key);
  fs.mkdirSync(final.dir, { recursive: true });
  fs.renameSync(webm, final.webm);
  fs.renameSync(mp4, final.mp4);
  fs.renameSync(poster, final.poster);
  writeFileAtomic(final.meta, JSON.stringify(meta, null, 2) + '\n');
  fs.rmSync(work, { recursive: true, force: true });
  return { status: 'encoded', meta };
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

type PublishResult = { status: 'published' | 'skipped' } | { status: 'review'; reason: string };

async function publishOne(
  sb: Client,
  entry: ResolvedFile & { resolution: { kind: 'mapped'; exerciseId: string; slug: string } },
  meta: EncodedMeta,
  opts: Options,
): Promise<PublishResult> {
  const { exerciseId, slug } = entry.resolution;
  const files = encodedPaths(opts.out, entry.key);
  const objects: { kind: ObjectKind; local: string; contentType: string; path: string }[] = [
    { kind: 'webm', local: files.webm, contentType: 'video/webm', path: objectName(slug, 'webm', sha256(files.webm)) },
    { kind: 'mp4', local: files.mp4, contentType: 'video/mp4', path: objectName(slug, 'mp4', sha256(files.mp4)) },
    { kind: 'poster', local: files.poster, contentType: 'image/webp', path: objectName(slug, 'poster', sha256(files.poster)) },
  ];

  const { data: existing, error: readError } = await sb
    .from('exercise_clips')
    .select('exercise_id, slug, webm_path, mp4_path, poster_path, source_file')
    .eq('exercise_id', exerciseId)
    .maybeSingle();
  if (readError) throw new Error(`reading exercise_clips for ${exerciseId}: ${readError.message}`);

  const plan = planPublish({ existing, sourceFile: meta.sourceFile, force: opts.force, objects });
  if (plan.action === 'skip-done') return { status: 'skipped' };
  if (plan.action === 'skip-conflict') return { status: 'review', reason: plan.detail };

  const bucket = sb.storage.from(BUCKET);
  for (const object of objects) {
    if (!opts.force) {
      const { data: present, error: existsError } = await bucket.exists(object.path);
      if (existsError) throw new Error(`checking ${object.path}: ${existsError.message}`);
      if (present) continue;
    }
    const { error: uploadError } = await bucket.upload(object.path, fs.readFileSync(object.local), {
      contentType: object.contentType,
      cacheControl: CACHE_CONTROL,
      upsert: true,
    });
    if (uploadError) throw new Error(`uploading ${object.path}: ${uploadError.message}`);
  }

  const byKind = Object.fromEntries(objects.map(o => [o.kind, o.path])) as Record<ObjectKind, string>;
  const row: ClipInsert = {
    exercise_id: exerciseId,
    slug,
    webm_path: byKind.webm,
    mp4_path: byKind.mp4,
    poster_path: byKind.poster,
    duration_ms: meta.durationMs,
    width: meta.width,
    height: meta.height,
    source_bg: meta.bg,
    source_file: meta.sourceFile,
  };
  const { error: upsertError } = await sb.from('exercise_clips').upsert(row, { onConflict: 'exercise_id' });
  if (upsertError) return { status: 'review', reason: `row upsert failed: ${upsertError.message}` };

  if (plan.stale.length > 0) {
    const { error: removeError } = await bucket.remove(plan.stale);
    if (removeError) console.warn(`  warning: could not remove replaced objects ${plan.stale.join(', ')}: ${removeError.message}`);
  }
  return { status: 'published' };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  preflight(opts);
  fs.mkdirSync(opts.out, { recursive: true });

  const files = listVideos(opts.src, opts.out);
  const map = parseClipMap(fs.readFileSync(opts.map, 'utf8'));
  const resolved = resolveAll(files, EXERCISE_DATABASE, map);

  const reviewPath = path.join(opts.out, 'review.tsv');
  const review = new ReviewList(reviewPath);
  for (const r of resolved) {
    if (r.resolution.kind === 'review') review.add(r.file, r.key, r.resolution.reason, r.resolution.detail, r.resolution.suggestions);
  }
  const matched = resolved.filter(r => r.resolution.kind === 'mapped').length;
  console.log(`${resolved.length} video files under ${opts.src}: ${matched} matched to an exercise, ${resolved.length - matched} listed in ${reviewPath}`);

  if (opts.dryRun) {
    for (const r of resolved) {
      const what = r.resolution.kind === 'mapped'
        ? `${r.resolution.exerciseId} (slug ${r.resolution.slug}, via ${r.resolution.via})`
        : `review: ${r.resolution.reason}`;
      console.log(`  ${r.file} -> ${what}`);
    }
    return;
  }

  const sb: Client | null = opts.encodeOnly
    ? null
    : createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

  const todo = opts.limit ? resolved.slice(0, opts.limit) : resolved;
  const counts = { encoded: 0, encodeSkipped: 0, encodeReview: 0, encodeFailed: 0, unmatched: 0, published: 0, publishSkipped: 0, publishReview: 0 };
  let consecutiveFailures = 0;

  for (const [i, entry] of todo.entries()) {
    const label = `[${i + 1}/${todo.length}] ${entry.file}`;
    if (entry.resolution.kind === 'review' && entry.resolution.reason === 'duplicate-file') {
      console.log(`${label}: duplicate of an earlier file, skipped`);
      continue;
    }

    let encoded: EncodeResult;
    try {
      encoded = encodeOne(path.join(opts.src, entry.file), entry.key, opts);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      counts.encodeFailed++;
      review.add(entry.file, entry.key, 'encode-failed', message(err));
      console.error(`${label}: encode FAILED: ${message(err)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_ENCODE_FAILURES) {
        throw new Error(`${MAX_CONSECUTIVE_ENCODE_FAILURES} encodes failed in a row; stopping so the problem can be looked at`);
      }
      continue;
    }
    if (encoded.status === 'review') {
      counts.encodeReview++;
      review.add(entry.file, entry.key, 'background', encoded.reason);
      console.log(`${label}: encode -> review (${encoded.reason})`);
      continue;
    }
    if (encoded.status === 'encoded') counts.encoded++;
    else counts.encodeSkipped++;

    if (entry.resolution.kind !== 'mapped') {
      counts.unmatched++;
      console.log(`${label}: encode=${encoded.status} publish=unmatched (${entry.resolution.reason})`);
      continue;
    }
    if (!sb) {
      console.log(`${label}: encode=${encoded.status} publish=off (--encode-only)`);
      continue;
    }

    const published = await publishOne(sb, entry as Parameters<typeof publishOne>[1], encoded.meta, opts);
    if (published.status === 'review') {
      counts.publishReview++;
      review.add(entry.file, entry.key, 'publish', published.reason);
      console.log(`${label}: encode=${encoded.status} publish -> review (${published.reason})`);
    } else {
      if (published.status === 'published') counts.published++;
      else counts.publishSkipped++;
      console.log(`${label}: encode=${encoded.status} publish=${published.status} (${entry.resolution.exerciseId})`);
    }
  }

  console.log(
    `\ndone: encoded ${counts.encoded}, already encoded ${counts.encodeSkipped}, background review ${counts.encodeReview}, encode failed ${counts.encodeFailed}; ` +
      `published ${counts.published}, already published ${counts.publishSkipped}, publish review ${counts.publishReview}, unmatched ${counts.unmatched}. ` +
      `${review.count} review rows in ${reviewPath}`,
  );
}

main().catch(err => {
  console.error(message(err));
  process.exit(1);
});
