#!/bin/sh
# Development loop: copy the Simple UI onto a box's overlay over SSH (wiped by
# the next sysupgrade). ui/deploy.sh [ssh-host], default gn630v.
set -eu
cd "$(dirname "$0")/../root"
COPYFILE_DISABLE=1 tar --no-xattrs -czf - --exclude '._*' --exclude .DS_Store www/alphawrt usr/share/rpcd/acl.d/alphawrt-ui.json |
	ssh "${1:-gn630v}" 'tar xzf - -C / && rm -f /www/alphawrt/._* /www/alphawrt/*/._* && chown -R root:root /www/alphawrt &&
		cp /www/alphawrt/index.html /www/index.html && /etc/init.d/rpcd reload && echo deployed'
