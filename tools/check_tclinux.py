#!/usr/bin/env python3
"""Offline check of a GN630V bank-A (tclinux) image, the way the vendor U-Boot reads it.

Usage: python3 -I tools/check_tclinux.py IMAGE [--stock]
--stock: the image is a stock bank dump (FIT holds the rootfs, no 6 MiB split).
Exits non-zero on the first failed check.
"""
import hashlib, struct, sys, zlib

img = open(sys.argv[1], "rb").read()
stock = "--stock" in sys.argv
ok = lambda c, m: print(("  ok  " if c else "  FAIL") + " " + m) or c or sys.exit(1)

# HDR2 header (same layout as OpenWrt econet tclinux-trx.sh, little endian)
magic, hlen, total, crc = img[:4], *struct.unpack_from("<III", img, 4)
ksz, rsz = struct.unpack_from("<II", img, 0x50)
model = img[0x5c:0x7c].split(b"\0")[0].strip()
print(f"HDR2: hdrlen=0x{hlen:x} total=0x{total:x} crc=0x{crc:08x} kernel=0x{ksz:x} rootfs=0x{rsz:x} model={model.decode()}")
ok(magic == b"HDR2", "magic HDR2")
ok(hlen == 0x100, "header length 0x100")
ok(model == b"EN7523,GN630", "model EN7523,GN630")
ok(total <= len(img), "total length within file")
ok(zlib.crc32(img[0x100:total]) ^ 0xffffffff == crc, "checksum = CRC-32/JAMCRC of img[0x100:total]")
# the stock web upgrade does strncpy(dst, cv, strlen(cv) - 1) on the customer
# version at 0x30: an empty one underflows and crashes cfg.svc
cv = img[0x30:0x50].split(b"\0")[0]
ok(len(cv) > 1 and cv.endswith(b"\n"), f"customer version at 0x30 non-empty, newline-terminated ({cv!r})")

# FIT at 0x100, walked like get_tclinux_imginfo: /images/{fdt@1,kernel@1,filesystem@1}
fit = img[0x100:]
ok(fit[:4] == b"\xd0\x0d\xfe\xed", "FIT (FDT magic) at 0x100")
ostruct, ostr = struct.unpack(">II", fit[8:16])
name = lambda o: fit[ostr + o:fit.index(b"\0", ostr + o)].decode()
p, path, props = ostruct, [], {}
while True:
    tok = struct.unpack(">I", fit[p:p + 4])[0]; p += 4
    if tok == 1:
        e = fit.index(b"\0", p); path.append(fit[p:e].decode()); p = (e + 4) & ~3
    elif tok == 2:
        path.pop()
    elif tok == 3:
        ln, no = struct.unpack(">II", fit[p:p + 8]); p += 8
        props["/".join(path[1:]) + ":" + name(no)] = fit[p:p + ln]; p = (p + ln + 3) & ~3
    elif tok == 9:
        break
for n in ("fdt@1", "kernel@1", "filesystem@1"):
    ok(f"images/{n}:data" in props, f"node /images/{n} with data")
# U-Boot reads only the first 0x800 bytes of the FIT before looking up fdt@1
i = fit.find(b"fdt@1\0", ostruct)
ok(0 <= i < 0x800, f"fdt@1 node within the first 0x800 bytes U-Boot reads (at 0x{i:x})")
for n in ("fdt@1", "kernel@1"):
    want = props.get(f"images/{n}/hash@1:value") or props.get(f"images/{n}/hash-1:value")
    algo = (props.get(f"images/{n}/hash@1:algo") or props.get(f"images/{n}/hash-1:algo") or b"").rstrip(b"\0")
    data = props[f"images/{n}:data"]
    if algo == b"sha1":
        ok(hashlib.sha1(data).digest() == want, f"{n} sha1 hash matches (bootm verifies this)")
    elif algo == b"crc32":
        ok(struct.pack(">I", zlib.crc32(data)) == want, f"{n} crc32 hash matches")
    else:
        ok(False, f"{n} has a sha1/crc32 hash (got {algo!r})")
load = props.get("images/kernel@1:load")
ok(load == struct.pack(">I", 0x80208000) or stock, "kernel load address 0x80208000")
fitsize = struct.unpack(">I", fit[4:8])[0]
print(f"FIT size 0x{fitsize:x}")

if not stock:
    ok(0x100 + fitsize <= 0x600000, "HDR2 + FIT fits in the 6 MiB kernel partition")
    ok(img[0x600000:0x600004] == b"hsqs", "squashfs at 0x600000 (alphawrt_rootfs)")
    ok(len(img) - 0x600000 <= 0x1000000, "rootfs part fits in the 16 MiB alphawrt_rootfs partition")
print("all checks passed")
