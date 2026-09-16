import { describe, it, expect } from 'vitest';
import {
  candidateName,
  createMatcher,
  isVideoFile,
  normalizeName,
  parseClipMap,
  resolveAll,
  vendorKey,
  type LibraryExercise,
} from '../../scripts/clips/naming';
import { objectName, planPublish, type ExistingClipRow } from '../../scripts/clips/plan';

const library: LibraryExercise[] = [
  { id: 'air-squat', name: 'Air Squat', aliases: ['bodyweight squat'] },
  { id: 'push-up', name: 'Push-Up' },
  { id: 'pull-up', name: 'Pull-Up' },
  { id: 'weighted-pull-up', name: 'Weighted Pull-Up' },
  { id: 'chin-up', name: 'Chin-Up', aliases: ['chin ups'] },
  { id: 'jump-squat', name: 'Jump Squat' },
  { id: 'kettlebell-swing', name: 'Kettlebell Swing', aliases: ['kb swing'] },
  { id: 'american-kettlebell-swing', name: 'American Kettlebell Swing', aliases: ['kb swing'] },
];

const CATALOGUE_PREFIX = /^\d{4}[_-]/;
const match = (file: string, map: Parameters<typeof createMatcher>[1] = [], options: Parameters<typeof createMatcher>[2] = {}) =>
  createMatcher(library, map, options).resolve(file);

describe('vendorKey', () => {
  it('is the lower-cased stem with runs of punctuation collapsed to one hyphen', () => {
    expect(vendorKey('0123_Bodyweight_Squat.MP4')).toBe('0123-bodyweight-squat');
    expect(vendorKey('0123-bodyweight-squat.mp4')).toBe('0123-bodyweight-squat');
    expect(vendorKey('sub/dir/Foo  Bar (1).mov')).toBe('foo-bar-1');
  });

  it('keeps a leading number, which may be part of the name', () => {
    expect(vendorKey('180_Jump_Turns_Male.mp4')).toBe('180-jump-turns-male');
  });

  it('recognises video files by extension only', () => {
    expect(isVideoFile('a.MP4')).toBe(true);
    expect(isVideoFile('a.webm')).toBe(true);
    expect(isVideoFile('a.mp4.json')).toBe(false);
    expect(isVideoFile('notes.txt')).toBe(false);
  });
});

describe('candidateName', () => {
  it('normalises like the app search: lower-case words, one trailing s dropped', () => {
    expect(normalizeName('Chin-Ups')).toBe('chin up');
    expect(normalizeName('  Push   Up ')).toBe('push up');
  });

  it('drops a trailing gender token and keeps a leading number unless a prefix rule says otherwise', () => {
    expect(candidateName('0123_Push_Up')).toBe('0123 push up');
    expect(candidateName('0123_Push_Up', CATALOGUE_PREFIX)).toBe('push up');
    expect(candidateName('Bodyweight_Squat_female')).toBe('bodyweight squat');
    expect(candidateName('180_Jump_Turns_Male')).toBe('180 jump turn');
  });
});

describe('createMatcher', () => {
  it('matches an exact library name regardless of case, separators and gender', () => {
    expect(match('push-UP_male.mp4')).toEqual({ kind: 'mapped', exerciseId: 'push-up', slug: 'push-up', via: 'name' });
  });

  it('strips a catalogue prefix only when the operator has declared one', () => {
    const undeclared = match('0042_push-UP_male.mp4');
    expect(undeclared).toMatchObject({ kind: 'review', reason: 'no-match' });
    if (undeclared.kind === 'review') expect(undeclared.suggestions.join(' ')).toContain('push-up');
    expect(match('0042_push-UP_male.mp4', [], { stripPrefix: CATALOGUE_PREFIX })).toEqual({ kind: 'mapped', exerciseId: 'push-up', slug: 'push-up', via: 'name' });
  });

  it('a leading number that is part of the name is never guessed away', () => {
    const r = match('180_Jump_Squat.mp4');
    expect(r).toMatchObject({ kind: 'review', reason: 'no-match' });
    if (r.kind === 'review') expect(r.suggestions.join(' ')).toContain('jump-squat');
    expect(match('180_Jump_Squat.mp4', [], { stripPrefix: CATALOGUE_PREFIX })).toMatchObject({ kind: 'review', reason: 'no-match' });
  });

  it('matches an alias', () => {
    expect(match('Bodyweight_Squat.mp4')).toEqual({ kind: 'mapped', exerciseId: 'air-squat', slug: 'air-squat', via: 'name' });
  });

  it('never fuzzy-matches: a near miss goes to review with suggestions it does not act on', () => {
    const r = match('Squat.mp4');
    expect(r.kind).toBe('review');
    if (r.kind !== 'review') return;
    expect(r.reason).toBe('no-match');
    expect(r.suggestions.join(' ')).toContain('air-squat');
    expect(r.suggestions.join(' ')).toContain('jump-squat');
  });

  it('a name shared by two exercises is ambiguous, not a coin flip', () => {
    const r = match('KB_Swing.mp4');
    expect(r.kind).toBe('review');
    if (r.kind !== 'review') return;
    expect(r.reason).toBe('ambiguous');
    expect(r.suggestions).toEqual(['american-kettlebell-swing', 'kettlebell-swing']);
  });

  it('clip-map.csv wins over the name match and is keyed by vendor key', () => {
    const map = [{ source: '0123-BODYWEIGHT-SQUAT.mov', exerciseId: 'jump-squat' }];
    expect(match('0123_Bodyweight_Squat.mp4', map)).toEqual({ kind: 'mapped', exerciseId: 'jump-squat', slug: 'jump-squat', via: 'map' });
  });

  it('honours an explicit slug from the map and defaults it to the exercise id', () => {
    expect(match('x.mp4', [{ source: 'x.mp4', exerciseId: 'air-squat', slug: 'bodyweight-squat' }])).toMatchObject({ slug: 'bodyweight-squat' });
    expect(match('x.mp4', [{ source: 'x.mp4', exerciseId: 'air-squat' }])).toMatchObject({ slug: 'air-squat' });
  });

  it('refuses a map row whose exercise id is not in the library', () => {
    const r = match('x.mp4', [{ source: 'x.mp4', exerciseId: 'body-weight-squat' }]);
    expect(r).toMatchObject({ kind: 'review', reason: 'unknown-exercise-id' });
  });

  it('refuses a map slug that is not kebab-case', () => {
    const r = match('x.mp4', [{ source: 'x.mp4', exerciseId: 'air-squat', slug: 'Air Squat' }]);
    expect(r).toMatchObject({ kind: 'review', reason: 'bad-slug' });
  });

  it('rejects a map that names the same file twice', () => {
    expect(() =>
      createMatcher(library, [
        { source: 'a.mp4', exerciseId: 'air-squat' },
        { source: 'A.MP4', exerciseId: 'push-up' },
      ]),
    ).toThrow(/appears twice/);
  });

  it('rejects a map that gives two files the same slug', () => {
    expect(() =>
      createMatcher(library, [
        { source: 'a.mp4', exerciseId: 'air-squat', slug: 'squat' },
        { source: 'b.mp4', exerciseId: 'jump-squat', slug: 'squat' },
      ]),
    ).toThrow(/slug "squat"/);
  });
});

describe('resolveAll', () => {
  it('sends a second file with the same vendor key to review', () => {
    const out = resolveAll(['Push_Up.mp4', 'push-up.MOV'], library, []);
    expect(out[0].resolution.kind).toBe('mapped');
    expect(out[1].resolution).toMatchObject({ kind: 'review', reason: 'duplicate-file' });
  });

  it('sends a second file claiming an exercise another file took to review', () => {
    const out = resolveAll(['Air_Squat.mp4', 'Bodyweight_Squat.mp4'], library, []);
    expect(out[0].resolution).toMatchObject({ kind: 'mapped', exerciseId: 'air-squat' });
    expect(out[1].resolution).toMatchObject({ kind: 'review', reason: 'duplicate-exercise' });
  });

  it('a clip-map row keeps its exercise even when a name match sorts earlier', () => {
    const map = [{ source: 'Bodyweight_Squat.mp4', exerciseId: 'air-squat' }];
    const out = resolveAll(['0001_Air_Squat.mp4', 'Bodyweight_Squat.mp4'], library, map, { stripPrefix: CATALOGUE_PREFIX });
    expect(out[1].resolution).toMatchObject({ kind: 'mapped', exerciseId: 'air-squat', via: 'map' });
    expect(out[0].resolution).toMatchObject({ kind: 'review', reason: 'duplicate-exercise' });
  });

  it('sends a file whose slug another file already holds to review', () => {
    const map = [{ source: 'x.mp4', exerciseId: 'air-squat', slug: 'jump-squat' }];
    const out = resolveAll(['Jump_Squat.mp4', 'x.mp4'], library, map);
    expect(out[1].resolution).toMatchObject({ kind: 'mapped', exerciseId: 'air-squat', slug: 'jump-squat', via: 'map' });
    expect(out[0].resolution).toMatchObject({ kind: 'review', reason: 'duplicate-slug' });
  });

  it('applies the prefix rule to the name match', () => {
    const out = resolveAll(['0042_Push_Up_Male.mp4'], library, [], { stripPrefix: CATALOGUE_PREFIX });
    expect(out[0].resolution).toMatchObject({ kind: 'mapped', exerciseId: 'push-up', via: 'name' });
  });
});

describe('parseClipMap', () => {
  it('reads the header, skips comments and blanks, and handles quoted commas', () => {
    const entries = parseClipMap([
      '# a comment',
      '',
      'source,exercise_id,slug,note',
      'Bodyweight_Squat.mp4,air-squat,bodyweight-squat,"squat, unloaded"',
      'Push_Up.mp4,push-up,,',
    ].join('\n'));
    expect(entries).toEqual([
      { source: 'Bodyweight_Squat.mp4', exerciseId: 'air-squat', slug: 'bodyweight-squat', note: 'squat, unloaded' },
      { source: 'Push_Up.mp4', exerciseId: 'push-up', slug: undefined, note: undefined },
    ]);
  });

  it('rejects a row missing a required field', () => {
    expect(() => parseClipMap('source,exercise_id\nx.mp4,')).toThrow(/line 2/);
  });

  it('rejects a file with no header', () => {
    expect(() => parseClipMap('# only comments\n')).toThrow(/no header/);
    expect(() => parseClipMap('file,id\nx.mp4,air-squat')).toThrow(/missing "source"/);
  });
});

describe('objectName', () => {
  const digest = 'a'.repeat(64);

  it('is slug, twelve hex of the digest, extension', () => {
    expect(objectName('air-squat', 'webm', digest)).toBe('air-squat-aaaaaaaaaaaa.webm');
    expect(objectName('air-squat', 'poster', digest)).toBe('air-squat-aaaaaaaaaaaa.webp');
  });

  it('refuses anything that is not a sha256 digest', () => {
    expect(() => objectName('air-squat', 'mp4', 'abc')).toThrow(/sha256/);
  });
});

describe('planPublish', () => {
  const objects = [
    { kind: 'webm' as const, path: 'air-squat-111111111111.webm' },
    { kind: 'mp4' as const, path: 'air-squat-222222222222.mp4' },
    { kind: 'poster' as const, path: 'air-squat-333333333333.webp' },
  ];
  const row = (over: Partial<ExistingClipRow> = {}): ExistingClipRow => ({
    exercise_id: 'air-squat',
    slug: 'air-squat',
    webm_path: 'air-squat-111111111111.webm',
    mp4_path: 'air-squat-222222222222.mp4',
    poster_path: 'air-squat-333333333333.webp',
    source_file: 'Bodyweight_Squat.mp4',
    ...over,
  });

  it('publishes when there is no row', () => {
    expect(planPublish({ existing: null, sourceFile: 'Bodyweight_Squat.mp4', force: false, objects })).toEqual({ action: 'publish', stale: [] });
  });

  it('is done when the row already points at exactly these objects', () => {
    expect(planPublish({ existing: row(), sourceFile: 'Bodyweight_Squat.mp4', force: false, objects })).toEqual({ action: 'skip-done' });
  });

  it('re-publishes a changed encode and names the objects it replaces', () => {
    const plan = planPublish({ existing: row({ webm_path: 'air-squat-000000000000.webm' }), sourceFile: 'Bodyweight_Squat.mp4', force: false, objects });
    expect(plan).toEqual({ action: 'publish', stale: ['air-squat-000000000000.webm'] });
  });

  it('refuses to replace a clip that came from a different vendor file unless forced', () => {
    const existing = row({ source_file: 'Other_Squat.mp4' });
    expect(planPublish({ existing, sourceFile: 'Bodyweight_Squat.mp4', force: false, objects })).toMatchObject({ action: 'skip-conflict' });
    expect(planPublish({ existing, sourceFile: 'Bodyweight_Squat.mp4', force: true, objects })).toMatchObject({ action: 'publish' });
  });

  it('--force re-publishes even an unchanged clip', () => {
    expect(planPublish({ existing: row(), sourceFile: 'Bodyweight_Squat.mp4', force: true, objects })).toEqual({ action: 'publish', stale: [] });
  });
});
