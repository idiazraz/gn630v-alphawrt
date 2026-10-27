# AlphaWRT for the Skyworth GN630V

OpenWrt for the Skyworth GN630V GPON ONT (AX3000), an Airoha **AN7529CT** (EN7523 family) box. It runs a current OpenWrt kernel (6.18) and LuCI, installs from the **stock web UI**, and keeps the stock firmware in the second flash bank so you can always go back.

> **Hardware restriction: Do not flash this firmware on the 2.5G GN630V.** Only the AX3000 GN630V variant is covered by this build; the 2.5G variant has not been tested and may be incompatible. Check the full model/variant marking on the device label; do not infer compatibility from appearance.

```
     ___    __      __          _      ______  ______
    /   |  / /___  / /_  ____ _| |    / / __ \/_  __/
   / /| | / / __ \/ __ \/ __ `/| | /| / / /_/ / / /
  / ___ |/ / /_/ / / / / /_/ / | |/ |/ / _, _/ / /
 /_/  |_/_/ .___/_/ /_/\__,_/  |__/|__/_/ |_| /_/
         /_/                     Skyworth GN630V | AN7529CT | Linux 6.18
```

> **Status: early test builds.** Verified on hardware: booting from either bank, the persistent overlay, the LAN switch, Wi-Fi 6 on both bands, encrypted DNS, LuCI, installing from the stock web UI, and going back to stock. GPON: the optics (EN7571, with the unit's own calibration) and the PON MAC come up and report loss of signal without fibre.
> **Test status:** GPON registration has reached O5 on a live line. Stable Internet service over fibre is still under test. Read [Recovery](docs/RECOVERY.md) before flashing.

## What you get
* **OpenWrt** (procd, ubus, LuCI, apk, dropbear, firewall4) on Linux 6.18, with a persistent UBIFS overlay.
* **Dual bank, stock kept.** AlphaWRT runs from whichever flash bank it was written to. The other bank keeps the stock firmware untouched, and nothing in AlphaWRT ever writes it. `alphawrt-bootbank stock` plus a reboot brings stock back.
* **Installs from the stock web UI.** The image is a valid stock-format (HDR2) bank image, so the stock upgrade page takes it as it is.
* **Real board support**, not a generic EN7523 build: GN630V partition map, MAC from the bootloader env, MT7916 calibration from flash, MT7530 switch, LEDs, and the FORESEE SPI-NAND driver backported from mainline.
* **Wi-Fi that keeps working.** On first boot AlphaWRT reuses the network names, passwords and country from the stock settings, now as WPA2/WPA3. Each band gets its stock MAC, and 5 GHz runs at 160 MHz.
* **Encrypted DNS by default.** dnsmasq serves the LAN and forwards to [dnsproxy](https://github.com/AdguardTeam/dnsproxy): DNS-over-QUIC and DNS-over-HTTPS (HTTP/3) upstreams, DNS-over-TLS fallback. To go back to the ISP's DNS, see the commands at the top of `/etc/uci-defaults/95_alphawrt_dns`.
* **Two web interfaces.** Switch between them with the link at the top right.
  * **Basic** (the default): Home, Wi-Fi, Devices and System pages, like the stock firmware's.
  * **Advanced**: the full OpenWrt interface (LuCI).
* **Quick Setup** (top bar, and the first page after the first login):
  * Presets come only from the project's own sources:
    * **Unifi (TM):** Internet PPPoE on VLAN 500, from this box's own stock firmware. Click **Use the identity saved by the stock firmware** if TM supplied and provisioned this GN630V.
    * **TIME:** PPPoE on VLAN 499 and a Huawei HG8145X6 ONT profile, tested on a live TIME line.
    * **Allo and others:** manual. No third-party ISP or ONT presets are bundled.
  * Once the fibre registers, Quick Setup uses the Internet VLAN the ISP's OLT provisions.
  * **Your own serial number and PLOAM password**, or the identity the stock firmware saved, plus PPPoE, Wi-Fi and the admin password.
  * A **fibre card on Status > Overview** shows the PON state and optical levels.
* **Its own LuCI theme**, `luci-theme-alphawrt`: follows the device's light/dark setting, works at phone width. Bootstrap stays installed as a fallback.

## Install
From stock firmware, use only `*-tclinux-factory.bin` through the stock web UI. Use `*-sysupgrade.bin` only when upgrading a running AlphaWRT installation. Do not sysupgrade the stock firmware. Keep `tclinux` in the factory image name: the stock page rejects anything else. Details and recovery steps are in [docs/INSTALL.md](docs/INSTALL.md).

After the reboot: http://192.168.1.1, user `root`, no password. The first login opens Quick Setup.

## Back to stock
```
ssh root@192.168.1.1
alphawrt-bootbank          # what each bank holds
alphawrt-bootbank stock
reboot
```

## Building
```sh
./build.sh            # clones OpenWrt at the pinned commit, applies patches/, builds
```
Needs the [OpenWrt build prerequisites](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem) and a case-sensitive filesystem. On macOS, use a case-sensitive APFS volume with GNU coreutils/findutils/sed/tar/grep/make ahead of the system tools. On Apple Silicon, OpenWrt can't build its own Go bootstrap, so install Go (`brew install go`) and add this to `openwrt/.config` before building:
```
CONFIG_GOLANG_EXTERNAL_BOOTSTRAP_ROOT="/opt/homebrew/opt/go/libexec"
# CONFIG_GOLANG_BUILD_BOOTSTRAP is not set
```
The output lands in `openwrt/bin/targets/airoha/en7523/`.

| Path | |
|---|---|
| `patches/` | patches on the pinned EN7523 tree: the GN630V board (dual bank, image, Wi-Fi/DNS defaults, xPON wiring) |
| `package/` | `luci-theme-alphawrt` and `luci-app-alphawrt` (Quick Setup, Basic interface), copied into the tree as `package/alphawrt/` |
| `config/gn630v.config` | build config seed |
| `config/feeds.conf` | the feed commits the build uses |
| `.github/workflows/build.yml` | Linux CI build with `build.sh`; run by hand with "repro" to build twice and compare |
| `tools/` | UART/U-Boot helpers: chunked TFTP RAM boot, TFTP server, flash dump, image checker; `budget.py` (flash budget report, run by `build.sh`); `compare-test.sh` (stock vs AlphaWRT capture) |
| `docs/` | [hardware and boot chain](docs/HARDWARE.md), [install](docs/INSTALL.md), [recovery](docs/RECOVERY.md), [ONT/ISP tester guide](docs/ONT-ISP-TESTER-GUIDE.md), [stock vs AlphaWRT testing](docs/STOCK-VS-ALPHAWRT.md), [hardware acceptance](docs/ACCEPTANCE.md), [roadmap](docs/ROADMAP.md) |

## Credits
* **Sirherobrine23**: the EN7523 OpenWrt tree AlphaWRT builds on ([Sirherobrine23/openwrt](https://github.com/Sirherobrine23/openwrt), [openwrt/openwrt#20104](https://github.com/openwrt/openwrt/pull/20104)) and the trees it collects, with the open xPON PHY/MAC, EN7571 optics and OMCI stack. AlphaWRT's fibre support is this stack plus our fixes.
* [Kiwironic/openwrt-en7523](https://github.com/Kiwironic/openwrt-en7523): the EN7523 + MT7916 board support this port started from
* [realldz/econet-42x6-openwrt](https://github.com/realldz/econet-42x6-openwrt) and [gilsonolegario/px3321-en7523-notes](https://github.com/gilsonolegario/px3321-en7523-notes): vendor U-Boot and EN7523 ONU notes
* OpenWrt's EcoNet target for `tclinux-trx.sh`, and the mainline FORESEE F35SQB002G driver
* [Anime4000's RTL960x project](https://github.com/Anime4000/RTL960x): public OMCI/xPON research that informed our background understanding of ONU identity and OLT behaviour. AlphaWRT's GPON implementation is based on the upstream EN7523 xPON stack above.

## License
GPL-2.0, like OpenWrt; `package/luci-theme-alphawrt` is Apache-2.0, like LuCI. No proprietary firmware is part of this repository: the MT7916 firmware comes from OpenWrt's mt76 package, and the NPU firmware stays on the user's own stock image.
