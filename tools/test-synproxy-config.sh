#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Test which port forwards alphawrt-synproxy covers, and which it leaves to
# fw4, on an OpenWrt root filesystem (uci, /lib/functions.sh, busybox ip).
# Reads a throwaway config directory, never /etc/config:
#
#   docker run --rm -v "$PWD:/repo:ro" openwrt/rootfs:x86-64-v25.12.6 \
#     /bin/sh /repo/tools/test-synproxy-config.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
SYNPROXY="$HERE/package/alphawrt-synproxy/root/usr/libexec/alphawrt/synproxy"
UCI_CONFIG_DIR=$(mktemp -d)
export UCI_CONFIG_DIR
trap 'rm -rf "$UCI_CONFIG_DIR"' EXIT
FAILS=0

ok() { echo "PASS  $*"; }
no() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }

cat > "$UCI_CONFIG_DIR/firewall" <<'EOF'
config defaults
	option input 'REJECT'
	option output 'ACCEPT'
	option forward 'REJECT'

config zone
	option name 'lan'
	list network 'lan'
	option input 'ACCEPT'
	option output 'ACCEPT'
	option forward 'ACCEPT'

config zone
	option name 'wan'
	list network 'wan'
	option input 'REJECT'
	option output 'ACCEPT'
	option forward 'REJECT'
	option masq '1'

config rule
	option name 'Allow-Ping'
	option src 'wan'
	option proto 'icmp'
	option target 'ACCEPT'

config rule
	option name 'block-one-net'
	option src 'wan'
	option dest 'lan'
	option src_ip '198.51.100.0/24'
	option dest_ip '192.168.1.49'
	option target 'REJECT'

config rule
	option name 'block-other-host'
	option src 'wan'
	option dest 'lan'
	option dest_ip '192.168.1.60'
	option proto 'tcp'
	option target 'DROP'

config rule
	option name 'block-udp'
	option src 'wan'
	option dest 'lan'
	option proto 'udp'
	option target 'DROP'

config rule
	option name 'block-v6'
	option src 'wan'
	option dest 'lan'
	option family 'ipv6'
	option target 'DROP'

config rule
	option name 'block-off'
	option src 'wan'
	option dest 'lan'
	option target 'DROP'
	option enabled '0'

config rule
	option name 'block-port-9100'
	option src 'wan'
	option dest '*'
	option dest_port '9100'
	option target 'DROP'

config redirect
	option name 'web'
	option src 'wan'
	option src_dport '443'
	option dest 'lan'
	option dest_ip '192.168.1.41'
	option proto 'tcp'
	option target 'DNAT'

config redirect
	option name 'web-alt'
	option src 'wan'
	option src_dport '8443'
	option dest_ip '192.168.1.41'
	option dest_port '443'
	option target 'DNAT'

config redirect
	option name 'ssh-off'
	option src 'wan'
	option src_dport '2222'
	option dest_ip '192.168.1.43'
	option dest_port '22'
	option enabled 'off'

config redirect
	option name 'ssh-no'
	option src 'wan'
	option src_dport '2223'
	option dest_ip '192.168.1.43'
	option dest_port '22'
	option enabled 'no'

config redirect
	option name 'ssh-bad-bool'
	option src 'wan'
	option src_dport '2224'
	option dest_ip '192.168.1.43'
	option dest_port '22'
	option enabled 'disabled'

config redirect
	option name 'zero'
	option src 'wan'
	option src_dport '0080'
	option dest_ip '192.168.1.42'
	option proto 'tcp'

config redirect
	option name 'rdp-office-hours'
	option src 'wan'
	option src_dport '3389'
	option dest_ip '192.168.1.46'
	option start_time '09:00:00'
	option stop_time '17:00:00'

config redirect
	option name 'rdp-after'
	option src 'wan'
	option src_dport '3389'
	option dest_ip '192.168.1.47'

config redirect
	option name 'ssh-one-client'
	option src 'wan'
	option src_dport '22'
	option src_ip '203.0.113.7'
	option dest_ip '192.168.1.44'

config redirect
	option name 'ssh-everyone-else'
	option src 'wan'
	option src_dport '22'
	option dest_ip '192.168.1.45'

config redirect
	option name 'src-port'
	option src 'wan'
	option src_dport '4000'
	option src_port '1000-2000'
	option dest_ip '192.168.1.56'

config redirect
	option name 'to-the-box'
	option src 'wan'
	option src_dport '9000'
	option dest_ip '127.0.0.1'
	option dest_port '80'

config redirect
	option name 'udp-only'
	option src 'wan'
	option src_dport '5000'
	option dest_ip '192.168.1.48'
	option proto 'udp'

config redirect
	option name 'blocked-host'
	option src 'wan'
	option src_dport '6000'
	option dest_ip '192.168.1.49'

config redirect
	option name 'other-host'
	option src 'wan'
	option src_dport '7000'
	option dest_ip '192.168.1.50'

config redirect
	option name 'blocked-port'
	option src 'wan'
	option src_dport '9100'
	option dest_ip '192.168.1.53'

config redirect
	option name 'range'
	option src 'wan'
	option src_dport '10000-10010'
	option dest_ip '192.168.1.51'

config redirect
	option name 'range-move'
	option src 'wan'
	option src_dport '20000-20010'
	option dest_ip '192.168.1.52'
	option dest_port '30000-30010'

config redirect
	option name 'from-lan'
	option src 'lan'
	option src_dport '8080'
	option dest_ip '192.168.1.57'

config redirect
	option name 'every-port'
	option src 'wan'
	option dest_ip '192.168.1.54'
	option proto 'tcp'

config redirect
	option name 'after-every-port'
	option src 'wan'
	option src_dport '12345'
	option dest_ip '192.168.1.55'
EOF

out=$(sh "$SYNPROXY" plan) || no "plan runs"
echo "$out" | sed 's/^/    /'

[ "$(echo "$out" | sed -n 's/^same://p')" = " 443=192.168.1.41 80=192.168.1.42 7000=192.168.1.50 10000-10010=192.168.1.51" ] \
	&& ok "covered forwards that keep the port" || no "covered forwards that keep the port"
[ "$(echo "$out" | sed -n 's/^moved://p')" = " 8443=192.168.1.41:443" ] \
	&& ok "covered forward that moves the port" || no "covered forward that moves the port"

skipped() { # <name> <reason>
	echo "$out" | grep -qF "skip: skipping port forward '$1': $2" && ok "$1 left to fw4: $2" || no "$1 left to fw4: $2"
}
skipped rdp-office-hours "limited by start_time"
skipped rdp-after "port 3389 is in an earlier forward"
skipped ssh-one-client "limited by src_ip"
skipped ssh-everyone-else "port 22 is in an earlier forward"
skipped src-port "limited by src_port"
skipped to-the-box "forwards to the box itself"
skipped blocked-host "a drop or reject rule from wan may match it"
skipped blocked-port "a drop or reject rule from wan may match it"
skipped range-move "moves a port range"
skipped every-port "not one port or range"
skipped after-every-port "port 12345 is in an earlier forward"

for n in ssh-off ssh-no ssh-bad-bool udp-only from-lan; do
	echo "$out" | grep -q "'$n'" && no "$n ignored, like fw4 does" || ok "$n ignored, like fw4 does"
done

echo
echo "$FAILS failed"
[ $FAILS = 0 ]
