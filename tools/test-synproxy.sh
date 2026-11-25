#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Test alphawrt-synproxy's nftables table on a Linux host (as root, needs
# nft, ip, ss, curl, python3, hping3 and the nft_synproxy module):
#
#   cli 203.0.113.10 --w0-- rtr 203.0.113.1 | br-lan 192.168.1.1 --+-- srv 192.168.1.41
#                                                                    +-- lan 192.168.1.50
#
# rtr loads an fw4-like ruleset (DNAT 443 and 8443->443 to srv, reflection
# for the LAN, input/forward policy drop, fw4's input-only syn_flood, its
# drop of invalid packets out to the masqueraded wan) plus
# the table `synproxy render` prints, then the client tests the forwards
# with and without a spoofed SYN flood.
#
#   sudo tools/test-synproxy.sh
#
# Without nft_synproxy (e.g. WSL2) the synproxy statement is swapped for a
# counter and only the tests that don't need it run, unless
# REQUIRE_SYNPROXY=1 (CI), which makes that a failure.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
SYNPROXY="$HERE/package/alphawrt-synproxy/root/usr/libexec/alphawrt/synproxy"
WWW=$(mktemp -d)
FAILS=0 SKIPS=0

ok() { echo "PASS  $*"; }
no() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
skip() { echo "SKIP  $*"; SKIPS=$((SKIPS + 1)); }
X() { ip netns exec "$@"; }
get() { # <ns> <url>: HTTP status code
	X "$1" curl -s -m 8 -o /dev/null -w '%{http_code}' "$2"
}
cnt() { # <counter>: packets of a named counter in the synproxy table
	X rtr nft list counter inet alphawrt_synproxy "$1" | sed -n 's/.*packets \([0-9]*\).*/\1/p'
}
srv_syns() {
	X srv nft list chain inet count input | sed -n 's/.*packets \([0-9]*\).*/\1/p'
}
cookies() { # completed synproxy handshakes, all CPUs (hex columns)
	X rtr sh -c 'n=0; for v in $(awk "NR > 1 { print \$4 }" /proc/net/stat/synproxy 2>/dev/null); do n=$((n + 0x$v)); done; echo $n'
}
flooded() { X rtr nft list set inet alphawrt_synproxy flood | grep -q 'elements'; }
halfopen() { X srv ss -Htan state syn-recv | wc -l; }

cleanup() {
	for n in cli rtr srv lan; do ip netns del $n 2>/dev/null; done
	[ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
	rm -rf "$WWW"
}
trap cleanup EXIT

if modprobe nft_synproxy 2>/dev/null || grep -q '^nft_synproxy ' /proc/modules; then
	PROXY=1
elif [ "${REQUIRE_SYNPROXY:-0}" = 1 ]; then
	echo "FAIL  nft_synproxy is not available"; exit 1
else
	PROXY=0
	echo "note: no nft_synproxy here, the synproxy statement becomes a counter"
fi

# --- topology ---
for n in cli rtr srv lan; do ip netns del $n 2>/dev/null; ip netns add $n; X $n ip link set lo up; done
ip link add c0 netns cli type veth peer name w0 netns rtr
ip link add s0 netns srv type veth peer name l0 netns rtr
ip link add n0 netns lan type veth peer name l1 netns rtr
X rtr ip link add br-lan type bridge
X rtr ip link set l0 master br-lan
X rtr ip link set l1 master br-lan
for d in w0 l0 l1 br-lan; do X rtr ip link set $d up; done
X rtr ip addr add 203.0.113.1/24 dev w0
X rtr ip addr add 192.168.1.1/24 dev br-lan
X rtr ip route add default via 203.0.113.10
X cli ip addr add 203.0.113.10/24 dev c0; X cli ip link set c0 up
X srv ip addr add 192.168.1.41/24 dev s0; X srv ip link set s0 up; X srv ip route add default via 192.168.1.1
X lan ip addr add 192.168.1.50/24 dev n0; X lan ip link set n0 up; X lan ip route add default via 192.168.1.1
X rtr sysctl -qw net.ipv4.ip_forward=1 net.ipv4.conf.all.rp_filter=0 net.ipv4.conf.default.rp_filter=0 net.ipv4.conf.w0.rp_filter=0
X cli sysctl -qw net.ipv4.conf.all.rp_filter=0

# --- server: HTTP on 443 (plain TCP is all the test needs), logs client addresses ---
head -c 20000000 /dev/urandom > "$WWW/big.bin"
echo ok > "$WWW/health"
(cd "$WWW" && exec ip netns exec srv python3 -m http.server 443 >"$WWW/log" 2>&1) &
SRV_PID=$!
X srv nft -f - <<'EOF'
table inet count {
	chain input {
		type filter hook input priority filter; policy accept;
		tcp dport 443 tcp flags & (fin | syn | rst | ack) == syn counter
	}
}
EOF

# --- router: the parts of fw4 that matter here ---
X rtr nft -f - <<'EOF'
table inet fw4 {
	chain input {
		type filter hook input priority filter; policy drop;
		iif "lo" accept
		ct state vmap { established : accept, related : accept }
		iifname "br-lan" accept
		iifname "w0" tcp flags & (fin | syn | rst | ack) == syn jump syn_flood
		iifname "w0" meta l4proto tcp reject with tcp reset
	}
	chain syn_flood {
		limit rate 25/second burst 50 packets return
		drop
	}
	# wan is masqueraded, so fw4 drops invalid packets on their way out to it
	chain output {
		type filter hook output priority filter; policy accept;
		oif "lo" accept
		ct state vmap { established : accept, related : accept }
		oifname "w0" jump output_wan
	}
	chain output_wan {
		jump accept_to_wan
	}
	chain accept_to_wan {
		meta nfproto ipv4 oifname "w0" ct state invalid counter drop comment "!fw4: Prevent NAT leakage"
		oifname "w0" counter accept
	}
	chain forward {
		type filter hook forward priority filter; policy drop;
		ct state vmap { established : accept, related : accept }
		iifname "w0" ct status dnat accept
		iifname "br-lan" accept
	}
	chain dstnat {
		type nat hook prerouting priority dstnat; policy accept;
		iifname "w0" meta nfproto ipv4 tcp dport 443 dnat ip to 192.168.1.41:443
		iifname "w0" meta nfproto ipv4 tcp dport 8443 dnat ip to 192.168.1.41:443
		iifname "br-lan" ip saddr 192.168.1.0/24 ip daddr 203.0.113.1 tcp dport 443 dnat ip to 192.168.1.41:443
	}
	chain srcnat {
		type nat hook postrouting priority srcnat; policy accept;
		oifname "br-lan" ip saddr 192.168.1.0/24 ip daddr 192.168.1.41 tcp dport 443 snat ip to 192.168.1.1
		oifname "w0" masquerade
	}
}
EOF
X rtr sysctl -qw net.netfilter.nf_conntrack_tcp_loose=0

load() { # <mode> [hold]
	MODE=$1 RATE=10 BURST=50 HOLD=${2:-600} MSS=1460 WSCALE=7 WAN=w0 \
		SAME="443=192.168.1.41" MOVED="8443=192.168.1.41:443" sh "$SYNPROXY" render >"$WWW/table.nft"
	[ $PROXY = 1 ] || sed -i 's/synproxy mss .*/counter/' "$WWW/table.nft"
	X rtr nft -f "$WWW/table.nft"
}
flood() { # <seconds>: spoofed SYNs, about 1000 a second, in the background
	X cli timeout "$1" hping3 -q -S -p 443 --rand-source -i u1000 203.0.113.1 >/dev/null 2>&1 &
	FLOOD_PID=$!
}

echo "== auto mode, no flood"
if load auto 5; then ok "table loads (auto)"; else no "table loads (auto)"; cat -n "$WWW/table.nft"; exit 1; fi
[ "$(get cli http://203.0.113.1:443/health)" = 200 ] && ok "client reaches 443" || no "client reaches 443"
tail -n 1 "$WWW/log" | grep -q '^203\.0\.113\.10 ' && ok "server sees the client's own address" || no "server sees the client's own address"
[ "$(get cli http://203.0.113.1:8443/health)" = 200 ] && ok "client reaches 8443 -> 443" || no "client reaches 8443 -> 443"
[ "$(cnt proxied)" = 0 ] && ok "nothing proxied without a flood" || no "nothing proxied without a flood ($(cnt proxied))"
[ "$(get lan http://203.0.113.1:443/health)" = 200 ] && ok "LAN client through NAT reflection" || no "LAN client through NAT reflection"
before=$(wc -l < "$WWW/log")
X rtr curl -s -m 3 -o /dev/null http://203.0.113.1:443/health
[ "$(wc -l < "$WWW/log")" = "$before" ] && ok "box's own connection to its public address is not redirected" || no "box's own connection to its public address is not redirected"

echo "== auto mode under a spoofed SYN flood"
if [ $PROXY = 1 ]; then
	flood 12
	sleep 3
	flooded && ok "flood switches the SYN proxy on" || no "flood switches the SYN proxy on"
	c0=$(cookies) s0=$(srv_syns) h0=$(halfopen)
	sleep 3
	s1=$(srv_syns) h1=$(halfopen)
	[ $((s1 - s0)) -le 2 ] && ok "flood SYNs stay off the server ($((s1 - s0)) in 3 s)" || no "flood SYNs stay off the server ($((s1 - s0)) in 3 s)"
	# auto mode lets the first burst (BURST=50) through before it switches;
	# those stay half-open on the server until its SYN-ACK retries run out
	[ "$h0" -le 60 ] && [ "$h1" -le $((h0 + 2)) ] && ok "half-open connections on the server stop at the first burst ($h0, then $h1)" \
		|| no "half-open connections on the server stop at the first burst ($h0, then $h1)"
	[ "$(get cli http://203.0.113.1:443/health)" = 200 ] && ok "real client gets through during the flood" || no "real client gets through during the flood"
	tail -n 1 "$WWW/log" | grep -q '^203\.0\.113\.10 ' && ok "server still sees the client's own address" || no "server still sees the client's own address"
	[ "$(cookies)" -gt "$c0" ] && ok "that connection went through the SYN proxy" || no "that connection went through the SYN proxy"
	X cli curl -s -m 60 -o "$WWW/got.bin" http://203.0.113.1:8443/big.bin
	cmp -s "$WWW/got.bin" "$WWW/big.bin" && ok "20 MB through the proxied, moved port intact" || no "20 MB through the proxied, moved port intact"
	[ "$(get lan http://203.0.113.1:443/health)" = 200 ] && ok "LAN client unaffected by the flood" || no "LAN client unaffected by the flood"
	wait "$FLOOD_PID" 2>/dev/null
	sleep 7
	flooded && no "SYN proxy off after the hold time" || ok "SYN proxy off after the hold time"
	p0=$(cnt proxied)
	[ "$(get cli http://203.0.113.1:443/health)" = 200 ] && [ "$(cnt proxied)" = "$p0" ] && ok "back to the normal path" || no "back to the normal path"
else
	skip "flood tests (no nft_synproxy)"
fi

echo "== always mode"
load always || no "table loads (always)"
if [ $PROXY = 1 ]; then
	p0=$(cnt proxied) c0=$(cookies)
	[ "$(get cli http://203.0.113.1:443/health)" = 200 ] && ok "client reaches 443" || no "client reaches 443"
	[ "$(cnt proxied)" -gt "$p0" ] && [ "$(cookies)" -gt "$c0" ] && ok "every new connection is proxied" || no "every new connection is proxied"
	X cli curl -s -m 60 -o "$WWW/got.bin" http://203.0.113.1:443/big.bin
	cmp -s "$WWW/got.bin" "$WWW/big.bin" && ok "20 MB through the proxy intact" || no "20 MB through the proxy intact"
	leaked=$(X rtr nft list chain inet fw4 accept_to_wan | sed -n 's/.*invalid counter packets \([0-9]*\).*/\1/p')
	[ "$leaked" = 0 ] && ok "no SYN-ACK of the proxy dropped as invalid on the way out" \
		|| no "no SYN-ACK of the proxy dropped as invalid on the way out ($leaked)"
else
	skip "always-mode proxy tests (no nft_synproxy)"
fi

echo "== off"
X rtr nft delete table inet alphawrt_synproxy
[ "$(get cli http://203.0.113.1:443/health)" = 200 ] && ok "forwards work with the table gone" || no "forwards work with the table gone"

echo
echo "$FAILS failed, $SKIPS skipped"
[ $FAILS = 0 ]
