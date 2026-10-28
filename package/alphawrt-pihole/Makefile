#
# AlphaWRT glue for Pi-hole: on/off with Hagezi presets, dnsmasq hand-over,
# gravity in RAM, the `pihole` command, rpcd backend and a LuCI page.
#
# This is free software, licensed under the GNU General Public License v2.
# usr/share/pihole/*.sql are from Pi-hole (EUPL-1.2).
#

include $(TOPDIR)/rules.mk

PKG_NAME:=alphawrt-pihole
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/alphawrt-pihole
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Pi-hole for AlphaWRT (off by default)
  DEPENDS:=+pihole-ftl +rpcd-mod-ucode +uclient-fetch +ca-bundle
  PKGARCH:=all
endef

define Package/alphawrt-pihole/conffiles
/etc/config/pihole
/etc/pihole/pihole.toml
/etc/pihole/lists.db
endef

define Build/Compile
endef

define Package/alphawrt-pihole/install
	$(CP) ./root/* $(1)/
endef

$(eval $(call BuildPackage,alphawrt-pihole))
