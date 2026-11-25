#
# AlphaWRT flood protection for port forwards: fw4's syn_flood limit only
# guards the box itself, so SYNs to a port forward reach the LAN server.
# This answers them with syncookies on the box (nft synproxy) when a flood
# starts, or always, and passes only completed handshakes to the server.
# Settings in uci alphawrt.synproxy, rpcd status for the Simple UI's
# Network page, details in /usr/libexec/alphawrt/synproxy.
#
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=alphawrt-synproxy
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/alphawrt-synproxy
  SECTION:=net
  CATEGORY:=Network
  TITLE:=SYN flood protection for port forwards
  DEPENDS:=+firewall4 +kmod-nft-synproxy +rpcd +jsonfilter
  PKGARCH:=all
endef

define Package/alphawrt-synproxy/description
  Keeps SYN floods against port forwards on the router: new connections
  to a forwarded TCP port are answered with syncookies (nft synproxy)
  during a flood, or always, and only clients that complete the handshake
  reach the LAN server.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/alphawrt-synproxy/install
	$(CP) ./root/* $(1)/
endef

define Package/alphawrt-synproxy/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || { /etc/init.d/rpcd reload; fw4 -q reload; }
endef

$(eval $(call BuildPackage,alphawrt-synproxy))
