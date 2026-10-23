#!/usr/bin/env python3
"""Stop U-Boot autoboot on the GN630V and capture read-only commands.

Usage: python3 tools/uboot_dump.py [port] [outdir] [--at-prompt]
Power-cycle the board after starting. Leaves the board at the U-Boot prompt.
"""
import os, select, sys, termios, time

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = ARGS[0] if ARGS else os.environ.get("ALPHAWRT_SERIAL", "/dev/ttyUSB0")
OUT = ARGS[1] if len(ARGS) > 1 else os.path.join(os.path.dirname(__file__), "..", "stock")
# Read-only commands only. Output file name -> command.
CMDS = {"uboot-help.txt": "help", "uboot-printenv.txt": "printenv", "uboot-flash-info.txt": "flash info"}
AUTOBOOT = b"Hit any key to stop autoboot"

fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
a = termios.tcgetattr(fd)
a[0] = a[1] = a[3] = 0                                    # raw: no iflag/oflag/lflag processing
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL       # 8N1, no flow control
a[4] = a[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, a)
session = open(os.path.join(OUT, "uboot-session.log"), "ab")


def read(timeout):
    r, _, _ = select.select([fd], [], [], timeout)
    if not r:
        return b""
    d = os.read(fd, 4096)
    session.write(d); session.flush()
    sys.stdout.write(d.decode("latin-1")); sys.stdout.flush()
    return d


def read_until_idle(idle=1.5, cap=60, prompt=None):
    buf, end = b"", time.time() + cap
    while time.time() < end:
        d = read(idle)
        if not d:
            break
        buf += d
        if prompt and buf.rstrip().endswith(prompt):
            break
    return buf


AT_PROMPT = "--at-prompt" in sys.argv                     # already logged in at the U-Boot prompt: skip the interrupt
if not AT_PROMPT:
    print(f"### listening on {PORT}: power-cycle the GN630V now (waiting up to 600 s)")
buf, end = b"", time.time() + 600
while not AT_PROMPT and AUTOBOOT not in buf:
    if time.time() > end:
        sys.exit("### autoboot prompt never seen")
    buf = (buf + read(0.5))[-4096:]
buf, end = b"", time.time() + (0 if AT_PROMPT else 6)    # keep pressing through the whole countdown
keys = [b" ", b"\r", b"\x03"]                            # space, Enter, Ctrl-C: vendor builds differ on what aborts
while time.time() < end:
    os.write(fd, keys[int(time.time() * 20) % len(keys)])
    buf += read(0.1)
    if b"Reading kernel" in buf or b"Starting kernel" in buf:
        sys.exit("### U-Boot ignored the keypresses and kept booting: board RX (adapter TX) is not reaching the SoC")
    if b"UserName:" in buf:                               # Skyworth U-Boot gates the shell behind a login
        read_until_idle(0.5)
        sys.exit("### autoboot stopped; U-Boot wants UserName/Password. Log in yourself, then rerun with --at-prompt")
    if b"stop autoboot" in buf and buf.rstrip().endswith(b">"):
        break
os.write(fd, b"\r")
prompt = read_until_idle(1.0).strip().splitlines()[-1].strip()
if b"kernel" in prompt.lower() or len(prompt) > 16 or prompt.endswith(b":"):   # ':' = UserName:/Password:, not a shell
    sys.exit(f"### no U-Boot prompt (last line {prompt!r}); not sending commands")
print(f"\n### prompt detected: {prompt!r}")

for name, cmd in CMDS.items():
    os.write(fd, cmd.encode() + b"\r")
    out = read_until_idle(prompt=prompt)
    lines = out.decode("latin-1").replace("\r", "").splitlines()
    if lines and lines[0].strip().endswith(cmd):          # drop the echoed command line
        lines = lines[1:]
    if lines and lines[-1].strip() == prompt.decode("latin-1"):
        lines = lines[:-1]
    with open(os.path.join(OUT, name), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\n### saved {cmd!r} -> stock/{name} ({len(lines)} lines)")
print("### done; board left at the U-Boot prompt")
