# Hardware acceptance

The checklist a release has to pass on a real GN630V before it can say **HIL verified**. A build that has only compiled is *Build verification only*; a release where some rows were not run says which ones (see [Badges](#badges)).

Run it on the exact images being released (same SHA-256 as `SHA256SUMS`), on the AX3000 GN630V only.

## Before you start

- [ ] **Full flash backup** of this unit, taken with `tools/dump_mtd.sh` from a RAM boot ([INSTALL.md](INSTALL.md)), SHA-256 checked, kept off the box.
- [ ] **Stock bank intact:** `alphawrt-bootbank` shows the stock image in the other bank. Rows A10 and A11 rely on it.
- [ ] **UART connected** (115200 8N1, 3.3 V, [RECOVERY.md](RECOVERY.md)) and logged to a file for the whole run. U-Boot and early boot are only visible there.
- [ ] **Previous release images** at hand (for A6 downgrade), with their SHA-256.
- [ ] **A switched power outlet** (smart plug or power strip with a switch) for A1 and A9, so power cuts are real cuts, not `reboot`.
- [ ] Tester agrees which rows touch the live fibre line (A12, A13): those run in a quiet hour.

Never write the bootloader, environment, calibration or identity partitions during acceptance. If a row bricks the box, stop the run and follow [RECOVERY.md](RECOVERY.md); that row is a FAIL.

## How results are recorded

One folder per run, **kept outside the repository** (logs name the box):

```
acceptance/<version>-<YYYYMMDD>/
  run.txt         unit label (e.g. "unit-A", never the serial or MAC), images and their SHA-256,
                  previous release used, tester, OLT/ISP (e.g. "TIME, Huawei OLT")
  results.tsv     one line per row:  row  result  date  evidence-file  note
  uart.log        the whole UART capture
  A1/ A2/ ...     evidence per row: command output, screenshots, iperf3 JSON, samples
```

- `result` is `PASS`, `FAIL`, or `N/A` (with the reason in `note`). A row that wasn't run is left out, not marked PASS.
- Evidence must come from this unit, these images and this run. No re-using an older run's logs.
- Before anything leaves the folder (an issue, the release notes), remove serials, PLOAM/ONU passwords, MACs, Wi-Fi keys, PPPoE accounts, public IPs and the stock admin password. The release notes get only the summary table (row, result, date).

## Matrix

| Row | Check | Pass line |
|---|---|---|
| A1 | Cold boot ×20 | 20/20 reach LuCI and the LAN, no kernel oops |
| A2 | 4 LAN ports at 1 Gbps | each port links at 1000/full and moves ≥ 900 Mbit/s |
| A3 | Wi-Fi 2.4 GHz | client associates, WPA2/WPA3, throughput recorded |
| A4 | Wi-Fi 5 GHz | client associates at 160 MHz, throughput recorded |
| A5 | sysupgrade forward | previous release → this release, settings kept |
| A6 | sysupgrade back | this release → previous release, then forward again |
| A7 | Factory reset (software) | `firstboot` returns to defaults, box usable |
| A8 | Factory reset (button) | holding reset ≥ 5 s returns to defaults |
| A9 | Power loss during sysupgrade | the box always ends in a bootable bank, nothing outside the bank written |
| A10 | 24 h soak | no reboot, no PON or WAN drop the box caused, memory flat |
| A11 | Revert to stock | stock boots from its bank with its own settings |
| A12 | PON link | O5 from cold, light and error counters sane |
| A13 | Internet over fibre | combo and bridge mode carry traffic |
| A14 | Fresh install from stock | the factory image from the stock web UI boots, and the LAN works before and after Quick Setup |

### A1. Cold boot ×20
- **Before:** this release installed, default or tester config saved.
- **Do:** 20 times: switch the outlet off, wait 10 s, switch on. Don't touch anything else.
- **Watch:** UART (`booting from Main Image` / `Slave Image`, kernel start, `procd: - init complete -`), then from a LAN client `ping 192.168.1.1` and the LuCI login page.
- **Pass:** 20/20 boot the same bank and reach the login page; record the time from power-on to the first ping reply for each. No `Oops`, `BUG:` or `Kernel panic` in `uart.log`.
- **Evidence:** `A1/boots.tsv` (cycle, bank, seconds to ping, LuCI OK), `uart.log`.

### A2. All 4 LAN ports at 1 Gbps
- **Before:** an iperf3 server on a wired host; a gigabit client.
- **Do:** for each of lan1..lan4: plug the client in that port only, run `iperf3 -c <server> -t 30` and `-R`.
- **Watch:** `ethtool lanN` on the box (or `cat /sys/class/net/lanN/speed`), the iperf3 output, the port's LED.
- **Pass:** `1000` and `Full` on each port, ≥ 900 Mbit/s both ways, link LED lights for that port.
- **Evidence:** `A2/lanN-ethtool.txt`, `A2/lanN-iperf3.json` (`iperf3 -J`).

### A3 / A4. Wi-Fi, both bands
- **Before:** Wi-Fi on (Quick Setup or LuCI), one SSID per band, a Wi-Fi 6 client at about 3 m.
- **Do:** associate on each band with WPA2 and then WPA3, run `iperf3` 30 s each way to a wired host.
- **Watch:** `iwinfo`, `iw dev <phy> station dump` (rate, width), iperf3.
- **Pass:** associates with both, 5 GHz shows 160 MHz width, no driver errors in `logread`. Throughput is recorded, not a pass line (it depends on the room and client).
- **Evidence:** `A3/`, `A4/`: `iwinfo` output, station dump, iperf3 JSON.

### A5. sysupgrade forward (previous → this)
- **Before:** previous release running with a non-default config (password, Wi-Fi, mode); config backup downloaded.
- **Do:** LuCI → System → Backup / Flash Firmware with this release's `*-sysupgrade.bin`, keep settings.
- **Watch:** UART, `cat /etc/openwrt_release`, `alphawrt-bootbank`, the settings.
- **Pass:** boots this release from the same bank, settings kept, the other (stock) bank unchanged.
- **Evidence:** `A5/before.txt`, `A5/after.txt` (`openwrt_release`, `alphawrt-bootbank`, `uci show` with secrets removed).

### A6. sysupgrade back (this → previous → this)
- **Do:** sysupgrade to the previous release's `*-sysupgrade.bin` keeping settings, then forward again.
- **Pass:** both upgrades boot, settings survive both, or a setting the older release doesn't know is reported in `note`.
- **Evidence:** as A5, for both steps.

### A7. Factory reset (software)
- **Do:** `firstboot -y && reboot`.
- **Pass:** boots with defaults (192.168.1.1, Quick Setup on first login), the overlay is fresh, the stock bank untouched.
- **Evidence:** `A7/after.txt` (`uci show network`, `df -h /overlay`, `alphawrt-bootbank`).

### A8. Factory reset (button)
- **Do:** with a changed config, hold reset for 5 s or more. Separately, press it briefly once.
- **Pass:** the long press resets to defaults like A7; the short press only reboots.
- **Evidence:** `A8/`: `logread` around the press, `after.txt` as A7.

### A9. Power loss during sysupgrade
The real test of the dual bank. U-Boot checks the bank image and switches to the other bank when it can't parse it ([RECOVERY.md](RECOVERY.md)).
- **Before:** UART logging. Backup taken (see above).
- **Do:** start a sysupgrade of this release and cut the power at three points: just after the upload (before flashing starts), mid-write (UART shows the bank being written), and right after the write before the reboot. One cut per run, three runs. After each, power on and watch.
- **Watch:** UART: which bank U-Boot boots and whether it switched the bootflag; then `alphawrt-bootbank`.
- **Pass:** every run ends in a bootable system: AlphaWRT again, or stock from the other bank, from which this release reinstalls (factory image, [INSTALL.md](INSTALL.md)). Never a box that needs a flash backup restored. The bootloader, environment and calibration partitions match the backup afterwards.
- **Evidence:** `A9/cutN-uart.log`, `A9/cutN-result.txt`, `A9/mtd-compare.txt` (SHA-256 of the protected partitions against the backup).

### A10. 24 h soak
- **Before:** the box in its normal job (combo or bridge on the live line), a read-only collector sampling every few minutes from another machine: PON state, light, line-error counters, memory, load, kernel errors, WAN/PPPoE uptime, loss to a public address.
- **Do:** leave it 24 h or more. No config changes during the run.
- **Pass:** uptime ≥ 24 h, no box-side PON deregistration or WAN drop (ISP-side events noted with their reason), `MemAvailable` without a steady fall, no `Oops`/`BUG:`, services (`dnsmasq`, `dnsproxy`, `uhttpd`, `omci-agent`, `netifd`) running at the end.
- **Evidence:** `A10/samples.tsv`, `A10/logread.log`, `A10/summary.txt` (start/end memory, drops with cause, max load, temperature if read).

### A11. Revert to stock
- **Do:** `alphawrt-bootbank stock`, `reboot`. Then from stock, switch back the way [RECOVERY.md](RECOVERY.md) documents.
- **Pass:** stock boots from its bank with its own settings, then AlphaWRT boots again with its settings.
- **Evidence:** `A11/uart.log` excerpt (bank switch), stock status page screenshot with identifiers blurred, AlphaWRT `alphawrt-bootbank` after.

### A12. PON link
- **Before:** fibre identity set for the line, fibre unplugged.
- **Do:** plug the fibre in, then power-cycle the box once with the fibre in.
- **Watch:** Basic → Fibre, the PON/LOS LEDs, `logread` GPON state lines.
- **Pass:** reaches O5 both times, records the seconds to O5, received light inside the module's range, BIP/HEC counters not climbing at rest.
- **Evidence:** `A12/`: the Fibre diagnostics report (secrets left out by the box), the seconds to O5.

### A13. Internet over fibre
- **Do:** combo mode: PPPoE up, `iperf3` or a speed test from a LAN client, IPv4 and IPv6. Bridge mode: the downstream router dials PPPoE through the box.
- **Pass:** both modes carry traffic; record throughput both ways.
- **Evidence:** `A13/`: speed results, `ifstatus wan` without addresses.

### A14. Fresh install from the stock web UI
The path most users take, and the one a sysupgrade (A5) doesn't cover: stock writes the bank, and AlphaWRT's first boot formats its data partition.
- **Before:** stock running (`alphawrt-bootbank stock`, reboot), its version noted in `run.txt`. UART logging. A LAN client on DHCP.
- **Do:** stock web UI → firmware upgrade with this release's `*-tclinux-factory.bin`. **Don't touch the power**, even if the box looks stuck; wait at least 10 minutes. Then run Quick Setup in combo mode with the line's PPPoE account.
- **Watch:** UART from the upload to `procd: - init complete -` (time it, and note any long pause); the client's DHCP lease and LuCI after the install and again after Quick Setup.
- **Pass:** boots AlphaWRT from the bank stock wrote, the client gets a 192.168.1.x lease and LuCI loads, both after the install and after Quick Setup; PPPoE comes up. Record the minutes from upload to the first DHCP lease.
- **Evidence:** `A14/uart.log`, `A14/timing.txt` (upload, reboot, init complete, first lease), `A14/after.txt` (`alphawrt-bootbank`, `ip -br addr`, `ifstatus wan` without addresses).

## Badges

- **Build verification only:** CI built the images; nothing above has run.
- **Partly HIL verified:** some rows passed; the release notes list which, and every row not run or failed is a known issue.
- **HIL verified:** every row A1–A14 has a PASS (or N/A with a reason) from one run on these images.

One unit passing is one unit. It says nothing about other hardware revisions (the 2.5G GN630V is not covered at all), other OLT vendors, or other ISPs.
