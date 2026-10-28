#
# AlphaWRT backend (rpcd, ACLs, line monitor) and the Advanced pages: Fibre
# diagnostics, CPU and memory, PON and CPU cards on Status > Overview, and
# redirects from the old Basic and Quick Setup pages to the Simple UI.
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=AlphaWRT backend and Advanced pages
LUCI_DEPENDS:=+luci-base +omci-agent
LUCI_PKGARCH:=all

PKG_LICENSE:=GPL-2.0-only

define Package/luci-app-alphawrt/conffiles
/etc/config/alphawrt
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
