# Changelog

Every AlphaWRT release for the FiberHome SR1041Y, newest first, in plain words. The full notes for each release (downloads, what was tested) are on the [releases page](https://github.com/HazzPika/SR1041Y-AlphaWRT/releases).

The web UI, Pi-hole, Wi-Fi and VPN packages are shared by every AlphaWRT model and come from the [GN630V](https://github.com/idiazraz/gn630v-alphawrt) project. The shared changes the SR1041Y carries are listed here too. The SR1041Y is a router that sits behind the ISP's fibre box, so the fibre, GPON and phone features of the other models don't apply to it.

How this file is kept:
- Every change a user or tester would notice gets a line under **Unreleased**, in the same commit as the change.
- The groups are **Added**, **Changed**, **Fixed** and **Known issues**. Lines say what the user sees, not how the code does it. A line ends with the GitHub issue it closes, if any.
- At a release, **Unreleased** becomes `## <version> (<date>)`, and the release notes' "What's new" section is copied from it.

## Unreleased

First bring-up of the SR1041Y. It has not had a tagged release yet: everything below is what a tester sees on the first build. Shared features come from the GN630V project at the versions noted in its own changelog.

### Added
- **Speed test** page: download, upload, ping and jitter, measured by the box itself against the nearest Speedtest.net servers, or one you pick. Wi-Fi and your own device don’t slow the result.
- **Light and dark mode switch** in the Simple UI (sidebar, or the top bar on a phone) and in Advanced (LuCI): Auto follows your device, or pick Light or Dark. Both share the choice.
- **Change the internet login** (PPPoE username and password) from the Network page, without running Quick Setup again.
- **The SR1041Y as a router.** Internet comes in on **port 1 (WAN)**; the other three ports are the LAN. Wi-Fi 6 on both bands, DSA switch, DHCP, SSH and the web UI.
- **Wi-Fi taken over from stock on first boot:** the network names, passwords and country, now as WPA2/WPA3, with each band's own MAC.
- **Quick Setup country step** after the password: pick your country so Wi-Fi uses its legal channels and power. Changing it resets each band to an automatic channel and a width the country allows.
- **USB tethering as a second WAN:** plug a phone or USB modem into the USB port and the box can use it for internet, as a backup or the main line.
- **Pi-hole ad blocking** with Hagezi block lists, an optional threat feed, and Pi-hole's own admin page. Lists also work when the internet comes in over USB tethering.
- **Simple UI:** Home, Wi-Fi, Devices and System pages, with a one-question-per-screen Quick Setup. The full LuCI stays under Advanced, restyled to match.
- **Block a device's internet** from the Devices page: tap a device and switch on "Block its Internet". It stays on Wi-Fi and the home network, but can't reach the internet until you unblock it. Blocked devices show a red "Blocked" badge and stay listed while they're away.
- **Network page:** this box's address and DHCP range, where names are looked up (DNS), IPv6, local names and port forwards, all in one place.
- **DNS choice:** encrypted DNS (the default), your provider's DNS, or servers you pick. Pi-hole keeps working with any of them.
- **IPv6 card** on the Network page.
- **Wi-Fi:** band steering (802.11k/v), a guest network, a security choice, a QR code for the password, and an Auto channel that moves away from interference. 160 MHz is offered only where the radio supports it.
- **WireGuard VPN** in the Simple UI, with QR codes for phones and policy routing.
- **LEDs and buttons mapped:** the internet LED follows the WAN (and USB tethering), and the reset button reboots on a short press, factory-resets on a 5 s hold.
- **Real MACs** from the box's own stock factory data (LAN, label and Wi-Fi).
- **Kernel modules for zapret and SQM:** NFQUEUE, CAKE and IFB are now included, so both can be installed. SQM only shapes traffic the hardware packet engine doesn't handle; turn offload off if you want it to shape everything ([#4](https://github.com/idiazraz/gn630v-alphawrt/issues/4)).

### Changed
- **Pi-hole no longer cuts off devices with strict encrypted DNS** (for example Android Private DNS set to `dns.google`, or an iPhone DNS profile). Devices with their own plain DNS still go through Pi-hole. Blocking encrypted DNS as well is now a switch on the Pi-hole page, "Stop devices skipping Pi-hole", off by default.
- **Every page tidied** on desktop and phone: the VPN page uses the same cards as the rest, pause buttons are grouped, and notes have an info icon.
- **Advanced menu** grouped into Status, Network, Wi-Fi and VPN. One login works for both the Simple UI and Advanced.
- **Home** names the encrypted DNS servers ("AdGuard (no blocking), Cloudflare"), since "AdGuard" read like an ad blocker.
- **Wi-Fi page** points printers and older devices to WPA2 only.
- **Quick Setup is now one page.** After the first-time setup, Quick Setup shows every setting together with one Save, instead of walking through screen by screen. It no longer asks for a password: first-time setup asks only while the box has none.

### Fixed
- **The web pages open over https:// again.** The box makes its own certificate, so the browser warns once that it is self-signed; http:// still works without the warning.
- **Internet comes up after a reboot on Unifi lines that needed the OLT profile switched by hand.** When the fibre registers but the provider doesn't answer the internet login (PPPoE) within a minute, the box restarts the fibre link once by itself ([#8](https://github.com/idiazraz/gn630v-alphawrt/issues/8)).
- **IPv6 on Unifi (TM) and other PPPoE lines:** turning on IPv6 now asks the provider through a separate DHCPv6 client, which Unifi answers, instead of PPPoE's built-in way, which got no IPv6 on Unifi. Turn IPv6 off and on again on the Network page, or rerun Quick Setup, to switch an existing box over.
- **System log filled with Pi-hole config errors** while the built-in Pi-hole was off and had never been turned on (for example when you use your own Pi-hole server). The status check no longer asks Pi-hole for its settings before it has any.
- **2.4 GHz Wi-Fi could stay off after a restart:** on Auto channel, the box could pick channel 14, which Wi-Fi 4/5/6/7 can't use, and 2.4 GHz didn't start. Auto now picks from channels 1-13.
- **Network page could show only "Something went wrong"** after an upgrade, when a port forward had been made in Advanced (LuCI). The page now opens and lists that forward.
- **Guest Wi-Fi had no internet:** guest devices joined but got no address, and with Pi-hole on, no DNS server either.
- **Renaming many devices stopped the internet** until a reboot: the DNS and DHCP service gave up restarting. It now always comes back.
- **WireGuard could never be set up:** the VPN page sent you back to the login screen. If the box undoes a change because it wasn't confirmed, the page now says so instead of doing nothing.
- **Pages stayed stale after an update**, and Wi-Fi client counts were wrong.
- **Saving a value that was already set** no longer shows as an error.
- **A VLAN the fibre provider tags with a priority now passes traffic.** Some OLTs list a VLAN with a priority attached even when they only check the VLAN number; ordinary traffic on it was dropped, so a voice VLAN never got an address ([#7](https://github.com/idiazraz/gn630v-alphawrt/issues/7)).

### Known issues
- **Early bring-up.** The first install needs the UART (serial console) and takes about 27 minutes; installing from the stock web UI is still being worked out.
- **No fibre.** The SR1041Y has no onboard optics; it sits behind the ISP's fibre box and runs router-only. The GN630V's fibre, GPON and phone features don't apply.
- **PPPoE on a live Unifi line** hasn't been verified end to end on AlphaWRT yet.
- **Web UI over plain HTTP only.**
