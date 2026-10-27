#!/bin/sh
# Stock vs AlphaWRT capture, run on the wired test client (macOS or Linux).
# See docs/STOCK-VS-ALPHAWRT.md.
#   sh compare-test.sh stock                       # while stock runs
#   BOX=root@192.168.1.1 sh compare-test.sh alphawrt
#   sh compare-test.sh report                      # side-by-side table
# Each run: ping idle, 3 x 8-stream download, 3 x 8-stream upload, ping under
# load. With BOX set (AlphaWRT only) it also reads the box over SSH: version,
# PON state, light, line counters at start/end, CPU idle during a download.
# Results go to ./results/: one folder of raw logs per run, and one line per
# run in results.tsv. Nothing in them names the box, the line or your IP.
#   DOWN_URL / UP_URL: other test servers (use the same ones for both runs)
#   REST=600: wait 10 min at rest before the speed tests, for the counters

DOWN_URL=${DOWN_URL:-http://sin1-sgp.speedtest.network.ovh.net/files/10Gb.dat}
UP_URL=${UP_URL:-https://speed.cloudflare.com/__up}
STREAMS=8 SECS=30 RUNS=3
RES=./results

median() { sort -n | awk '{ v[NR] = $1 } END { print NR ? v[int((NR + 1) / 2)] : "-" }'; }
# ping output (macOS or Linux) -> "median worst" in ms
pingstat() { sed -n 's/.*time[=<]\([0-9.]*\).*/\1/p' | sort -n |
	awk '{ v[NR] = $1 } END { if (NR) printf "%s %s\n", v[int((NR + 1) / 2)], v[NR]; else print "- -" }'; }
mbit() { awk '{ s += $1 } END { printf "%.0f\n", s * 8 / 1e6 }'; }

down() {
	i=0; while [ $i -lt $STREAMS ]; do
		curl -s -o /dev/null -m $SECS -w '%{speed_download}\n' "$DOWN_URL" & i=$((i + 1))
	done; wait
}
up() {
	i=0; while [ $i -lt $STREAMS ]; do
		head -c 2000000000 /dev/zero | curl -s -o /dev/null -m $SECS -w '%{speed_upload}\n' \
			-H 'Origin: https://speed.cloudflare.com' -H 'Referer: https://speed.cloudflare.com/' \
			-T - "$UP_URL" & i=$((i + 1))
	done; wait
}

box() { [ -n "$BOX" ] && ssh -o ConnectTimeout=5 "$BOX" "$1" 2>/dev/null; }
# version, PON state, RX dBm, temp C, hec_unc bip lof crc
BOXSNAP='C=/sys/bus/platform/devices/1fb60000.xmac/gpon_counters
c() { sed -n "s/^$1=//p" $C; }
eval "$(ubus call omci.agent status "{\"device\":0}" | jsonfilter -e "st=@.status.state" -e "rx=@.status.bosa_rx_power_nw" -e "t=@.status.bosa_temperature_mc")"
. /etc/openwrt_release
echo "$DISTRIB_RELEASE ${st:--} $(awk -v n="${rx:-0}" "BEGIN { if (n > 0) printf \"%.1f\", 10 * log(n / 1e6) / log(10); else print \"-\" }") $(( ${t:-0} / 1000 )) $(c hec_uncorrectable) $(c bip_errors) $(c lof) $(c rx_crc_errors)"'
# CPU idle % over 10 s
BOXIDLE='a=$(head -1 /proc/stat); sleep 10; b=$(head -1 /proc/stat)
echo "$a" "$b" | awk "{ for (i = 2; i <= 11; i++) { t += \$(i + 11) - \$i }; print int(100 * (\$16 - \$5) / t) }"'

selftest() {
	[ "$(printf '3\n1\n2\n' | median)" = 2 ] || { echo "median FAIL"; exit 1; }
	[ "$(printf '64 bytes: icmp_seq=0 ttl=57 time=12.3 ms\n64 bytes: icmp_seq=1 ttl=57 time=9.8 ms\n64 bytes: icmp_seq=2 ttl=57 time=40.1 ms\n' | pingstat)" = "12.3 40.1" ] ||
		{ echo "pingstat FAIL"; exit 1; }
	[ "$(printf '62500000\n62500000\n' | mbit)" = 1000 ] || { echo "mbit FAIL"; exit 1; }
	echo "selftest ok"
}

case "$1" in
"" | -h) sed -n 2,13p "$0"; exit 0 ;;
selftest) selftest; exit ;;
report) column -t -s "$(printf '\t')" "$RES/results.tsv"; exit ;;
esac

label=$1 stamp=$(date +%Y%m%d-%H%M)
dir=$RES/$label-$stamp
mkdir -p "$dir" || exit 1
[ -f "$RES/results.tsv" ] || printf 'run\tversion\tpon\trx_dBm\tdown_mbit\tup_mbit\tdown_runs\tup_runs\tping_idle\tping_load\tbox_idle%%\tcounters_start\tcounters_end\tdown_url\n' > "$RES/results.tsv"

echo "== $label, results in $dir"
s0=$(box "$BOXSNAP"); echo "${s0:-no box reading}" | tee "$dir/box-start.txt"
if [ -n "$REST" ]; then echo "resting $REST s"; sleep "$REST"; fi

echo "ping idle (30 s)"
ping -c 30 1.1.1.1 > "$dir/ping-idle.txt" 2>&1
pi=$(pingstat < "$dir/ping-idle.txt")

n=1; while [ $n -le $RUNS ]; do
	if [ $n = 1 ]; then
		ping -c 25 1.1.1.1 > "$dir/ping-load.txt" 2>&1 &
		[ -n "$BOX" ] && { sleep 10; box "$BOXIDLE" > "$dir/box-idle.txt"; } &
	fi
	down > "$dir/down$n.txt"; wait
	echo "down $n: $(mbit < "$dir/down$n.txt") Mbit/s"
	n=$((n + 1))
done
n=1; while [ $n -le $RUNS ]; do
	up > "$dir/up$n.txt"
	echo "up $n: $(mbit < "$dir/up$n.txt") Mbit/s"
	n=$((n + 1))
done
pl=$(pingstat < "$dir/ping-load.txt")
s1=$(box "$BOXSNAP"); echo "${s1:-no box reading}" > "$dir/box-end.txt"

dr=$(for f in "$dir"/down?.txt; do mbit < "$f"; done)
ur=$(for f in "$dir"/up?.txt; do mbit < "$f"; done)
set -- ${s0:-- - - - - - - -}; ver=$1 pon=$2 rx=$3; c0="$5/$6/$7/$8"
set -- ${s1:-- - - - - - - -}; c1="$5/$6/$7/$8"
idle=$(cat "$dir/box-idle.txt" 2>/dev/null); idle=${idle:--}
line=$(printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s' "$label-$stamp" "$ver" "$pon" "$rx" \
	"$(echo "$dr" | median)" "$(echo "$ur" | median)" "$(echo $dr | tr ' ' /)" "$(echo $ur | tr ' ' /)" \
	"$(echo $pi | tr ' ' /)" "$(echo $pl | tr ' ' /)" "$idle" "$c0" "$c1" "$DOWN_URL")
echo "$line" >> "$RES/results.tsv"
echo "$line" > "$dir/summary.tsv"
echo "== done. median down/up: $(echo "$dr" | median)/$(echo "$ur" | median) Mbit/s, ping idle/load (median/worst ms): $pi / $pl"
echo "   counters are hec_uncorrectable/bip/lof/crc. 'sh $0 report' compares all runs."
