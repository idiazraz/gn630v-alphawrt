#!/bin/sh
# Build root/www/alphawrt/ui.css from input.css: the Tailwind CSS standalone
# executable plus daisyUI's two plugin files, no Node. Versions are pinned and
# every download is checked against the sha256 below (Tailwind's match its
# release sha256sums.txt; daisyUI publishes none, so these were taken on first
# download, 2026-10-27).
#
#   ui/build.sh          rebuild ui.css
#   ui/build.sh --check  fail if the committed ui.css differs from a fresh build,
#                        or if the whole UI is over 128 KB gzipped (CI)

set -eu
cd "$(dirname "$0")"

TAILWIND=4.3.3
DAISYUI=5.7.50
# daisyUI's plugin files must sit next to input.css; the ~80 MB Tailwind
# binary is kept outside the repo, since the OpenWrt build copies package/ whole.
CACHE=.cache
BIN="${XDG_CACHE_HOME:-$HOME/.cache}/alphawrt-ui"
OUT=../root/www/alphawrt/ui.css

case "$(uname -s)-$(uname -m)" in
Darwin-arm64)   TW=tailwindcss-macos-arm64 TWSUM=cdf646702987a743464dff4d9c60fd4480d1c1e73dd819a9a67f1078815dce9d ;;
Darwin-x86_64)  TW=tailwindcss-macos-x64   TWSUM=7922e0953f2110c05976e3bf58f14e643d90427575e766b7d433f5f80cbee7e1 ;;
Linux-x86_64)   TW=tailwindcss-linux-x64   TWSUM=dc61b3ac6b8c9ca874c0cc4c57b2409791a64c5540404ca5f5367360babc313a ;;
Linux-aarch64)  TW=tailwindcss-linux-arm64 TWSUM=55fd0b241214eff3de1e8ee4f22796662f2d2e7a49bcfca7477cfd0bac398195 ;;
*) echo "build.sh: no pinned Tailwind binary for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

# fetch <dir> <url> <name> <sha256>: download once into <dir>, verified
fetch() {
	[ -f "$1/$3" ] && [ "$(sha256 "$1/$3")" = "$4" ] && return
	mkdir -p "$1"
	curl -fsSL -o "$1/$3.part" "$2"
	if [ "$(sha256 "$1/$3.part")" != "$4" ]; then
		echo "build.sh: sha256 mismatch for $3, refusing to use it" >&2
		rm -f "$1/$3.part"
		exit 1
	fi
	mv "$1/$3.part" "$1/$3"
}

fetch "$BIN" "https://github.com/tailwindlabs/tailwindcss/releases/download/v$TAILWIND/$TW" "$TW" "$TWSUM"
fetch "$CACHE" "https://github.com/saadeghi/daisyui/releases/download/v$DAISYUI/daisyui.mjs" daisyui.mjs \
	d69de07c7463bb1f41548e2688f88ee105cdadf9779fce5b3c47b3bfaa6be472
fetch "$CACHE" "https://github.com/saadeghi/daisyui/releases/download/v$DAISYUI/daisyui-theme.mjs" daisyui-theme.mjs \
	e48a35d8326d650181ca600560e8520cf6b44cf9242bbd9d45825607e641f251
chmod +x "$BIN/$TW"

if [ "${1:-}" = --check ]; then
	"$BIN/$TW" --input input.css --output "$BIN/check.css" --minify 2>/dev/null
	cmp -s "$BIN/check.css" "$OUT" || { echo "build.sh: $OUT is stale, run ui/build.sh" >&2; exit 1; }
	echo "ui.css is up to date"
	# SIMPLE-UI.md §2: the whole UI stays within 128 KB gzipped (no minifier)
	GZ=$(find ../root/www/alphawrt -type f -exec cat {} + | gzip -9 | wc -c | tr -d ' ')
	echo "UI size: $GZ bytes gzipped (limit 131072)"
	[ "$GZ" -le 131072 ] || { echo "build.sh: the UI is over the 128 KB gzipped budget" >&2; exit 1; }
else
	"$BIN/$TW" --input input.css --output "$OUT" --minify
	echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
fi
