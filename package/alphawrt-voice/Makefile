#
# AlphaWRT phone line: the TEL (FXS) port as a SIP phone through baresip,
# set up from the Simple UI's Phone page. Only for boards with an FXS port
# (GN630V, SK-G7220). The FXS driver (airoha_voip with the ProSLIC API) is
# proprietary and isn't in this repo: build.sh adds it when the local copy
# is present. Without it the page says the port isn't ready.
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=alphawrt-voice
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only
PKG_BUILD_DEPENDS:=baresip

include $(INCLUDE_DIR)/package.mk

define Package/alphawrt-voice
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Phone line (SIP on the TEL port) for AlphaWRT
  DEPENDS:=+baresip +baresip-mod-g711 +baresip-mod-ctrl_tcp +rpcd-mod-ucode +ucode-mod-socket
endef

define Package/alphawrt-voice/conffiles
/etc/config/voice
endef

# fxs.so: the TEL port as baresip's audio and hook device (src/fxs.c)
define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_CPPFLAGS) -std=gnu11 -fPIC -shared \
		-DHAVE_THREADS -DHAVE_ATOMIC -I$(STAGING_DIR)/usr/include/re -I./src \
		-o $(PKG_BUILD_DIR)/fxs.so ./src/fxs.c $(TARGET_LDFLAGS)
endef

define Package/alphawrt-voice/install
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/usr/lib/baresip/modules
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/fxs.so $(1)/usr/lib/baresip/modules/
endef

$(eval $(call BuildPackage,alphawrt-voice))
