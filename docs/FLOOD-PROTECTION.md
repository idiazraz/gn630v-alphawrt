# Flood protection for port forwards

The firewall's own SYN flood guard (`syn_flood` in fw4) only looks at traffic to the box itself. Traffic you forward to a device on the LAN (a web server, a game server, a NAS) never passes it, so a flood of fake connection attempts goes straight to that device and can fill its connection backlog. `alphawrt-synproxy` closes that gap.

It's on by default in **Automatic** mode and does nothing until you have a port forward. The settings and counts are on the Network page, under Port forwards.

## How it works

During a flood the box answers each new connection attempt itself with a SYN cookie, as the Linux kernel does for its own services. Fake attempts never answer back, so they cost the device behind the box nothing. A real client answers, and only then does the box open the connection to your device. Your device still sees the client's real IP address.

| Mode | What it does |
|---|---|
| **Automatic** (default) | Watches the rate of new connections to your forwarded ports. Above 10 per second (with a burst of 50), it turns on for every forwarded port and stays on until 10 minutes after the flood stops. Normal traffic takes the usual path, with hardware offload. |
| **Always on** | Every new connection to a forwarded port goes through the box first. It also covers the first second of a flood, but those connections skip hardware offload, and Windows browsers may download a little slower through it. |
| **Off** | No protection for forwarded ports, as before. |

Busy servers with more than 10 new connections a second will see Automatic turn on during their peaks. That's harmless: clients still connect, only a little slower to start.

## What it covers

- IPv4 TCP port forwards from the internet (the `wan` zone) to a LAN device, including forwards to a different port (8443 → 443).
- Not covered: UDP, IPv6 (the box opens IPv6 ports with traffic rules, not forwards), forwards limited to a source address or MAC, forwards that move a port range, and UPnP/NAT-PMP mappings.
- NAT reflection (opening your public address from inside the LAN) and the box's own services are not changed.

## The 2-hour rule

While it's on, the box sets `net.netfilter.nf_conntrack_tcp_loose` to 0, and puts the old value back when it turns off. That makes the box drop packets for a connection it no longer tracks. A connection through the box that stays completely silent for more than 2 hours (no keepalives) ends and has to reconnect. SSH and most apps send keepalives; turn them on where they're off, or set flood protection to Off.

## Checking it from SSH

```sh
ubus call alphawrt-synproxy status     # mode, state, ports, counts
nft list table inet alphawrt_synproxy  # the rules it made
logread -e alphawrt-synproxy           # when floods started
uci set alphawrt.synproxy.mode=off; uci commit alphawrt; fw4 reload
```

In Automatic mode it can also tune `rate` (new connections per second, default 10), `burst` (50), `hold` (seconds to stay on, 600), `mss` (default from the WAN MTU) and `wscale` (7) in the `alphawrt.synproxy` section. Run `fw4 reload` after a change.

The rules are rebuilt on every firewall reload, so changes to port forwards take effect at once. If the kernel module is missing, or the rules fail to load, it stays out of the way and says so on the Network page.

## Tests

`tools/test-synproxy.sh` builds a small lab with network namespaces (client, box, LAN server), loads a firewall like fw4's and floods a forward with spoofed SYNs. It checks that real clients still connect with their real IP, that the server sees almost none of the flood, that large transfers come through intact, that Automatic turns off again, and that NAT reflection and the box's own connections are unchanged. GitHub Actions runs it on a kernel with `nft_synproxy` (`.github/workflows/synproxy.yml`).
