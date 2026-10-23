#!/bin/sh
# Dump every MTD partition of a running OpenWrt over SSH and verify each copy
# against a SHA-256 computed on the device. Read-only (uses /dev/mtdNro).
# Usage: sh tools/dump_mtd.sh OUTDIR [host]
set -eu
OUT=$1
HOST=${2:-root@192.168.1.1}
mkdir -p "$OUT"
r() { ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$HOST" "$@"; }

: > "$OUT/SHA256SUMS"
for i in $(r 'ls /sys/class/mtd | sed -n "s/^mtd\([0-9]*\)$/\1/p"'); do
	name=$(r "cat /sys/class/mtd/mtd$i/name")
	f="mtd$i-$name.bin"
	r "cat /dev/mtd${i}ro" > "$OUT/$f"
	dev=$(r "sha256sum /dev/mtd${i}ro" | cut -d' ' -f1)
	host=$(shasum -a 256 "$OUT/$f" | cut -d' ' -f1)
	[ "$dev" = "$host" ] || { echo "MISMATCH $f" >&2; exit 1; }
	echo "$host  $f" >> "$OUT/SHA256SUMS"
	printf '%-26s %10d  sha256 ok\n' "$f" "$(stat -f %z "$OUT/$f")"
done
