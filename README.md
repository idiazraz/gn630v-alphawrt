# AlphaWRT for the Skyworth GN630V

OpenWrt for the Skyworth GN630V GPON ONT (AX3000), an Airoha **AN7529CT** (EN7523 family) box. It runs a current OpenWrt kernel (6.18) and LuCI, installs from the **stock web UI**, and keeps the stock firmware in the second flash bank so you can always go back.

```
     ___    __      __          _      ______  ______
    /   |  / /___  / /_  ____ _| |    / / __ \/_  __/
   / /| | / / __ \/ __ \/ __ `/| | /| / / /_/ / / /
  / ___ |/ / /_/ / / / / /_/ / | |/ |/ / _, _/ / /
 /_/  |_/_/ .___/_/ /_/\__,_/  |__/|__/_/ |_| /_/
         /_/                     Skyworth GN630V | AN7529CT | Linux 6.18
```

> **Status: early test builds.** Verified on hardware: booting from either bank, the persistent overlay, the LAN switch, LuCI, installing from the stock web UI, and going back to stock.
> **Not yet:** GPON (no fibre internet while AlphaWRT runs) and Wi-Fi access points. Read [Recovery](docs/RECOVERY.md) before flashing.

## What you get
* **OpenWrt** (procd, ubus, LuCI, apk, dropbear, firewall4) on Linux 6.18, with a persistent UBIFS overlay.
* **Dual bank, stock kept.** AlphaWRT runs from whichever flash bank it was written to. The other bank keeps the stock firmware untouched, and nothing in AlphaWRT ever writes it. `alphawrt-bootbank stock` plus a reboot brings stock back.
* **Installs from the stock web UI.** The image is a valid stock-format (HDR2) bank image, so the stock upgrade page takes it as it is.
* **Real board support**, not a generic EN7523 build: GN630V partition map, MAC from the bootloader env, MT7916 calibration from flash, MT7530 switch, LEDs, and the FORESEE SPI-NAND driver backported from mainline.

## Install
Download `*-tclinux-factory.bin` and, on the stock web UI, go to **System → Upgrade**, choose **firmware** and flash it. Keep `tclinux` in the file name: the stock page rejects anything else. Details, and the UART/U-Boot route with a full flash backup, are in [docs/INSTALL.md](docs/INSTALL.md).

After the reboot: http://192.168.1.1, user `root`, set a password.

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
Needs the [OpenWrt build prerequisites](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem) and a case-sensitive filesystem. On macOS, use a case-sensitive APFS volume with GNU coreutils/findutils/sed/tar/grep/make ahead of the system tools. The output lands in `openwrt/bin/targets/airoha/en7523/`.

| Path | |
|---|---|
| `patches/` | OpenWrt patches: EN7523 baseline, then the GN630V board |
| `config/gn630v.config` | build config seed |
| `tools/` | UART/U-Boot helpers: chunked TFTP RAM boot, TFTP server, flash dump, image checker |
| `docs/` | [hardware and boot chain](docs/HARDWARE.md), [install](docs/INSTALL.md), [recovery](docs/RECOVERY.md), [roadmap](docs/ROADMAP.md) |

## Credits
* [Kiwironic/openwrt-en7523](https://github.com/Kiwironic/openwrt-en7523): the EN7523 + MT7916 board support this port started from
* [openwrt/openwrt#20104](https://github.com/openwrt/openwrt/pull/20104) (Sirherobrine23) and the trees it collects: EN7523 Ethernet/DSA/PCS
* [realldz/econet-42x6-openwrt](https://github.com/realldz/econet-42x6-openwrt) and [gilsonolegario/px3321-en7523-notes](https://github.com/gilsonolegario/px3321-en7523-notes): vendor U-Boot and EN7523 ONU notes
* OpenWrt's EcoNet target for `tclinux-trx.sh`, and the mainline FORESEE F35SQB002G driver

## License
GPL-2.0, like OpenWrt. No proprietary firmware is part of this repository: the MT7916 firmware comes from OpenWrt's mt76 package, and the NPU firmware stays on the user's own stock image.
