#!/bin/sh
# Alternating explicit-TXBF on/off A/B on the 5 GHz AP, while a client keeps a
# downlink running (tools/txbf_load.html). Each round switches the AP's VHT
# SU/MU beamformer off and on with uci + wifi reload, waits for the client to
# rejoin, then measures a window from the mt76 tx_stats and the station's counters.
# Restores the default (beamformer on) when it exits.
# Usage: sh tools/txbf_ab.sh STA_MAC [rounds] [seconds] [host]   > results.csv
set -eu
STA=$1
R=${2:-3}
T=${3:-30}
HOST=${4:-root@192.168.1.1}
PHY=phy1 IF=phy1-ap0 RADIO=radio1   # 5 GHz on the GN630V
r() { ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$HOST" "$@"; }

# one line: ebf_ppdu feedback tx_bytes tx_packets tx_retries signal
snap() {
	r "awk '/applied PPDU/{gsub(/,/,\"\");e=\$NF} /Rx feedback/{gsub(/,/,\"\");f=\$7} END{printf \"%s %s \",e,f}' /sys/kernel/debug/ieee80211/$PHY/mt76/tx_stats;
	   iw dev $IF station get $STA | awk '/tx bytes/{b=\$3} /tx packets/{p=\$3} /tx retries/{r=\$3} /^\tsignal:/{s=\$2} END{print b,p,r,s}'"
}

set_bf() { # on|off
	if [ "$1" = on ]; then
		r "uci -q delete wireless.$RADIO.su_beamformer; uci -q delete wireless.$RADIO.mu_beamformer; uci commit wireless; wifi reload"
	else
		r "uci set wireless.$RADIO.su_beamformer=0; uci set wireless.$RADIO.mu_beamformer=0; uci commit wireless; wifi reload"
	fi
	# the client rejoins, then the load page needs a moment to pull again
	for i in $(seq 40); do sleep 3; r "iw dev $IF station get $STA" >/dev/null 2>&1 && break; done
	sleep 10
}

trap 'set_bf on' EXIT
echo "time,mode,secs,signal_dbm,ebf_ppdu,feedback,mbit_s,packets,retry_pct"
for i in $(seq "$R"); do
	for m in on off; do
		set_bf "$m"
		a=$(snap)
		sleep "$T"
		b=$(snap)
		echo "$a $b" | awk -v m="$m" -v t="$T" -v ts="$(date +%H:%M:%S)" '{
			db=$9-$3; dp=$10-$4; dr=$11-$5
			printf "%s,%s,%d,%s,%d,%d,%.1f,%d,%.1f\n", ts, m, t, $12, $7-$1, $8-$2, db*8/t/1e6, dp, (dp ? 100*dr/dp : 0) }'
	done
done
