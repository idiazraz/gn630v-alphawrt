# Changelog

Every AlphaWRT release for the Skyworth GN630V, newest first, in plain words. The full notes for each release (downloads, hardware acceptance, test limits) are on the [releases page](https://github.com/idiazraz/gn630v-alphawrt/releases).

The web UI, Pi-hole, Wi-Fi, VPN and phone packages are shared by every AlphaWRT model. The [SK-G7220](https://github.com/idiazraz/alphawrt-sk-g7220) and SR1041Y builds keep their own changelogs, which list the shared changes they carry.

How this file is kept:
- Every change a user or tester would notice gets a line under **Unreleased**, in the same commit as the change.
- The groups are **Added**, **Changed**, **Fixed** and **Known issues**. Lines say what the user sees, not how the code does it. A line ends with the GitHub issue it closes, if any.
- At a release, **Unreleased** becomes `## <version> (<date>)`, and the release notes' "What's new" section is copied from it.

## Unreleased

## 0.4.2-test (tester build 2026-11-06)

### Fixed
- **Unifi (TM) fibre: no internet, the line registers but never gets service.** The box now tells the provider's equipment about every kind of setting the stock firmware supports, so TM's Nokia equipment no longer stops before setting up the internet connection. Not yet confirmed on a Unifi line.

## 0.4.1 (2026-11-06)

### Added
- **Kernel modules for zapret and SQM:** NFQUEUE, CAKE and IFB are now included, so both can be installed. SQM only shapes traffic the hardware packet engine doesn't handle; turn offload off if you want it to shape everything ([#4](https://github.com/idiazraz/gn630v-alphawrt/issues/4)).

### Fixed
- **Network page could show only "Something went wrong"** after an upgrade, when a port forward had been made in Advanced (LuCI). The page now opens and lists that forward.

### Known issues
- At idle, the Wi-Fi interrupt fires much more often than it should, wasting CPU. The cause is found; the fix is planned.
- Turning "Stop devices skipping Pi-hole" on or off drops name lookups for about 15 seconds while Pi-hole restarts.

## 0.4.0 (tester build 2026-11-05; not released publicly, shipped in 0.4.1)

### Added
- **Quick Setup country step** after the password: pick your country so Wi-Fi uses its legal channels and power. Changing it resets each band to an automatic channel and a width the country allows.
- **Block a device's internet** from the Devices page: tap a device and switch on "Block its Internet". It stays on Wi-Fi and the home network, but can't reach the internet until you unblock it. Blocked devices show a red "Blocked" badge and stay listed while they're away. Not in bridge mode.
- **Network page:** this box's address and DHCP range, where names are looked up (DNS), IPv6, local names and port forwards, all in one place.
- **DNS choice:** encrypted DNS (the default), your provider's DNS, or servers you pick. Pi-hole keeps working with any of them.
- **IPv6 card** on the Network page.
- **Fibre provisioning page:** a map of what the ISP's equipment (OLT) set up on the box, with every setting decoded.
- **Quick Setup:** a Fibre or WAN choice. Router-only mode uses the 2.5G WAN port where the box has one.

### Changed
- **Faster Wi-Fi and IPv6:** Wi-Fi traffic, IPv6 and UDP now go through the hardware packet engine instead of the CPU. Over Wi-Fi, IPv6 runs at about 906–965 Mb/s down and 770–800 up. Wi-Fi upload offload uses the stock firmware's NPU file, which only official images carry.
- **Pi-hole is harder to skip:** with Pi-hole on, devices that set their own plain DNS server (such as 1.1.1.1) are sent to the box anyway, and browsers are told to drop their own encrypted DNS. Devices with strict encrypted DNS (Android Private DNS, iPhone DNS profiles) keep working. To block encrypted DNS as well, turn on "Stop devices skipping Pi-hole" on the Pi-hole page. Devices set to strict encrypted DNS then lose internet until they switch it off.
- **Every page tidied** on desktop and phone: the VPN page uses the same cards as the rest, Fibre charts are readable on a phone, pause buttons are grouped, and notes have an info icon.
- **Advanced menu** grouped into Status, Fibre, Network, Wi-Fi and VPN. One login works for both the Simple UI and Advanced.
- **Home** names the encrypted DNS servers ("AdGuard (no blocking), Cloudflare"), since "AdGuard" read like an ad blocker.
- **Wi-Fi page** points printers and older devices to WPA2 only.
- **Warning when no GPON serial is saved**, so the box doesn't register with a random one.

### Fixed
- **Guest Wi-Fi had no internet:** guest devices joined but got no address, and with Pi-hole on, no DNS server either.
- **Renaming many devices stopped the internet** until a reboot: the DNS and DHCP service gave up restarting. It now always comes back.
- **WireGuard could never be set up:** the VPN page sent you back to the login screen. If the box undoes a change because it wasn't confirmed, the page now says so instead of doing nothing.
- **Pages stayed stale after an update**, and Wi-Fi client counts were wrong.
- **Router-only mode** no longer keeps the fibre VLAN.
- **Nokia OLTs:** fixes in the fibre management (OMCI) handling, and the GPON identity is held while the line comes up.

### Known issues
- At idle, the Wi-Fi interrupt fires much more often than it should, wasting CPU. The cause is found, and the fix is planned for the next build.

## 0.3.0 (2026-10-29)

### Added
- **Hardware bridging in bridge mode:** the packet engine forwards bridged traffic the way the stock firmware does. On our line, bridge mode went from about 570 down / 370 up with the CPU nearly maxed to 720–760 down / 440 up with the CPU 93% idle.
- **Simple UI and new logo:** Home, Fibre, Wi-Fi, Devices, Pi-hole, VPN, System and Home lab, plus a one-question-per-screen Quick Setup. LuCI stays under Advanced, restyled to match.
- **Pi-hole ad blocking** with Hagezi block lists, an optional threat-intelligence feed, and Pi-hole's own admin page.
- **Wi-Fi:** band steering (802.11k/v, usteer), a guest network (combo mode), a security choice, a QR code for the password, and an Auto channel that moves away from interference.
- **Fibre topology picture**, **WireGuard** in the Simple UI, and a **Home lab** page (Prometheus metrics, iperf3, Wake-on-LAN, UPnP, dynamic DNS, remote syslog, NTP server, htop).

### Fixed
- Router mode: the PON and LOS LEDs stay off.
- Quick Setup shows the "Model details" fields as soon as you pick a model.
- Switching modes no longer logs "internet login failed: USER_REQUEST".

### Known issues
- Web UI over plain HTTP only.
- IPv6 and UDP routing use the CPU. Fixed in the next release.
- Only the TIME line has been tested live.

## 0.2.4-test (2026-10-26)

### Added
- **WireGuard VPN** with QR codes for phones, and policy routing.
- **Unifi IPTV** on LAN 4 in combo mode. Untested on a Unifi line.
- **Home page:** gateway and DNS on the Internet card, and a "This box" card.
- **Fibre:** the OLT's VLAN rules are applied, each VLAN gets its own GEM port, and OLT resets show in the event log.

### Changed
- Larger receive rings, and interrupt coalescing settings for tuning.
- Reproducible builds: `build.sh` pins the feeds and commit dates, and a CI workflow builds the images.

### Fixed
- Fresh installs from the stock web UI no longer leave the LAN unreachable ([#1](https://github.com/idiazraz/gn630v-alphawrt/issues/1)).
- The Wi-Fi LED follows the radios, and the power LED stays on after boot.

## 0.2.3-test (2026-10-25)

### Added
- **Fibre internet works:** live GPON registration, with the internet VLAN taken from the ISP's OLT.
- **Quick Setup**, one step per page: password, Basic or Advanced interface, ISP, and Combo, Bridge or Router mode.
- **ISP presets** from the project's own sources: Unifi (TM) and TIME.
- **Fibre diagnostics:** a plain-language verdict, received light, line-error counters, an event log and a report for ISP tickets.
- **Speed:** hardware offload for IPv4 TCP, and both CPU cores in use.
- **LEDs and buttons** mapped, with reset (short press reboots, 5 s resets to defaults).
- IPv6 client and router advertisements. Firmware banks in System.

### Fixed
- An upstream stall that stopped all traffic after a few hundred packets.

## 0.2.0-test (2026-10-24)

### Added
- First public test build: installs from the stock web UI, and keeps stock in the other firmware bank.
- Wi-Fi name, password and country taken over from the stock settings.
- Quick Setup with ISP and ISP fibre box model presets, a Basic interface, and the full LuCI under Advanced.
- Encrypted DNS by default.

### Known issues
- Fibre internet didn't work yet. The fibre hardware started, but the box didn't register on a live line.
