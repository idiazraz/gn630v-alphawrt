#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
"""Small read-only TFTP server (RFC 1350, 512-byte blocks) for the GN630V U-Boot.

The vendor U-Boot's TFTP client stalls on large transfers, so images are
served as 32 KiB chunks (tools/stage_chunks.sh) and fetched one by one by
tools/tftp_chunk_boot.py. Options (blksize etc.) are ignored, so the client
stays on plain 512-byte blocks. A transfer whose ACKs stop is dropped after a
few seconds, so the client's next request for the same chunk is served.

Usage: python3 -I tools/tftpd.py [--dir tftp/chunks] [--port 69]
On macOS a non-root process can bind port 69 only on the wildcard address.
"""
import argparse, os, socket, struct

BLOCK = 512
TIMEOUT = 1.0      # seconds to wait for an ACK
RETRIES = 5        # then give the transfer up


def send_file(sock, peer, path):
    with open(path, "rb") as f:
        data = f.read()
    blocks = len(data) // BLOCK + 1         # a final short (maybe empty) block ends it
    for n in range(1, blocks + 1):
        pkt = struct.pack("!HH", 3, n & 0xFFFF) + data[(n - 1) * BLOCK:n * BLOCK]
        for _ in range(RETRIES):
            sock.sendto(pkt, peer)
            sock.settimeout(TIMEOUT)
            try:
                while True:
                    ack, src = sock.recvfrom(1024)
                    if src == peer and ack[:2] == b"\0\4" and struct.unpack("!H", ack[2:4])[0] == n & 0xFFFF:
                        break
                break
            except socket.timeout:
                continue
        else:
            return False
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dir", default="tftp/chunks")
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=69)
    a = ap.parse_args()
    root = os.path.abspath(a.dir)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((a.bind, a.port))
    print(f"tftpd: serving {root} on {a.bind}:{a.port}", flush=True)
    while True:
        sock.settimeout(None)
        req, peer = sock.recvfrom(1024)
        if req[:2] != b"\0\1":                       # only read requests
            continue
        name = os.path.basename(req[2:].split(b"\0")[0].decode("ascii", "replace"))
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            sock.sendto(b"\0\5\0\1" + b"file not found\0", peer)
            print(f"{peer[0]} {name}: not found", flush=True)
            continue
        ok = send_file(sock, peer, path)
        print(f"{peer[0]} {name}: {'sent' if ok else 'gave up'}", flush=True)


if __name__ == "__main__":
    main()
