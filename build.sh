#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Build AlphaWRT for the Skyworth GN630V: OpenWrt at a pinned commit plus the
# patches in patches/. Needs the OpenWrt build prerequisites and a
# case-sensitive filesystem (see README.md).
#
#   ./build.sh [openwrt-dir]      default: ./openwrt
#
# Images end up in <openwrt-dir>/bin/targets/airoha/en7523/:
#   *-squashfs-tclinux-factory.bin   install from the stock web UI
#   *-squashfs-sysupgrade.bin        upgrade from AlphaWRT
#   *-initramfs-kernel.bin           RAM boot over U-Boot TFTP (docs/INSTALL.md)
set -eu

BASE=7287a40ccf2d0b17508c68c0c0bd5ac8ac9aa74a
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=${1:-openwrt}

[ -d "$DIR/.git" ] || git clone https://github.com/openwrt/openwrt.git "$DIR"
cd "$DIR"
git checkout -q -B alphawrt "$BASE"
git am -q "$HERE"/patches/*.patch

{ cat feeds.conf.default; echo "src-link alphawrt $HERE/package"; } > feeds.conf
./scripts/feeds update -a
./scripts/feeds install luci dnsproxy luci-theme-alphawrt

cp "$HERE/config/gn630v.config" .config
make defconfig
make -j"$(getconf _NPROCESSORS_ONLN)"
