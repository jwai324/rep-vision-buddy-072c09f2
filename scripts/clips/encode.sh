#!/usr/bin/env bash
# Exercise clip pipeline: detect background -> key -> encode alpha WebM + opaque MP4
# Usage: ./encode.sh <input.mp4> <outdir> [width]
#
# Exit codes: 0 encoded; 3 skipped for review (background not recognised, the
# file is appended to <outdir>/encode-review.log); anything else is an ffmpeg
# failure. On success <outdir>/<name>.bg holds the detected background,
# "white" or "green", for the ingest script.
#
# The encode constants (fps, keying, codecs, quality) are the verified ones.
# Do not retune them here.
set -euo pipefail

IN="$1"; OUT="${2:-out}"; W="${3:-512}"
NAME="$(basename "${IN%.*}")"
mkdir -p "$OUT"

# --- Background tolerance. Vendor libraries are heterogeneous; a colour that
#     is not clearly one of the two known backgrounds is sent to review, not
#     keyed against and hoped for.
WHITE_MIN=245      # near-white: every channel at or above this
GREEN_G_MIN=160    # pure-green tolerance: G at or above this ...
GREEN_RB_MAX=90    # ... with R and B at or below this

# One 40x40 patch of frame 10, averaged to a pixel. $1 is the crop x:y. Prints rrggbb.
sample_corner() {
  ffmpeg -v error -i "$IN" -vf "select='eq(n\,10)',crop=40:40:$1,scale=1:1" \
         -vsync 0 -frames:v 1 -f rawvideo -pix_fmt rgb24 - 2>/dev/null \
         | od -An -tx1 -v | tr -d ' \n' | head -c6
}

# rrggbb -> white | green | unknown
classify() {
  local hex="$1"
  [[ "$hex" =~ ^[0-9a-f]{6}$ ]] || { echo unknown; return; }
  local r=$((16#${hex:0:2})) g=$((16#${hex:2:2})) b=$((16#${hex:4:2}))
  if [ "$r" -ge "$WHITE_MIN" ] && [ "$g" -ge "$WHITE_MIN" ] && [ "$b" -ge "$WHITE_MIN" ]; then
    echo white
  elif [ "$g" -ge "$GREEN_G_MIN" ] && [ "$r" -le "$GREEN_RB_MAX" ] && [ "$b" -le "$GREEN_RB_MAX" ]; then
    echo green
  else
    echo unknown
  fi
}

skip_for_review() {
  printf '%s\t%s\t%s\n' "$NAME" "$1" "$IN" >> "$OUT/encode-review.log"
  echo "SKIP $NAME: $1" >&2
  exit 3
}

# --- 1. Sample the background colour. The top-left corner keys the clip, as
#        before. The other three corners must agree on the class: a figure,
#        shadow or watermark reaching a corner sends the file to review rather
#        than keying it against the wrong colour.
BGHEX=$(sample_corner 4:4)
MODE=$(classify "$BGHEX")
[ "$MODE" != unknown ] || skip_for_review "background #${BGHEX:-none} is neither near-white (all channels >= ${WHITE_MIN}) nor green"
for pos in "iw-44:4" "4:ih-44" "iw-44:ih-44"; do
  hex=$(sample_corner "$pos"); cls=$(classify "$hex")
  [ "$cls" = "$MODE" ] || skip_for_review "corners disagree: top-left #${BGHEX} is ${MODE}, corner ${pos} #${hex:-none} is ${cls}"
done

if [ "$MODE" = green ]; then
  KEY="chromakey=0x${BGHEX}:0.14:0.05,despill=type=green:mix=0.18:expand=0.05"
else
  KEY="colorkey=0x${BGHEX}:0.05:0.02"
fi

# --- 2. Report content bounding box (NOTE: needs -v info, cropdetect logs at INFO) ---
BBOX=$(ffmpeg -v info -i "$IN" \
  -vf "fps=6,${KEY},alphaextract,format=gray,cropdetect=limit=0.02:round=2:reset=0" \
  -f null - 2>&1 | grep -o 'crop=[0-9:]*' | tail -1 || true)

# --- 3. Encode. Full frame kept on purpose: per-clip autocrop makes the
#        mannequin a different size in every clip, which reads as inconsistent
#        in a grid. Crop to a single library-wide box instead, if at all.
CHAIN="fps=30,${KEY},scale=${W}:-2:flags=lanczos"

ffmpeg -v error -y -i "$IN" -vf "$CHAIN" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -crf 36 -b:v 0 -an \
  -row-mt 1 -deadline good -cpu-used 5 "$OUT/${NAME}.webm"

ffmpeg -v error -y -i "$IN" -vf "${CHAIN},format=yuv420p" \
  -c:v libx264 -crf 30 -preset slow -movflags +faststart -an "$OUT/${NAME}.mp4"

echo "$MODE" > "$OUT/${NAME}.bg"

printf "%-46s %-6s src=%-6s webm=%-7s mp4=%-7s %s\n" \
  "${NAME:0:46}" "$MODE" "$(du -h "$IN" | cut -f1)" \
  "$(du -h "$OUT/${NAME}.webm" | cut -f1)" \
  "$(du -h "$OUT/${NAME}.mp4" | cut -f1)" "$BBOX"
