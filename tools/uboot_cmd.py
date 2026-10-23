#!/usr/bin/env python3
"""Send commands to a logged-in U-Boot (ECNT>) and print their output.

Usage: python3 -I tools/uboot_cmd.py [--timeout S] "bootflag read" ["cmd2" ...]
Board must be at ECNT> with nothing else holding the port. Default timeout
per command is 30 s; flash erase/write of a whole bank needs a few minutes.
"""
import os, select, sys, termios, time

TIMEOUT = 30
if sys.argv[1:2] == ["--timeout"]:
    TIMEOUT = int(sys.argv[2])
    del sys.argv[1:3]

PORT = os.environ.get("ALPHAWRT_SERIAL", "/dev/ttyUSB0")
fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
a = termios.tcgetattr(fd)
a[0] = a[1] = a[3] = 0
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
a[4] = a[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, a)


def cmd(line, timeout=None):
    timeout = timeout or TIMEOUT
    os.write(fd, line.encode() + b"\r")
    buf, end = b"", time.time() + timeout
    while time.time() < end and not buf.rstrip().endswith(b"ECNT>"):
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            buf += os.read(fd, 4096)
    return buf.decode("latin-1").replace("\r", "")


if "ECNT>" not in cmd("", 3):
    sys.exit("### no ECNT> prompt: log in to U-Boot first and close picocom")
for c in sys.argv[1:]:
    print(cmd(c).strip())
