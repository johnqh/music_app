#!/usr/bin/env bash
#
# Regenerates every app icon from public/logo.png.
#
# Run after replacing the logo:  bun run icons
#
# Two things this does that a plain resize does not:
#
#   * Re-centres. The artwork arrived with uneven padding (left 123px, right
#     56px, top 52px, bottom 102px on a 1254px canvas), which is invisible at
#     full size and obvious in a 16px browser tab. Everything is trimmed to the
#     ink and re-padded symmetrically, so the mark sits dead centre at every
#     size.
#
#   * Flattens the Apple touch icon onto white. iOS does not honour alpha on a
#     home-screen icon — it composites the transparent area onto black, which
#     turns a red-on-nothing mark into red-on-black. Every other output keeps
#     its transparency.
#
# Requires ImageMagick (`brew install imagemagick`).
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="public/logo.png"
OUT="public"

[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }

# The mark fills 88% of the canvas: tight enough to stay legible in a tab,
# with enough margin that it is not clipped by a circular or rounded mask.
FILL=88

# Captured rather than `read`, which returns non-zero on output with no
# trailing newline and would trip `set -e`.
DIMS=$(magick "$SRC" -trim +repage -format "%w %h" info:)
W=${DIMS% *}
H=${DIMS#* }
LONG=$(( W > H ? W : H ))
CANVAS=$(( LONG * 100 / FILL ))

# One normalised square master; every size below is a clean downscale of it.
MASTER="$(mktemp -t moosiac-icon).png"
magick "$SRC" -trim +repage \
  -background none -gravity center -extent "${CANVAS}x${CANVAS}" \
  "$MASTER"

png() {  # png <size> <path>
  magick "$MASTER" -filter Lanczos -resize "${1}x${1}" -strip "$2"
}

# Below ~32px a plain downscale goes mushy: the beam thins to nothing and the
# spark smears into the beam. A light unsharp after resizing restores the
# notehead edges and keeps the spark a distinct dot. Compared side by side at
# 8x magnification before choosing these numbers.
small_png() {  # small_png <size> <path>
  magick "$MASTER" -filter Lanczos -resize "${1}x${1}" \
    -unsharp 0x0.6+0.8+0.02 -strip "$2"
}

png 512 "$OUT/icon-512.png"
png 192 "$OUT/icon-192.png"
small_png 32 "$OUT/favicon-32.png"
small_png 16 "$OUT/favicon-16.png"

# The in-app topbar/footer logo. Its own file rather than reusing logo.png,
# which is 1254px and ~430KB for a mark drawn at 28px.
png 96 "$OUT/logo-96.png"

# Multi-resolution .ico, which is what a browser asks for at /favicon.ico when
# no link tag names anything better — and what older ones use regardless.
magick "$MASTER" -filter Lanczos -resize 48x48 -unsharp 0x0.6+0.8+0.02 -strip \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 16x16 \) \
  -delete 0 "$OUT/favicon.ico"

# Opaque, per the note above.
magick "$MASTER" -resize 180x180 -background white -alpha remove -alpha off \
  -strip "$OUT/apple-touch-icon.png"

rm -f "$MASTER"

echo "Generated from $SRC (${W}x${H} ink → ${CANVAS}px master):"
ls -1 "$OUT"/icon-512.png "$OUT"/icon-192.png "$OUT"/favicon-32.png \
      "$OUT"/favicon-16.png "$OUT"/logo-96.png "$OUT"/favicon.ico \
      "$OUT"/apple-touch-icon.png
