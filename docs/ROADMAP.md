# Roadmap

AlphaWRT's goal is a full replacement for the GN630V's stock firmware, **including the GPON ONT function**.

## Done
- [x] Boots from flash through the vendor U-Boot, from either bank, with stock kept in the other bank as the fallback
- [x] Install from the stock web UI; back to stock with `alphawrt-bootbank stock`
- [x] Persistent UBIFS overlay, in-place sysupgrade
- [x] MT7530 switch (DSA, 4x GbE), MAC from the U-Boot env, MT7916 radios detected with factory calibration
- [x] Power/PON/internet LEDs
- [x] Wi-Fi 6 AP out of the box on both bands (stock SSIDs/keys/country, WPA2/WPA3, 160 MHz on 5 GHz)
- [x] Encrypted DNS by default (DoQ, DoH over HTTP/3, DoT fallback)
- [x] AlphaWRT LuCI theme
- [x] Moved onto the EN7523 tree with the open GPON stack; EN7571 optics (DDMI) and PON MAC up without fibre
- [x] Quick Setup: Malaysian ISP and ONT presets, GPON identity, Internet, Wi-Fi; fibre card on the Overview
- [x] Basic (stock-style) and Advanced (full LuCI) web interfaces
- [x] Stock web UI login hidden from /proc/cmdline, the kernel log and the device tree (the vendor U-Boot passes its whole env)

## Next
- [ ] GPON on a live line: O2 to O5, OMCI services, Internet on the ISP VLAN
- [ ] Quick Setup operating modes: router, bridge, combo (one port bridged) and mesh
- [ ] Router features: WireGuard, SQM/cake, TCP BBR, packet steering, adblock, attended sysupgrade; a LuCI page for the DNS settings
- [ ] Wi-Fi: band steering, 802.11r/k/v, throughput vs stock
- [ ] Branding (release name, hostname, banner)
- [ ] LAN1-4 port labels, LOS/Wi-Fi/WPS LEDs, reset/WPS buttons, USB
- [ ] NPU Wi-Fi RX offload (driver present; firmware comes from the user's own stock image)
- [ ] Rebase the EN7523 Ethernet series onto current OpenWrt main and upstream the board

## GPON / ONT (the hard part)
1. **Optics:** EN7570 laser driver and BOB calibration from the unit's own flash. Exit: RX power matches stock.
2. **PON MAC to O5:** xPON driver ranging with the OLT, using the stock 4.4 kernel modules as the behavioural reference.
3. **Identity and OMCI:** use the ISP-authorized ONU identity and run an OMCI stack. Collect model-specific fields and OLT behaviour from independent tester observations.
4. **Service:** OMCI VLANs to a WAN interface. Exit: internet through AlphaWRT with stock not running.
