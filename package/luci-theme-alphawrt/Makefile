#
# LuCI AlphaWRT theme. Component styles derived from luci-theme-bootstrap.
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=AlphaWRT Theme (default)
LUCI_DEPENDS:=+luci-base

PKG_LICENSE:=Apache-2.0

# csstidy rewrites modern CSS (color-mix(), :has(), nested @supports/@media)
# into invalid rules, so ship the stylesheet as written.
LUCI_MINIFY_CSS:=0

define Package/luci-theme-alphawrt/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.AlphaWRT
	uci -q delete luci.themes.AlphaWRTDark
	uci -q delete luci.themes.AlphaWRTLight
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/alphawrt*) uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
