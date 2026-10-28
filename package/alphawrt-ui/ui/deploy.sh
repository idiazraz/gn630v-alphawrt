#!/bin/sh
# Development loop: copy the Simple UI onto a box's overlay over SSH (wiped by
# the next sysupgrade). ui/deploy.sh [ssh-host], default gn630v.
#
# Standalone command to deploy the Wi-Fi backend and ACL if deploying separately:
#   tar -C repo/alphawrt/package/luci-app-alphawrt/root -czf - \
#     usr/libexec/rpcd/alphawrt.wifi usr/share/rpcd/acl.d/alphawrt-wifi.json | \
#     ssh gn630v 'tar xzf - -C / && chmod 755 /usr/libexec/rpcd/alphawrt.wifi && /etc/init.d/rpcd reload'
set -eu
cd "$(dirname "$0")/../root"

# one session on the board at a time (WORKLOG.md claims): refuse while someone else holds a GN630V claim
LOG="$PWD/../../../../../WORKLOG.md"
[ -f "$LOG" ] || { echo "deploy.sh: can't find WORKLOG.md at $LOG, not deploying" >&2; exit 1; }
if true && sed -n '/^## In progress/,/^## [0-9]/p' "$LOG" | grep -i '^- \*\*GN630V' | grep -qvE 'WS1|Kraze'; then
	echo "deploy.sh: someone else holds the GN630V in WORKLOG.md, not deploying:" >&2
	sed -n '/^## In progress/,/^## [0-9]/p' "$LOG" | grep -i '^- \*\*GN630V' | grep -vE 'WS1|Kraze' | cut -c1-160 >&2
	exit 1
fi

HOST="${1:-gn630v}"
LUCI_ROOT="../../luci-app-alphawrt/root"
PIHOLE_ROOT="../../alphawrt-pihole/root"

set -- www/alphawrt usr/libexec/alphawrt-ui usr/share/rpcd/acl.d/alphawrt-ui.json
if [ -f "$LUCI_ROOT/usr/libexec/rpcd/alphawrt.wifi" ]; then
	set -- "$@" -C "$LUCI_ROOT" usr/libexec/rpcd/alphawrt.wifi
fi
if [ -f "$LUCI_ROOT/usr/share/rpcd/acl.d/alphawrt-wifi.json" ]; then
	set -- "$@" -C "$LUCI_ROOT" usr/share/rpcd/acl.d/alphawrt-wifi.json
fi
if [ -f "$LUCI_ROOT/usr/libexec/rpcd/alphawrt-homelab" ]; then
	set -- "$@" -C "$LUCI_ROOT" usr/libexec/rpcd/alphawrt-homelab
fi
if [ -f "$LUCI_ROOT/usr/share/rpcd/acl.d/alphawrt-homelab.json" ]; then
	set -- "$@" -C "$LUCI_ROOT" usr/share/rpcd/acl.d/alphawrt-homelab.json
fi
if [ -d "$PIHOLE_ROOT" ]; then
	set -- "$@" -C "$PIHOLE_ROOT" usr/share/rpcd/ucode/alphawrt-pihole.uc usr/share/rpcd/acl.d/alphawrt-pihole.json usr/local/bin/pihole usr/share/pihole
fi

COPYFILE_DISABLE=1 tar --no-xattrs -czf - --exclude '._*' --exclude .DS_Store "$@" |
	ssh "$HOST" 'tar xzf - -C / && rm -f /www/._alphawrt /www/alphawrt/._* /www/alphawrt/*/._* /usr/libexec/._alphawrt-ui /usr/libexec/rpcd/._alphawrt.wifi /usr/share/rpcd/acl.d/._alphawrt-wifi.json /usr/share/rpcd/acl.d/._alphawrt-ui.json /usr/share/rpcd/acl.d/._alphawrt-pihole.json /usr/share/rpcd/ucode/._alphawrt-pihole.uc && chown -R root:root /www/alphawrt /usr/libexec/alphawrt-ui && chmod 755 /usr/libexec/alphawrt-ui/flash && ([ ! -f /usr/libexec/rpcd/alphawrt.wifi ] || (chown root:root /usr/libexec/rpcd/alphawrt.wifi && chmod 755 /usr/libexec/rpcd/alphawrt.wifi)) && ([ ! -f /usr/libexec/rpcd/alphawrt-homelab ] || (chown root:root /usr/libexec/rpcd/alphawrt-homelab && chmod 755 /usr/libexec/rpcd/alphawrt-homelab)) && ([ ! -f /usr/share/rpcd/acl.d/alphawrt-wifi.json ] || chown root:root /usr/share/rpcd/acl.d/alphawrt-wifi.json) && ([ ! -f /usr/share/rpcd/acl.d/alphawrt-homelab.json ] || chown root:root /usr/share/rpcd/acl.d/alphawrt-homelab.json) && ([ ! -f /usr/local/bin/pihole ] || (chown root:root /usr/local/bin/pihole && chmod 755 /usr/local/bin/pihole)) &&
		cp /www/alphawrt/index.html /www/index.html && /etc/init.d/rpcd reload && echo deployed'
