#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Build AlphaWRT for the Skyworth GN630V: the EN7523 OpenWrt branch with the
# open GPON stack (Sirherobrine23's tree, openwrt/openwrt#20104) at a pinned
# commit, plus the patches in patches/. Needs the OpenWrt build prerequisites and a
# case-sensitive filesystem (see README.md).
#
#   ./build.sh [openwrt-dir]      default: ./openwrt
#
# Images end up in <openwrt-dir>/bin/targets/airoha/en7523/:
#   *-squashfs-tclinux-factory.bin   install from the stock web UI
#   *-squashfs-sysupgrade.bin        upgrade from AlphaWRT
#   *-initramfs-kernel.bin           RAM boot over U-Boot TFTP (docs/INSTALL.md)
set -eu

BASE=90f5ac78ddce3b9be42d16c869248d85d8eaecfd
TREE=https://github.com/Sirherobrine23/openwrt.git
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=${1:-openwrt}

[ -d "$DIR/.git" ] || git clone "$TREE" "$DIR"
cd "$DIR"
git cat-file -e "$BASE^{commit}" 2>/dev/null || git fetch -q "$TREE" "$BASE"
git checkout -q -B alphawrt "$BASE"
git am -q "$HERE"/patches/*.patch

# AlphaWRT's own packages go inside the tree (not a linked feed), so the
# images carry no path from the build machine
rm -rf package/alphawrt && cp -R "$HERE/package" package/alphawrt
./scripts/feeds update -a
./scripts/feeds install luci dnsproxy

cp "$HERE/config/gn630v.config" .config
make defconfig
make -j"$(getconf _NPROCESSORS_ONLN)"
