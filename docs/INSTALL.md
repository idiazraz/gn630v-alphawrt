# Installing AlphaWRT

> **Do not flash this firmware on the 2.5G GN630V.** This build is for the AX3000 GN630V variant only. The 2.5G variant is untested and may be incompatible. Verify the full model/variant marking on the device label; do not guess from appearance.

Choose the image for the firmware currently running: **factory** is only for the stock web UI; **sysupgrade** is only for a running AlphaWRT system. Never use `sysupgrade` on stock firmware.

## The easy way: stock web UI
1. Connect a computer to a LAN port and open the stock web UI.
2. System → Upgrade, choose the **firmware** type, select `*-squashfs-tclinux-factory.bin` (keep `tclinux` in the file name) and start.
3. Stock writes AlphaWRT into the **inactive** bank, switches to it and reboots. The first boot sets up the overlay.
4. AlphaWRT is at http://192.168.1.1, user `root`, no password until you set one.

Stock stays in the other bank. Preserve that stock bank as your rollback path. To go back: `alphawrt-bootbank stock`, then `reboot`.

## The developer way: UART + U-Boot (with a full backup)
Use this if you want a complete flash backup first (recommended), or the stock web UI isn't available.

1. **Get to `ECNT>`** (see [RECOVERY.md](RECOVERY.md)).
2. **RAM-boot the initramfs** with `tools/tftp_chunk_boot.py`. Nothing is written.
3. **Back up all of flash** from the RAM boot:
   ```sh
   sh tools/dump_mtd.sh backup/stock        # every partition, SHA-256 checked against the board
   ```
   Keep it somewhere safe and private: it holds your unit's calibration, identity and credentials.
4. Optionally run `tools/uboot_rehearsal.py` against the dump (non-destructive).
5. **Install** from the RAM boot, into bank A:
   ```sh
   scp -O openwrt-airoha-en7523-skyworth_gn630v-squashfs-sysupgrade.bin root@192.168.1.1:/tmp/fw.bin
   ssh root@192.168.1.1 'sysupgrade -n /tmp/fw.bin'
   ```
   A RAM boot has no bank of its own, so sysupgrade installs to bank A and points the bootflag at it.
6. Watch the console: `bootflag==0 --> booting from Main Image`, `kernel@1 ... sha1+ OK`, then AlphaWRT. On the first boot `mount_root: switching to ubifs overlay`.

## Updating
From AlphaWRT: LuCI → System → Backup / Flash Firmware with `*-squashfs-sysupgrade.bin`, or `sysupgrade`. The running bank is upgraded in place; the other bank is never touched.

## Checking an image before flashing
```sh
python3 -I tools/check_tclinux.py <image>        # the checks U-Boot and the stock web UI do
```
