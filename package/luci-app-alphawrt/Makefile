#
# AlphaWRT Quick Setup: GPON identity, ISP presets, Internet and Wi-Fi in
# one page, plus a PON card on Status > Overview.
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=AlphaWRT Quick Setup
LUCI_DEPENDS:=+luci-base +omci-agent
LUCI_PKGARCH:=all

PKG_LICENSE:=GPL-2.0-only

define Package/luci-app-alphawrt/conffiles
/etc/config/alphawrt
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
