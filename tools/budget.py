#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
"""Flash budget report for a GN630V build.

  budget.py <openwrt dir> [baseline.tsv]      report, exit 1 if over budget
  budget.py <openwrt dir> --save <out.tsv>    write the package sizes as a baseline

Reads the factory image and manifest in bin/targets/airoha/en7523/: kernel
(HDR2 + FIT) against the 6 MiB kernel partition, the rootfs squashfs against
the 14 MiB budget (of the 16 MiB alphawrt_rootfs partition), and each
package's .apk size against the baseline (default config/budget-baseline.tsv).
The .apk sizes are compressed, so they only approximate what a package adds
to the squashfs.
"""
import glob, os, struct, sys

KERNEL_MAX = 6 << 20
ROOTFS_MAX = 14 << 20
MiB = 1 << 20


def image_sizes(img):
    """(kernel part, rootfs squashfs) sizes of a tclinux factory image."""
    assert img[:4] == b"HDR2", "not a tclinux factory image"
    fit_size = struct.unpack(">I", img[0x104:0x108])[0]  # FDT totalsize
    sq = img[0x600000:]
    assert sq[:4] == b"hsqs", "no squashfs at 0x600000"
    return 0x100 + fit_size, struct.unpack("<Q", sq[40:48])[0]  # bytes_used


def package_sizes(top):
    out = os.path.join(top, "bin/targets/airoha/en7523")
    manifest = max(glob.glob(out + "/*.manifest"), key=os.path.getmtime)
    apks = {os.path.basename(p): os.path.getsize(p)
            for p in glob.glob(top + "/bin/**/*.apk", recursive=True)}
    sizes = {}
    for line in open(manifest):
        name, _, ver = line.strip().partition(" - ")
        sizes[name] = apks.get(f"{name}-{ver}.apk", 0)
    return manifest, sizes


def diff(base, now):
    """Changed packages as (name, before, after), largest change first."""
    rows = [(n, base.get(n, 0), now.get(n, 0)) for n in set(base) | set(now)
            if base.get(n) != now.get(n)]
    return sorted(rows, key=lambda r: -abs(r[2] - r[1]))


def main(argv):
    top = argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    manifest, now = package_sizes(top)
    if argv[2:3] == ["--save"]:
        with open(argv[3], "w") as f:
            f.write(f"# package .apk sizes from {os.path.basename(manifest)}\n")
            for n in sorted(now):
                f.write(f"{n}\t{now[n]}\n")
        return 0
    base_file = argv[2] if len(argv) > 2 else os.path.join(here, "../config/budget-baseline.tsv")
    factory = manifest.replace(".manifest", "-squashfs-tclinux-factory.bin")
    kernel, rootfs = image_sizes(open(factory, "rb").read())
    over = kernel > KERNEL_MAX or rootfs > ROOTFS_MAX
    print(f"budget {os.path.basename(factory)}")
    print(f"  kernel  {kernel / MiB:6.2f} MiB of {KERNEL_MAX / MiB:.0f}   ({(KERNEL_MAX - kernel) / MiB:.2f} free)")
    print(f"  rootfs  {rootfs / MiB:6.2f} MiB of {ROOTFS_MAX / MiB:.0f}  ({(ROOTFS_MAX - rootfs) / MiB:.2f} free)")
    base_name, base = "", {}
    for line in open(base_file):
        if line.startswith("#"):
            base_name = base_name or line[1:].strip()
        elif line.strip():
            n, s = line.split("\t")
            base[n] = int(s)
    # .apk sizes move by a few hundred bytes between machines (signatures),
    # so list only new, removed and noticeably changed packages
    rows = [r for r in diff(base, now) if not r[1] or not r[2] or abs(r[2] - r[1]) >= 1024]
    print(f"  packages vs baseline ({base_name}): {len(rows)} changed by 1 KiB or more, "
          f"{(sum(now.values()) - sum(base.values())) / 1024:+.0f} KiB .apk in all")
    for n, a, b in rows:
        tag = "new" if not a else "gone" if not b else ""
        print(f"    {(b - a) / 1024:+8.1f} KiB  {n} {tag}")
    if over:
        print("OVER BUDGET")
    return 1 if over else 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        fit = b"\xd0\x0d\xfe\xed" + struct.pack(">I", 0x1000)
        sq = b"hsqs" + bytes(36) + struct.pack("<Q", 5 << 20)
        img = b"HDR2" + bytes(0xfc) + fit + bytes(0x600000 - 0x108) + sq
        assert image_sizes(img) == (0x1100, 5 << 20)
        assert diff({"a": 1, "b": 2}, {"b": 5, "c": 3}) == [("b", 2, 5), ("c", 0, 3), ("a", 1, 0)]
        print("selftest ok")
        sys.exit(0)
    sys.exit(main(sys.argv))
