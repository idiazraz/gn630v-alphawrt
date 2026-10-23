# Skyworth GN630V: hardware and the vendor boot chain

Everything here was read from a GN630V over UART, from its own flash, and from the stock firmware. Unit-specific values (MAC, serials, passwords) are deliberately left out.

## Board
| | |
|---|---|
| SoC | Airoha / EcoNet **AN7529CT**, EN7523 family. U-Boot prints `EN7529CT` |
| CPU | 2x Cortex-A53 (`410fd034`) in **AArch32**: the vendor ATF/U-Boot hands over in 32-bit mode |
| RAM | 512 MB DDR |
| Flash | 256 MiB SPI-NAND, FORESEE **F35SQB002G** (ID `cd 52`), 2048+128 B pages, 128 KiB blocks, vendor BMT (pool 163 blocks at the top) |
| Wi-Fi | MediaTek MT7916 (PCIe `14c3:7906` + `14c3:790a`), DBDC 2.4/5 GHz, NPU RX offload in stock |
| Switch | internal MT7530 (MMIO), 4x GbE |
| PON | EN7571-class xPON, EN7570 laser driver (stock calibration files `gpon_bob.conf`, `7570_bob.conf`) |
| UART | 115200 8N1, 3.3 V |

## Flash map (stock)
| Region | Offset | Size | Notes |
|---|---|---|---|
| bootloader | 0x0 | 0x80000 | U-Boot (LZMA at 0x24c00, TEXT_BASE 0x81e00000). **Env at 0x7c000, 16 KiB**: CRC32 LE + `key=value\0` |
| romfile | 0x80000 | 0x40000 | stock config, gzip of `ctromfile.cfg` |
| tclinux (bank A) | 0xc0000 | 32 MiB | |
| tclinux_slave (bank B) | 0x20c0000 | 32 MiB | |
| config | 0x40c0000 | 8 MiB | stock data |
| ubifs | 0x48c0000 | 32 MiB | stock data |
| teapot | 0x68c0000 | 5 MiB | stock data |
| (unused) | 0x6dc0000 | 112 MiB | erased on the units we've looked at |
| reservearea | 0xddc0000 | 0x240000 | MT7916 EEPROM at +0x4c000, config backup at +0x80000, factory identity record at +0x140000, **bootflag at +0x200000** |
| BMT/BBT | 0xeba0000 | to the end | vendor bad-block tables (`RAWB`, `BMT`) |

## Bank image format (HDR2)
Every bank starts with a 256-byte **HDR2** header (little-endian), the same format OpenWrt's EcoNet target writes with `tclinux-trx.sh`:

| Offset | Field |
|---|---|
| 0x00 | magic `HDR2` |
| 0x04 | header length (0x100) |
| 0x08 | total length including the header |
| 0x0c | CRC-32/JAMCRC (bit-inverted CRC-32) of bytes [0x100, total) |
| 0x10 | version, newline-terminated |
| 0x30 | customer version, newline-terminated (**must not be empty**, see below) |
| 0x50 | kernel length |
| 0x54 | rootfs length |
| 0x5c | model, `EN7523,GN630` |
| 0x7c | load address (0 in stock) |

The FIT follows at 0x100. Stock puts kernel, FDT and squashfs rootfs inside it.

## How U-Boot boots a bank
- The bootflag (one ASCII byte, `0` = A, `1` = B; erased counts as A) picks the bank. `bootflag read|swap` exists at the U-Boot prompt.
- `get_tclinux_imginfo()` reads **only the first 0x800 bytes** of the FIT at bank+0x100. It looks up `/images/fdt@1`, `kernel@1` and `filesystem@1` **by name**, reads them to 0x81800000 and runs `bootm`, which verifies the sha1 hashes.
- If the bank fails to parse, U-Boot writes the other bank to the bootflag and boots it. That's the automatic fallback.
- It passes `root=/dev/mtdblock3` for bank A and `root=/dev/mtdblock6` for bank B (stock's partition numbering), plus `bootflag=N` and the env values.
- The U-Boot shell is behind a `UserName:`/`Password:` prompt, checked against the env `username`/`password`.
- **U-Boot TFTP:** a single large transfer stalls, so use 32 KiB chunks. After about 265 transfers in one session the Ethernet driver runs out of descriptors and needs a reset.

## Stock web UI firmware upgrade
- The page only accepts file names containing `tclinux` (and not `tclinux_allinone`).
- `image_check_tc()` checks the HDR2 magic, total length against the partition size, the CRC, and the model (`sscanf("%[^,],%s")`, then `EN7523` / `GN630`). `blapi_system_secure_trx/upgrade` are empty stubs: **there is no signature check**.
- The mesh path `save_image_to_ubifs()` copies the customer version with `strncpy(dst, v, strlen(v) - 1)`, so an empty field underflows and crashes `cfg.svc`.
- The target is the **inactive** bank: running A writes `tclinux_slave`, running B writes `tclinux`. It writes with the vendor `mtd`, sets the bootflag to the new bank and reboots.

## AlphaWRT layout
Each bank: 6 MiB HDR2 + FIT (fdt@1, kernel@1, stub filesystem@1), then 16 MiB squashfs, then a 10 MiB UBI overlay (`rootfs_data`). The kernel's partition table lists bank A's three partitions as mtd2-4 and bank B's as mtd5-7, so U-Boot's own `root=` always names the right squashfs. Software only writes the bank it booted from.
