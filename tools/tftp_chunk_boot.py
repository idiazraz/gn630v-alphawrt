#!/usr/bin/env python3
"""RAM-boot a FIT image on the GN630V by TFTP-loading it in 32 KiB chunks.

The vendor U-Boot's TFTP stalls on large files, so each chunk is its own
`tftpboot`. Needs: logged in at ECNT>, a TFTP server serving chunkNNN files
(tools/tftpd.py), nothing else on the serial port.

Usage: python3 tools/tftp_chunk_boot.py CHUNKDIR [--port DEV] [--addr 0x8a000000] [--start N] [--no-boot | --boot-only | --raw]
--raw loads any file (e.g. a partition dump) and checks it with U-Boot `crc32`; it never boots or writes.
Serve the chunks with tools/tftpd.py. Serial port: $ALPHAWRT_SERIAL (default /dev/ttyUSB0).
Writes nothing to flash. After bootm it keeps logging the console to stock/openwrt-boot.log.
"""
import os, re, select, sys, termios, time, zlib

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
CHUNKS = args[0]
PORT = opt("--port", os.environ.get("ALPHAWRT_SERIAL", "/dev/ttyUSB0"))
BASE = int(opt("--addr", "0x8a000000"), 16)
CHUNK = 0x8000
PROMPT = b"ECNT>"
LOG = os.path.join(os.path.dirname(__file__), "..", "stock", "openwrt-boot.log")

fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
a = termios.tcgetattr(fd)
a[0] = a[1] = a[3] = 0
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
a[4] = a[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, a)


def read_until(pat, timeout):
    buf, end = b"", time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            buf += os.read(fd, 4096)
            if pat in buf:
                break
    return buf


def cmd(line, timeout=20):
    os.write(fd, line.encode() + b"\r")
    return read_until(PROMPT, timeout)


os.write(fd, b"\x03\r")                                   # abort a stuck tftpboot retry loop, if any
if PROMPT not in read_until(PROMPT, 5):
    sys.exit("### no ECNT> prompt: log in to U-Boot first and close picocom")

names = sorted((n for n in os.listdir(CHUNKS) if re.fullmatch(r"chunk\d{3,4}", n)), key=lambda n: int(n[5:]))
START = int(opt("--start", "0"))                          # resume after a failed run; earlier chunks are still in RAM
if "--boot-only" in sys.argv:                             # image already in RAM: just verify and boot
    START = len(names)
total = sum(os.path.getsize(os.path.join(CHUNKS, n)) for n in names)
print(f"### {len(names)} chunks, {total} bytes -> 0x{BASE:08x}")
for i, n in enumerate(names):
    if i < START:
        continue
    size = os.path.getsize(os.path.join(CHUNKS, n))
    addr = BASE + i * CHUNK
    for attempt in range(1, 6):
        out = cmd(f"tftpboot 0x{addr:08x} {n}")
        m = re.search(rb"Bytes transferred = (\d+)", out)
        if m and int(m.group(1)) == size:
            break
        os.write(fd, b"\x03")                             # stop U-Boot's own endless retry before ours
        read_until(PROMPT, 3)
        time.sleep(6)                                     # let the single-threaded server drop the dead transfer
        print(f"\n### {n}: attempt {attempt} failed, retrying")
    else:
        sys.exit(f"### {n} failed 5 times; stopping (nothing was booted)")
    print(f"\r### {i + 1}/{len(names)} loaded", end="", flush=True)

if "--raw" in sys.argv:                                   # any file (e.g. a partition dump): verify by CRC32, never boot
    want = 0
    for n in names:
        want = zlib.crc32(open(os.path.join(CHUNKS, n), "rb").read(), want)
    out = cmd(f"crc32 0x{BASE:08x} 0x{total:x}", 120).decode("latin-1")
    m = re.search(r"==>\s*([0-9a-fA-F]{8})", out)
    got = int(m.group(1), 16) if m else None
    print(f"\n### RAM 0x{BASE:08x}+0x{total:x}: U-Boot crc32 {got and f'{got:08x}'}, file crc32 {want:08x}")
    sys.exit(0 if got == want else "### CRC32 MISMATCH: do not write this to flash")

info = cmd(f"iminfo 0x{BASE:08x}", 60).decode("latin-1")
print("\n" + info)
if info.count("sha1+") < 2 or "Bad" in info or "bad" in info:   # this U-Boot prints "crc32+ sha1+", no "OK"
    sys.exit("### iminfo did not verify kernel and FDT hashes; not booting")
if "--no-boot" in sys.argv:
    sys.exit("### verified; --no-boot given")

print(f"### bootm 0x{BASE:08x}; console -> {LOG} (Ctrl-C to stop logging)")
os.write(fd, f"bootm 0x{BASE:08x}\r".encode())
with open(LOG, "ab") as log:
    try:
        while True:
            r, _, _ = select.select([fd], [], [], 1)
            if r:
                d = os.read(fd, 4096)
                log.write(d); log.flush()
                sys.stdout.write(d.decode("latin-1")); sys.stdout.flush()
    except KeyboardInterrupt:
        pass
