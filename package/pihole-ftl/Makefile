#
# Pi-hole FTL (DNS + API + web server) for AlphaWRT.
#
# Upstream's armv7 release is hard-float and 25 MiB; this box runs a
# soft-float musl userland, so FTL is built here.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=pihole-ftl
PKG_VERSION:=6.8
PKG_RELEASE:=1

PKG_SOURCE:=FTL-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/pi-hole/FTL/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=93c237c43781e04e1f881536a81e65a3c9d32e052a6e61b4b3f70863d8c6c86b
PKG_BUILD_DIR:=$(BUILD_DIR)/FTL-$(PKG_VERSION)

PKG_LICENSE:=EUPL-1.2
PKG_LICENSE_FILES:=LICENSE
PKG_BUILD_DEPENDS:=gmp nettle libunistring

# Note: the static gmp/unistring archives aren't PIC and musl can't load
# a PIE with text relocations (it segfaults before main), so no PIE.
PKG_ASLR_PIE:=0

IDN2_VERSION:=2.3.8
IDN2_SOURCE:=libidn2-$(IDN2_VERSION).tar.gz

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/cmake.mk

# libidn2's feed package ships no static archive; build one for FTL only.
define Download/libidn2
  FILE:=$(IDN2_SOURCE)
  URL:=@GNU/libidn
  HASH:=f557911bf6171621e1f72ff35f5b1825bb35b52ed45325dcdee931e5d3c0787a
endef
$(eval $(call Download,libidn2))

# OpenWrt's host xxd (first in PATH) is a perl stub without -C/-n/-r; FTL
# needs vim's xxd (Ubuntu: package xxd).
XXD:=/usr/bin/xxd
IDN2_DIR:=$(PKG_BUILD_DIR)/libidn2-$(IDN2_VERSION)
STAGING_LIB:=$(STAGING_DIR)/usr/lib

define Package/pihole-ftl
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Pi-hole FTL (DNS, API and web server)
  URL:=https://pi-hole.net/
  DEPENDS:=+libpthread +librt
  USERID:=pihole=999:pihole=999
endef

define Package/pihole-ftl/description
  Pi-hole's FTL engine: a dnsmasq-based DNS server with blocklists
  (gravity), a REST API and the web server for the Pi-hole admin pages.
endef

TARGET_CFLAGS += -I$(IDN2_DIR)/lib

CMAKE_OPTIONS += \
	-DCMAKE_BUILD_TYPE=MinSizeRel \
	-DRESOURCE_COMPILER=$(XXD) \
	-DUSE_CONNTRACK=OFF -DUSE_NFTSET=OFF -DUSE_DBUS=OFF -DUSE_READLINE=OFF \
	-DUSE_MBED_TLS=OFF \
	-DLIBGMP=$(STAGING_LIB)/libgmp.a \
	-DLIBNETTLE=$(STAGING_LIB)/libnettle.a \
	-DLIBHOGWEED=$(STAGING_LIB)/libhogweed.a \
	-DLIBUNISTRING=$(STAGING_LIB)/libunistring.a \
	-DLIBIDN2=$(IDN2_DIR)/lib/.libs/libidn2.a \
	-DCMAKE_EXE_LINKER_FLAGS='-Wl,--gc-sections -no-pie'

# FTL takes its version from these instead of git
export GIT_BRANCH:=master
export GIT_HASH:=v$(PKG_VERSION)
export GIT_VERSION:=v$(PKG_VERSION)
export GIT_TAG:=v$(PKG_VERSION)
export GIT_DATE:=2026-10-17
export CI_ARCH:=$(ARCH)

# - -Werror trips on notes that only -Os gives (inlining, stack protector)
# - the checksum mark step calls xxd -r from PATH
# - -pie/-fPIE are hard-coded (see PKG_ASLR_PIE)
define Build/Prepare
	$(call Build/Prepare/Default)
	$(TAR) -C $(PKG_BUILD_DIR) -xzf $(DL_DIR)/$(IDN2_SOURCE)
	sed -i -e 's/-Werror\b//g' -e 's#| xxd -r -p#| $(XXD) -r -p#' \
		-e 's/ -pie -fPIE//' $(PKG_BUILD_DIR)/src/CMakeLists.txt
endef

define Build/Configure
	cd $(IDN2_DIR) && $(TARGET_CONFIGURE_OPTS) CFLAGS="$(TARGET_CFLAGS)" \
		CPPFLAGS="$(TARGET_CPPFLAGS)" LDFLAGS="$(TARGET_LDFLAGS)" \
		./configure --host=$(GNU_TARGET_NAME) --build=$(GNU_HOST_NAME) \
		--enable-static --disable-shared --disable-doc --disable-nls \
		--without-libiconv-prefix --with-libunistring-prefix=$(STAGING_DIR)/usr
	$(MAKE) -C $(IDN2_DIR)/gl
	$(MAKE) -C $(IDN2_DIR)/unistring
	$(MAKE) -C $(IDN2_DIR)/lib
	$(call Build/Configure/Default)
endef

define Package/pihole-ftl/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/pihole-FTL $(1)/usr/bin/
endef

$(eval $(call BuildPackage,pihole-ftl))
