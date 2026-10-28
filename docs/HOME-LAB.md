# Home lab features

Everything here is off until you turn it on. It's on the Home lab page, or in Advanced (LuCI) where noted.

## What works where

| Feature | Bridge mode | Router (combo) mode | Needs a public IPv4 |
|---|---|---|---|
| Prometheus metrics (fibre, CPU per core, memory, load, uptime, traffic) | yes, `http://192.168.100.1:9100/metrics` | yes, `http://192.168.1.1:9100/metrics` | no |
| iperf3 server (port 5201) | yes | yes | no |
| Remote syslog | yes (to a host on the box's network) | yes | no |
| SSH keys, password login off | yes | yes | no |
| Wake-on-LAN | yes (LAN 2–4) | yes | no |
| Static leases, local names (`nas.lan`) | no (the customer's router does DHCP and DNS) | yes | no |
| Port forwards, UPnP/NAT-PMP | no | yes | **yes** |
| NTP server for the LAN | no | yes | no |
| DDNS (Advanced → Services → Dynamic DNS) | no | yes | for an A record; an AAAA record works behind CGNAT |
| WireGuard site-to-site (Advanced → Network → Interfaces) | no | yes | for incoming peers only |

In bridge mode the box has no route to the Internet. Its own clock isn't synced, and it can't reach DDNS, NTP or a WireGuard peer.

**CGNAT.** TIME home plans sit behind carrier-grade NAT unless you ask TIME for a public IP. Unifi home plans usually get a public dynamic IPv4. Behind CGNAT, port forwards, UPnP and inbound WireGuard can't work over IPv4. Two things still do: IPv6, and a WireGuard tunnel that the box dials out to a VPS or another site.

## Metrics

The endpoint serves the usual node metrics (CPU, memory, network, temperatures, Wi-Fi) plus:

| Metric | Meaning |
|---|---|
| `alphawrt_rx_dbm`, `alphawrt_tx_dbm` | optical power, received and sent |
| `alphawrt_optics_temp_celsius`, `alphawrt_laser_bias_amperes` | optics health |
| `alphawrt_pon_state` | registration state (5 = O5, registered) |
| `alphawrt_line_errors_total{type=…}` | HEC, CRC, BIP, LOF and FEC counters |
| `alphawrt_olt_threshold{type=…}` | the OLT's Rx window and SD/SF error-rate limits |
| `alphawrt_wan_uptime_seconds` | Internet connection uptime (router mode) |

The fibre values update once a minute. Example scrape config:

```yaml
- job_name: alphawrt
  static_configs:
    - targets: ['192.168.1.1:9100']
```

### Grafana dashboard

Grafana and Prometheus run on your own server; they're too big for the box. The firmware only serves the metrics.

1. Turn on **Metrics** on the Home lab page.
2. Add the box to Prometheus with the scrape config above.
3. In Grafana, import [`grafana/alphawrt.json`](grafana/alphawrt.json) (Dashboards → New → Import) and pick your Prometheus data source.

The dashboard shows:
- **Stats:** fibre Rx, line state, PPPoE uptime, box uptime, memory used, optics temperature.
- **Graphs:** CPU per core, load, memory, fibre light against the OLT's lower limit, line errors, and traffic per port.

If you have more than one box, the **Box** menu at the top switches between them.

## htop

`htop` is installed for SSH sessions: run `htop` after `ssh root@<box>`. btop isn't included: with the C++ runtime it needs, it would take about 1 MB of firmware space, against about 0.3 MB for htop.

## WireGuard site-to-site behind CGNAT

Make the box the side that dials out. In Advanced → Network → Interfaces → your WireGuard interface → Peers:
- set the far side's public endpoint;
- set **Persistent keepalive** to 25;
- list the far side's subnet in **Allowed IPs**, and tick **Route allowed IPs**.

The far side (a VPS or a router with a public IP) needs no endpoint for this peer.

## Not included, and why

- **Tailscale:** the package is about 10.6 MB, more than all the free space in the firmware. Run it on a Raspberry Pi or NAS on your LAN as a subnet router instead.
- **ZeroTier:** about 1.1 MB with its C++ runtime, plus several MB of RAM. Use WireGuard instead.
- **Speed-test web page:** the box's CPU would be the limit, not your fibre. Use iperf3 for LAN and Wi-Fi tests.
- **SNMP, mDNS, VLAN-aware LAN ports, Let's Encrypt for the UI:** maybe later.
