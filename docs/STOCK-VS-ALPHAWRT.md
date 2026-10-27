# Testing stock vs AlphaWRT

How to compare the stock firmware and AlphaWRT fairly on one GN630V: same box, same fibre line, same router and test client, same test servers. AlphaWRT keeps stock in the other flash bank, so you switch between the two and run the same checks on each.

> **AX3000 GN630V only.** Do not flash the 2.5G variant. Read [RECOVERY.md](RECOVERY.md) first, and follow the privacy rules in [ONT-ISP-TESTER-GUIDE.md](ONT-ISP-TESTER-GUIDE.md): no serials, MACs, credentials or public addresses in a report.

## Before you start
- AlphaWRT is installed and `alphawrt-bootbank` shows stock in the other bank.
- You can get back to AlphaWRT from stock (see "Switching" below). If you can't use UART, keep the matching `*-tclinux-factory.bin` on the test client.
- Pick a quiet hour, and run both firmwares in the **same hour**: evening congestion on the ISP side can move speeds by more than the firmware does.
- PPPoE lines that allow one session per account (TIME, for one) refuse a new login for a few minutes after a switch. Wait until the WAN is up before you measure.

## Keep the setup fixed
Write these down once and don't change them between runs:

| Item | Example |
|---|---|
| Mode | bridge (router behind dials PPPoE) or combo/router (the box dials) |
| Who dials PPPoE | the router behind, or the GN630V |
| Test client | a wired machine, on the same port every time (not Wi-Fi, unless you are testing Wi-Fi) |
| Port | e.g. LAN 1 to the router, test client on the router |
| Servers | the same URLs for every run (below) |

Stock and AlphaWRT keep separate settings. Set stock up to match AlphaWRT's mode, VLAN and identity before you measure, or the comparison means nothing.

## Switching
**AlphaWRT → stock:**
```sh
alphawrt-bootbank stock
reboot
```
**Stock → AlphaWRT**, either:
- Stock web UI → firmware upgrade with the same `*-tclinux-factory.bin` (keep `tclinux` in the file name). Stock writes the AlphaWRT bank again and boots it; your AlphaWRT settings come back. Don't touch the power for 10 minutes.
- Or, with UART: at `ECNT>`, `bootflag swap`, then power-cycle. See [RECOVERY.md](RECOVERY.md).

Never run the stock firmware's `/userfs/bin/mtd` by hand (it reads hex offsets as 0).

Suggested order: stock → AlphaWRT → stock again if a result looks surprising. One run per firmware is a hint, two is a result.

## Capture script
[`tools/compare-test.sh`](../tools/compare-test.sh) runs checks 3 and 4 and saves the results, so both firmwares get exactly the same test. Run it on the wired test client (macOS or Linux, needs `curl`):
```sh
sh compare-test.sh stock                          # while stock runs
BOX=root@192.168.1.1 sh compare-test.sh alphawrt  # while AlphaWRT runs
sh compare-test.sh report                         # both runs side by side
```
Each run takes about 4 minutes. With `BOX` set (AlphaWRT only; in bridge mode use the management address the Home page shows), it also reads the version, PON state, received light, the line counters at the start and end, and the box's CPU idle during a download. Add `REST=600` to wait 10 minutes at rest first, for check 2. For other servers, set `DOWN_URL` and `UP_URL`, and use the same ones for both runs.

Results go to `./results/`: one folder of raw logs per run, and one line per run in `results.tsv`. Nothing in them names the box, the line or your IP, so `results.tsv` can go in the report as it is. Checks 1, 2 on stock, 5, 6 and 7 are still by hand.

## What to measure
Run every check on both firmwares, in the same order.

### 1. Boot and registration
Power-cycle with the fibre plugged in, and time from power-on to:
- the PON LED steady (O5): on AlphaWRT also Basic → Fibre, or `logread | grep "GPON state"`;
- the WAN up (PPPoE connected on whichever box dials);
- a web page loading on the test client.

### 2. Line health (10 minutes at rest)
Read the optical RX/TX power and the error counters (BIP, HEC, FEC, CRC, LOS/LOF), wait 10 minutes with no load, read them again.
- Stock: its status/diagnostics page.
- AlphaWRT: Basic → Fibre (or download the Fibre diagnostics report, which leaves identifiers out).

Received light should match between the two within about 0.5 dB; it's the same optics. Counters that climb on one firmware and not the other are worth reporting.

### 3. Throughput
From the test client (in bridge mode, the client sits behind the router), 8 parallel streams for 30 s, three runs each way, report the median. Single-stream tests mostly measure the server.

Download:
```sh
URL=http://sin1-sgp.speedtest.network.ovh.net/files/10Gb.dat
( for i in 1 2 3 4 5 6 7 8; do
    curl -s -o /dev/null -m 30 -w '%{speed_download}\n' "$URL" &
  done; wait ) | awk '{s+=$1} END {printf "down %.0f Mbit/s\n", s*8/1e6}'
```
Upload (streamed, so curl doesn't buffer the body in RAM):
```sh
( for i in 1 2 3 4 5 6 7 8; do
    head -c 500000000 /dev/zero | curl -s -o /dev/null -m 30 -w '%{speed_upload}\n' \
      -H 'Origin: https://speed.cloudflare.com' -H 'Referer: https://speed.cloudflare.com/' \
      -T - https://speed.cloudflare.com/__up &
  done; wait ) | awk '{s+=$1} END {printf "up %.0f Mbit/s\n", s*8/1e6}'
```
curl reports a timeout error at 30 s; that's expected, the speed line still counts. If a server refuses you (0 Mbit/s or HTTP 403), pick another one and use it for **both** firmwares. A browser test (speed.cloudflare.com, Ookla) is fine as a second opinion, with the same server each time.

On AlphaWRT, also note the box's CPU during the download: `top -d 1` over SSH, the `idle` figure. Hardware offload shows up as a mostly idle box at full speed.

### 4. Latency under load
Run `ping -c 60 1.1.1.1` once idle, and once while the download test runs. Report the median and the worst time of each. A large jump under load is bufferbloat.

### 5. Wi-Fi (if you use the box's Wi-Fi)
Same client, same spot (3 m line of sight, then one wall), same band and channel width on both. Run `iperf3 -c <server> -t 30 -P 4` and `-R` to a wired host on a LAN port; don't use the GN630V itself as the iperf3 server. Record the link rate the client shows.

### 6. Features
Pass/fail on each firmware: every LAN port, both Wi-Fi bands, the LEDs (PON, LOS, Internet, Wi-Fi), IPTV and voice if the account has them, IPv6 on the client.

### 7. Stability (optional)
Leave each firmware in its normal job for at least 6 h (24 h is better) and note WAN drops, PON drops and reboots. On AlphaWRT, Basic → Fibre keeps an event log; on stock, check its log page. Row A10 in [ACCEPTANCE.md](ACCEPTANCE.md) has the full soak procedure.

## Reference results
One AX3000 unit on TIME (Huawei OLT), bridge mode, a Turris router dialling PPPoE, 8 streams, Mbit/s:

| Firmware | Down | Up | Box CPU idle at full download |
|---|---|---|---|
| Stock V1.1.0.11 | 884 | 445 | (not read) |
| AlphaWRT 0.2.4-test | 535-580 | 385 | 5-12% |
| AlphaWRT 0.2.5 hardware bridging (test build) | 884 | 443 | 94% |

Yours will differ with the plan and the line; the gap between the two firmwares on your line is the useful number.

## Report
Add this to the report template in [ONT-ISP-TESTER-GUIDE.md](ONT-ISP-TESTER-GUIDE.md):

```text
Mode / who dials PPPoE / test client and port:
Test servers (down / up):
Date and hour of the stock runs / AlphaWRT runs:

                        Stock           AlphaWRT <version>
Power-on to O5 (s):
Power-on to WAN up (s):
Optical RX / TX:
Counters at rest, 10 min (start → end):
Download, 3 runs (Mbit/s):
Upload, 3 runs (Mbit/s):
Ping idle / under load (median / worst ms):
Box CPU idle during download:   n/a
Wi-Fi down / up (Mbit/s, link rate):
Ports / Wi-Fi / LEDs / IPTV / voice / IPv6:
Soak: hours, WAN drops, PON drops, reboots:

Notes (anything that differed):
```
