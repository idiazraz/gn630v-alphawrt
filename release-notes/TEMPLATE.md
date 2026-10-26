# AlphaWRT <version>

- **Channel:** <Test pre-release | Release>
- **Target:** Skyworth GN630V AX3000 (Airoha EN7523 / AN7529CT)
- **Build:** OpenWrt <r…+…-hash>, built by `build.sh` from `config/gn630v.config` and `config/feeds.conf` at this tag, on <GitHub Actions run link | local machine>
- **Acceptance:** <Build verification only | Partly HIL verified | HIL verified>, see "Hardware acceptance"

> **Do not flash the 2.5G GN630V.** This build supports only the AX3000 GN630V. The 2.5G variant is untested and may be incompatible. Check the full model marking on the label.

<One paragraph: what this release is for, in plain words.>

## Downloads
- `*-tclinux-factory.bin`: first install, from the stock firmware web UI. Keep `tclinux` in the file name.
- `*-sysupgrade.bin`: upgrade a running AlphaWRT. Never sysupgrade the stock firmware.
- `*-initramfs-kernel.bin`: RAM boot over U-Boot TFTP, for recovery and backups ([INSTALL.md](https://github.com/idiazraz/gn630v-alphawrt/blob/<tag>/docs/INSTALL.md)).
- `SHA256SUMS`: check the file before flashing.
- `*.manifest`: the package list of this build.

The stock firmware stays in the other flash bank, so you can always switch back. Read the [recovery guide](https://github.com/idiazraz/gn630v-alphawrt/blob/<tag>/docs/RECOVERY.md) before flashing.

## What's new since <previous>
- <change, in user terms>

## Hardware acceptance
Rows from [ACCEPTANCE.md](https://github.com/idiazraz/gn630v-alphawrt/blob/<tag>/docs/ACCEPTANCE.md), run on one AX3000 unit on <ISP, OLT vendor>:

| Row | Check | Result | Date |
|---|---|---|---|
| A1 | Cold boot ×20 | | |
| A2 | 4 LAN ports at 1 Gbps | | |
| A3 | Wi-Fi 2.4 GHz | | |
| A4 | Wi-Fi 5 GHz | | |
| A5 | sysupgrade forward | | |
| A6 | sysupgrade back | | |
| A7 | Factory reset (software) | | |
| A8 | Factory reset (button) | | |
| A9 | Power loss during sysupgrade | | |
| A10 | 24 h soak | | |
| A11 | Revert to stock | | |
| A12 | PON link | | |
| A13 | Internet over fibre | | |
| A14 | Fresh install from stock | | |

Rows not run or failed are listed under "Known issues".

## Reproducibility
<Pick one and fill it in:>
- **Checked:** two CI builds of this tag (`build` workflow with "repro", run <link>) gave identical `SHA256SUMS`.
- **Not checked for this tag.** What is known: `build.sh` pins the tree, the patches, the feeds and the commit dates, so the revision and `SOURCE_DATE_EPOCH` are the same on every machine. The images contain no build path, user or host name, and every timestamp in them comes from `SOURCE_DATE_EPOCH`. Two builds still differ in `/etc/apk/keys/public-key.pem`: OpenWrt makes a new package-signing key per build tree, so the rootfs and image checksums differ unless both builds use the same key.

Builds from different machines also differ in the key, so a local build and a CI build of the same tag don't have the same checksums.

## Known issues and test limits
- <issue>
- **Acceptance rows not run:** <rows>

## Credits
AlphaWRT builds on **Sirherobrine23**'s EN7523 OpenWrt tree ([openwrt/openwrt#20104](https://github.com/openwrt/openwrt/pull/20104)), with its open xPON driver, EN7571 optics and OMCI stack. The full credits are in the [README](https://github.com/idiazraz/gn630v-alphawrt#credits).

## Source and licensing
Source and build instructions are in this repository at the matching tag. AlphaWRT project code is GPL-2.0-only; the LuCI theme is Apache-2.0. OpenWrt and other bundled components keep their own licenses: see `LICENSE` and the component metadata.

No stock firmware, flash dumps, per-device credentials or user network configuration are included.
