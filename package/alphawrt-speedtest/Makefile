#
# AlphaWRT speed test: download, upload, ping and jitter from the box itself
# against Speedtest.net (Ookla) servers, for the Simple UI's Speed test page.
# Our own client (src/speedtest.c) speaking the servers' TCP test protocol;
# Ookla's CLI isn't used, since its licence doesn't allow routers.
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=alphawrt-speedtest
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/alphawrt-speedtest
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Internet speed test for AlphaWRT
  DEPENDS:=+uclient-fetch +ca-bundle +rpcd-mod-ucode +ucode-mod-fs
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_CPPFLAGS) -std=gnu11 -Wall \
		-o $(PKG_BUILD_DIR)/alphawrt-speedtest ./src/speedtest.c $(TARGET_LDFLAGS)
endef

define Package/alphawrt-speedtest/install
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/alphawrt-speedtest $(1)/usr/bin/
endef

$(eval $(call BuildPackage,alphawrt-speedtest))
