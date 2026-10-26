# End PPPoE sessions properly before a sysupgrade. Stage2 sends TERM to
# netifd, and netifd SIGKILLs its pppd, so the ISP never hears the session
# end (no LCP Terminate, no PADT). TIME allows one session per account and
# holds the dead one for minutes, so the new image's login is refused
# ("You are already logged in") until it times out. A reboot already does
# this (K90network: ifdown -a); stage2 runs no K scripts.
# Runs as stage2 includes /lib/upgrade, before it stops the services.
if [ "${0##*/}" = stage2 ]; then
	for i in $(ubus call network.interface dump 2>/dev/null |
		jsonfilter -e '@.interface[@.proto="pppoe"].interface'); do
		ifdown "$i"
	done
	# pppd waits for the LCP Terminate-Ack before its PADT; a few ms on TIME
	n=0
	while pidof pppd >/dev/null && [ $n -lt 5 ]; do
		sleep 1
		n=$((n + 1))
	done
fi
