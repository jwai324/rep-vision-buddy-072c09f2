# Exercise clip ingest

One-time tooling that turns a vendor library of exercise videos into the two
variants the app serves and registers them in Supabase. Nothing here ships in
the app bundle.

```
npx tsx scripts/clips/ingest.ts --src ~/vendor-clips --out ~/clips-work
```

Requires `ffmpeg` and `ffprobe` on `PATH` with the `libvpx-vp9`, `libx264` and
`libwebp` encoders (Homebrew's and Ubuntu's builds have all three). Publishing
needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exported in the shell;
never put the service key in `.env`, which Vite reads.

## What it produces

For each vendor file, three Storage objects in the public `exercise-clips`
bucket and one row in `public.exercise_clips`:

| object                      | what                                              |
| --------------------------- | ------------------------------------------------- |
| `<slug>-<hash>.webm`        | VP9 with alpha, transparent background, 512 wide  |
| `<slug>-<hash>.mp4`         | H.264, figure flattened onto white, 512 wide      |
| `<slug>-<hash>.webp`        | poster frame with alpha (frame 10, else frame 0)  |

`<hash>` is the first 12 hex characters of the object's SHA-256, so a re-encode
lands on a new path (no CDN cache to wait out) and a path cannot be guessed from
an exercise name. The row carries width, height and duration so the app can
reserve the box before the media loads.

The bucket has no `storage.objects` policy on purpose. Objects are served by
exact path; listing goes through RLS and finds nothing. The table is readable
by signed-in users only.

## The slug rule

Defined once, in `naming.ts`:

1. `clip-map.csv` wins. Match is by the file's *vendor key*, the filename stem
   lower-cased with runs of punctuation collapsed to `-`, so casing and
   separators do not matter. `exercise_id` must exist in
   `src/data/exercises.ts`; `slug` is optional and defaults to the id.
2. Otherwise an exact name match: the stem minus a leading numeric prefix and a
   trailing `male`/`female` token, normalised like the app's search, compared
   with each library exercise's name and aliases. One hit is a match. Zero or
   more than one is not.
3. Otherwise the file goes to `<out>/review.tsv` with up to three suggestions.
   Suggestions are for the human; the script never uses them.

A second file with the same vendor key, or a second file resolving to an
exercise another file already claimed (in this run or in the table), also goes
to review rather than silently winning. `--force` is the only way to replace an
existing clip.

Answer the review list by adding rows to `clip-map.csv` and re-running.

## Resumability

Stages are skipped when their outputs exist, so a run killed at file 1,800
resumes at file 1,800:

- **encode** runs `encode.sh` in `<out>/work/<key>/` and moves the outputs into
  `<out>/encoded/` only once ffmpeg has finished, the meta JSON last. A
  half-written encode never counts as done; the work directory is discarded on
  the next attempt.
- **upload** checks each object's existence in the bucket first. A Storage
  upload is one request, so an interrupted one leaves no object.
- **row** upsert is idempotent.

Every readable file is encoded whether or not it matched, so the long
overnight encode happens once and later map answers publish in seconds.
`--encode-only` runs the encode stage without credentials; `--dry-run` prints
the plan and writes the review list without touching anything else.

## encode.sh

`encode.sh <input> <outdir> [width]` keys the background and writes the two
video variants. The constants are the verified ones and are not to be retuned:
30 fps, 512 wide (lanczos), VP9 `yuva420p` at crf 36 (`-deadline good
-cpu-used 5 -row-mt 1`), H.264 crf 30 preset slow with faststart, green keyed
with `chromakey 0.14/0.05` plus despill, white with `colorkey 0.05/0.02`.

The background is sampled from a 40×40 patch in each corner of frame 10. The
top-left patch keys the clip. All four must classify the same way, as
near-white (every channel ≥ 245) or green (G ≥ 160, R and B ≤ 90); anything
else exits 3 and is appended to `<outdir>/encode-review.log` instead of being
keyed wrong. The ingest records such files under `background` in `review.tsv`.

No per-clip autocrop: bounding boxes vary enormously between clips, and a
figure that changes size from tile to tile reads as sloppy. If cropping is ever
done it will be one library-wide box.

## Serving

`src/config/exerciseClips.ts` holds `CLIP_MODE`, which picks the variant the app
serves, and the dev-only override for testing both on a device from one build.
