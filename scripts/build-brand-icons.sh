#!/bin/sh
# Rebuild the two PNG icons from the single approved, centered SVG master.
# Requires macOS sips. iOS masks the full-bleed square to its own corner radius.
set -eu
cd "$(dirname "$0")/.."
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT HUP INT TERM
sips -s format png favicon.svg --out "$tmpdir/rounded.png" >/dev/null
sips -z 96 96 "$tmpdir/rounded.png" --out assets/brand-mark-96.png >/dev/null
sed 's/rx="96"/rx="0"/' favicon.svg > "$tmpdir/touch.svg"
sips -s format png "$tmpdir/touch.svg" --out "$tmpdir/touch.png" >/dev/null
sips -z 180 180 "$tmpdir/touch.png" --out apple-touch-icon.png >/dev/null
echo "Generated centered 96px favicon and opaque 180px iPhone touch icon."
