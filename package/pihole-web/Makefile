#
# Pi-hole web admin pages (served by pihole-FTL) for AlphaWRT.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=pihole-web
PKG_VERSION:=6.6.1
PKG_RELEASE:=1

PKG_SOURCE:=web-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/pi-hole/web/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=34d82b58a0b601803769e66c0f3e1d8bd06513449625e38e07afa007399284d9
PKG_BUILD_DIR:=$(BUILD_DIR)/web-$(PKG_VERSION)

PKG_LICENSE:=EUPL-1.2
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/pihole-web
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Pi-hole web admin
  URL:=https://pi-hole.net/
  DEPENDS:=+pihole-ftl
  PKGARCH:=all
endef

define Build/Compile
endef

# Trimmed for flash: no source maps, no npm/CI files, and only the woff2
# fonts (every browser the admin supports loads woff2 first).
define Package/pihole-web/install
	$(INSTALL_DIR) $(1)/usr/share/pihole/www/admin
	$(TAR) -C $(PKG_BUILD_DIR) --exclude='./ipkg-*' --exclude='./.*' -cf - . | \
		$(TAR) -C $(1)/usr/share/pihole/www/admin -xf -
	cd $(1)/usr/share/pihole/www/admin && rm -rf test \
		package.json package-lock.json postcss.config.js *.md && \
		find . \( -name '*.map' -o -name '*.eot' -o -name '*.ttf' \
			-o -name '*.woff' -o -name '*.svg' -path '*fonts*' \) -delete
endef

$(eval $(call BuildPackage,pihole-web))
