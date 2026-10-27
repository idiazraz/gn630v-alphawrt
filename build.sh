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
# the OpenWrt main commit BASE sits on: names the build r<main>+<ours>-<main>
MAIN=e4974473dbae690a48c9b5fe72b5adeaf26dc70b
TREE=https://github.com/Sirherobrine23/openwrt.git
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=${1:-openwrt}

[ -d "$DIR/.git" ] || git clone "$TREE" "$DIR"
cd "$DIR"
git cat-file -e "$BASE^{commit}" 2>/dev/null || git fetch -q "$TREE" "$BASE"
git checkout -q -B alphawrt "$BASE"
# Same patches give the same commits, so the same SOURCE_DATE_EPOCH (the
# last commit's date) and revision on every machine
git -c user.name=AlphaWRT -c user.email=build@alphawrt.invalid \
	am -q --committer-date-is-author-date "$HERE"/patches/*.patch
git branch -q -f openwrt-main "$MAIN"
git branch -q -u openwrt-main
git config core.abbrev 10

# AlphaWRT's own packages go inside the tree (not a linked feed), so the
# images carry no path from the build machine. They aren't in git, so they
# take the tree's date instead of the checkout time.
rm -rf package/alphawrt && cp -R "$HERE/package" package/alphawrt
for p in package/alphawrt/*/; do git log -1 --format=%ct > "$p/version.date"; done
cp "$HERE/config/feeds.conf" feeds.conf
./scripts/feeds update -a
# every feed package gn630v.config selects, or defconfig silently drops it
./scripts/feeds install luci dnsproxy luci-proto-wireguard pbr qrencode

cp "$HERE/config/gn630v.config" .config
# bridger's BPF program is built with the host clang/llc: on macOS that is
# Homebrew's llvm, which isn't on PATH (on Linux, the distribution's clang
# and llvm packages are)
if [ "$(uname)" = Darwin ]; then
	echo "CONFIG_BPF_TOOLCHAIN_HOST_PATH=\"$(brew --prefix llvm)\"" >> .config
fi
make defconfig
make -j"$(getconf _NPROCESSORS_ONLN)"
