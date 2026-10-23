#!/bin/sh
# Split FILE into 32 KiB chunkNNN files in DIR for tools/tftp_chunk_boot.py.
# Usage: sh tools/stage_chunks.sh FILE [DIR]   (DIR defaults to tftp/chunks)
set -eu
FILE=$1
DIR=${2:-tftp/chunks}
mkdir -p "$DIR"
find "$DIR" -maxdepth 1 -type f -name 'chunk[0-9]*' -delete
SPLIT=split; split --version >/dev/null 2>&1 || SPLIT=gsplit   # GNU split (macOS: brew coreutils)
$SPLIT -b 32768 -a 4 -d "$FILE" "$DIR/chunk"
# 4-digit names (chunk0000..): a 32 MiB partition is 1024 chunks
n=$(find "$DIR" -maxdepth 1 -name 'chunk[0-9]*' | wc -l | tr -d ' ')
cat "$DIR"/chunk[0-9]* | cmp -s - "$FILE" || { echo "chunks do not reassemble to $FILE" >&2; exit 1; }
echo "$n chunks of $FILE staged in $DIR"
