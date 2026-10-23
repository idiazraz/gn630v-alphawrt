#!/usr/bin/env python3
"""Non-destructive rehearsal (RECOVERY.md section 7): read partitions with U-Boot
`flash read` into RAM and compare U-Boot's `crc32` with the Linux dumps.
Proves that U-Boot's view of flash (through its BMT) matches the backup.

Usage: python3 -I tools/uboot_rehearsal.py [port]   (board logged in at ECNT>, picocom closed)
Only `flash read` and `crc32` are sent; nothing is written.
"""
import os, re, select, sys, termios, time, zlib

PORT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ALPHAWRT_SERIAL", "/dev/ttyUSB0")
DUMP = os.environ.get("ALPHAWRT_DUMP", "backup/stock")  # made by tools/dump_mtd.sh
PARTS = [("mtd1-romfile", 0x80000, 0x40000), ("mtd7-reservearea", 0xddc0000, 0x240000),
         ("mtd2-tclinux", 0xc0000, 0x2000000), ("mtd3-tclinux_slave", 0x20c0000, 0x2000000)]
RAM = 0x8a000000

fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
a = termios.tcgetattr(fd)
a[0] = a[1] = a[3] = 0
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
a[4] = a[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, a)


def cmd(line, timeout):
    os.write(fd, line.encode() + b"\r")
    buf, end = b"", time.time() + timeout
    while time.time() < end and not buf.rstrip().endswith(b"ECNT>"):
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            buf += os.read(fd, 4096)
    return buf.decode("latin-1")


if "ECNT>" not in cmd("", 3):
    sys.exit("### no ECNT> prompt: log in to U-Boot first and close picocom")
bad = 0
for name, off, size in PARTS:
    want = zlib.crc32(open(os.path.join(DUMP, name + ".bin"), "rb").read())
    cmd(f"flash read 0x{off:x} 0x{size:x} 0x{RAM:x}", 120)
    m = re.search(r"==>\s*([0-9a-fA-F]{8})", cmd(f"crc32 0x{RAM:x} 0x{size:x}", 60))
    got = int(m.group(1), 16) if m else None
    same = got == want
    bad += not same
    print(f"{'ok  ' if same else 'FAIL'} {name:20s} flash 0x{off:08x}+0x{size:x}: U-Boot {got and f'{got:08x}'} dump {want:08x}")
if bad:
    sys.exit("### MISMATCH: do not write flash until this is understood")
print("### all match: U-Boot and the dumps agree")
