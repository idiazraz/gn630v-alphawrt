# Recovery

How to get a GN630V back from any state where U-Boot still runs. Everything below was done on real hardware.

## Golden rules
1. **Back up first.** Before installing anything, dump all of flash from a RAM-booted AlphaWRT (see [INSTALL.md](INSTALL.md)) and keep the dump off the box. It holds your unit's Wi-Fi calibration, identity and stock config.
2. **Write flash only with U-Boot `flash erase` + `flash write`, AlphaWRT's `mtd` or sysupgrade.** Never use the stock firmware's `/userfs/bin/mtd` by hand: it parses offsets as decimal only, so a hex offset silently becomes 0.
3. **Never write the U-Boot env or the bootloader.** The env (bootloader +0x7c000) shares an erase block with U-Boot code. A bad env CRC can lock you out of the U-Boot shell.
4. **Never program a Linux dump with an external SPI programmer.** Linux dumps have no OOB/ECC bytes, so pages programmed from them fail ECC. Only a raw dump taken *with* a programmer can be written back that way.
5. Verify before and after every write (CRC32 or SHA-256).

## Getting to U-Boot
- UART: 115200 8N1, **3.3 V**. Adapter TX to board RX, adapter RX to board TX, GND to GND. Don't connect VCC.
- `picocom -b 115200 --noreset /dev/ttyUSB0`. Quit with Ctrl-A Ctrl-X; `--noreset` leaves the board at the prompt.
- Power-cycle and press Enter during `Hit any key to stop autoboot`. At `UserName:` / `Password:`, enter the values of the env `username` and `password`. Your stock kernel command line shows the same values. The prompt is `ECNT>`.
- `tools/uboot_dump.py` catches the countdown for you and stops at the login so you can log in yourself.

## Which bank boots
| Situation | What happens |
|---|---|
| bank image fails to parse | U-Boot switches the bootflag itself and boots the other bank |
| AlphaWRT runs | `alphawrt-bootbank stock` then `reboot` to boot the other (stock) bank |
| at `ECNT>` | `bootflag read`, `bootflag swap` |

The bootflag is one ASCII byte at flash 0xdfc0000 (`0` = bank A, `1` = bank B, erased = A).

## RAM-boot AlphaWRT (no flash writes)
Host on 192.168.1.126/24, cabled to a LAN port. U-Boot uses 192.168.1.1 as its own IP and 192.168.1.126 as the server.
```sh
sh tools/stage_chunks.sh openwrt-airoha-en7523-skyworth_gn630v-initramfs-kernel.bin tftp/chunks
python3 -I tools/tftpd.py --dir tftp/chunks          # keep running
python3 -I tools/tftp_chunk_boot.py tftp/chunks      # board at ECNT>, nothing else on the serial port
```
The loader `tftpboot`s 32 KiB chunks to `0x8a000000 + n*0x8000`, checks `iminfo` and runs `bootm`. Resume a failed run with `--start N`. A power-cycle returns to whatever is in flash.

Limits of the vendor U-Boot: don't `tftpboot` a whole large file (it stalls), and stay under about 265 transfers per session (a RAM boot is about 250; a whole bank would be 1024).

## Restore a bank from your dump
From a RAM-booted AlphaWRT, which has every partition of both banks:
```sh
scp -O mtd2-tclinux.bin root@192.168.1.1:/tmp/bank.bin          # your dump of the bank
ssh root@192.168.1.1
# bank A = kernel + alphawrt_rootfs + alphawrt_data (6 + 16 + 10 MiB)
dd if=/tmp/bank.bin bs=128k count=48            | mtd write - kernel
dd if=/tmp/bank.bin bs=128k skip=48  count=128  | mtd write - alphawrt_rootfs
dd if=/tmp/bank.bin bs=128k skip=176 count=80   | mtd write - alphawrt_data
cat /dev/mtd2ro /dev/mtd3ro /dev/mtd4ro | sha256sum          # must equal the dump's SHA-256
```
For bank B use `kernel_b`, `alphawrt_rootfs_b`, `alphawrt_data_b` (`/dev/mtd5ro` to `mtd7ro`). These writes bypass the vendor BMT. That's fine while there are no bad blocks: check `/sys/class/mtd/mtd*/bad_blocks` first.

## Check that U-Boot and Linux agree (non-destructive)
```sh
python3 -I tools/uboot_rehearsal.py      # ALPHAWRT_DUMP=<dump dir>, board at ECNT>
```
This reads `romfile`, `reservearea` and both banks with U-Boot `flash read` + `crc32` and compares them with your dump.

## Last resort
If U-Boot itself is gone, only an SPI-NAND programmer (CH341A class, e.g. with IMSProg) can help, and only with a raw dump that programmer made earlier (rule 4).
