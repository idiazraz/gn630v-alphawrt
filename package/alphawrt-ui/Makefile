#
# AlphaWRT Simple UI: the everyday pages at http://<box>/, with LuCI kept as
# Advanced at /cgi-bin/luci/. Static HTML, ES modules and one CSS file built
# ahead of time by ui/build.sh (the compiled root/www/alphawrt/ui.css is
# committed, so the build needs nothing new). See SIMPLE-UI.md.
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=alphawrt-ui
PKG_VERSION:=0.3.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/alphawrt-ui
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=AlphaWRT Simple UI
  DEPENDS:=+luci-app-alphawrt +rpcd +uhttpd +uhttpd-mod-ubus
  PKGARCH:=all
endef

define Package/alphawrt-ui/description
  Phone-first everyday pages (Home, Wi-Fi, Devices, Fibre, System, VPN,
  Quick Setup) on top of the AlphaWRT rpcd backend, sharing LuCI's login.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/alphawrt-ui/install
	$(CP) ./root/* $(1)/
endef

define Package/alphawrt-ui/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || { cp /www/alphawrt/index.html /www/index.html; /etc/init.d/rpcd reload; }
endef

$(eval $(call BuildPackage,alphawrt-ui))
