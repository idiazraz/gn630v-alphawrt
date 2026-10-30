# Wi-Fi TX beamforming on the GN630V

The MT7916 runs explicit TX beamforming (eBF) out of the box in AlphaWRT: stock mt76 `mt7915e` advertises SU/MU beamformer on both bands, and nothing needs patching. This page shows it working and measures what it gains on 5 GHz.

## How it works here
* **Explicit only, in practice.** The AP sounds the client, the client sends back a compressed beamforming report, and the AP steers the next PPDUs with it. `mt7915_mcu_sta_bfer_tlv()` picks eBF for any station that is a beamformee, and falls back to implicit BF (`implicit_txbf` in debugfs) only for stations that aren't. The choice is made at association, so writing `implicit_txbf` changes nothing for a beamformee client.
* **Counters** are in `/sys/kernel/debug/ieee80211/phy1/mt76/tx_stats` (`phy0` for 2.4 GHz):
  ```
  Tx Beamformer applied PPDU counts: iBF: 0, eBF: 38099
  Tx Beamformer Rx feedback statistics: All: 2311, HE: 195, VHT: 2116, ...
  ```
  The firmware counts beamformed PPDUs but not all PPDUs, so there is no "% beamformed" figure as there is on MT7615.
* **Switch it off** for a comparison by dropping the beamformer capability from hostapd (the client then sends no feedback and eBF stops):
  ```sh
  uci set wireless.radio1.su_beamformer=0; uci set wireless.radio1.mu_beamformer=0
  uci commit wireless; wifi reload
  # back to the default
  uci delete wireless.radio1.su_beamformer; uci delete wireless.radio1.mu_beamformer
  uci commit wireless; wifi reload
  ```
* `tx failed` in `iw station get` tracks `tx retries` almost exactly on this driver, so only retries are used below.

## Result: 5 GHz, VHT client
AlphaWRT r37113+152 (mt76 `467ae2e3`), 5 GHz HE160 (channels 36-64), 2x2. Client: Honor X9c (Wi-Fi 5, VHT, 1 spatial stream, SU/MU beamformee) at 80 MHz, lying still at -81 to -90 dBm. Downlink over HTTP from a wired host, 30 s windows, eBF on and off alternating:

| Round | eBF | Signal (dBm) | Mbit/s | Retries | eBF PPDUs |
|---|---|---|---|---|---|
| 1 | on | -90 | 105.7 | 18.3% | 6156 |
| 1 | off | -88 | 84.1 | 20.9% | 0 |
| 2 | on | -86 | 127.3 | 13.9% | 6683 |
| 2 | off | -82 | 105.6 | 16.5% | 0 |
| 3 | on | -81 | 129.0 | 15.5% | 7143 |
| 3 | off | -82 | 102.7 | 16.8% | 0 |
| **mean** | **on** | | **120.7** | **15.9%** | |
| **mean** | **off** | | **97.5** | **18.1%** | |

**eBF gives +24% downlink throughput (+20% to +26% per round) and 2.2 points fewer retries.** It wins every round, including round 2, where the eBF-off window had the better signal.

One client, one spot, one unit. The client is VHT only, so HE beamforming (HE160, HE SU/MU feedback) is still to measure, and so are MU-MIMO and 2.4 GHz.

## Run it yourself
1. On a wired host, serve the load page and a large file. The phone and the host must reach each other on the same subnet:
   ```sh
   mkdir www && cp tools/txbf_load.html www/index.html
   dd if=/dev/zero of=www/big.bin bs=1 count=0 seek=2g    # sparse, takes no space
   python3 -m http.server 8000 --directory www
   ```
2. Open `http://<host>:8000/` on the client and keep the screen on. The page downloads in a loop and reconnects after each `wifi reload`.
3. Find the client's MAC with `iw dev phy1-ap0 station dump` and run:
   ```sh
   sh tools/txbf_ab.sh <client-mac> 3 30 > txbf.csv
   ```
   It takes about 7 minutes for 3 rounds and turns eBF back on when it exits.
