# Changelog

Every AlphaWRT release for the Skyworth GN630V, newest first, in plain words. The full notes for each release (downloads, hardware acceptance, test limits) are on the [releases page](https://github.com/idiazraz/gn630v-alphawrt/releases).

The web UI, Pi-hole, Wi-Fi, VPN and phone packages are shared by every AlphaWRT model. The [SK-G7220](https://github.com/idiazraz/alphawrt-sk-g7220) and SR1041Y builds keep their own changelogs, which list the shared changes they carry.

How this file is kept:
- Every change a user or tester would notice gets a line under **Unreleased**, in the same commit as the change.
- The groups are **Added**, **Changed**, **Fixed** and **Known issues**. Lines say what the user sees, not how the code does it. A line ends with the GitHub issue it closes, if any.
- At a release, **Unreleased** becomes `## <version> (<date>)`, and the release notes' "What's new" section is copied from it.

## Unreleased

### Added
- **Phone: Maxis preset, and a User agent setting.** Maxis only accepts the phone software of its own routers, so the Maxis preset fills in its SIP server, proxy, voice VLAN 822 and a router user agent it accepts. Other providers can set their own under Server and network.
- **Half-bridge mode** in Quick Setup ("Fibre and your router"): the box does the internet login (PPPoE) and hands the public IP address to your own router (UniFi, MikroTik…) on the LAN port you pick, over DHCP. No double NAT, and you don't lose the box: IPTV, voice, Wi-Fi and its other ports keep working. Your router also gets an IPv6 prefix. When the provider gives a new address, the box restarts that port so your router picks it up.
- **Flood protection for port forwards.** A flood of fake connection attempts (a SYN flood) on a port you forward could fill up the device behind it, and the box's own flood guard only covered the box itself. Now, when a flood hits a forwarded port, the box answers the connection attempts itself and only lets real clients through to your device. It turns on by itself within a second and turns off 10 minutes after the flood stops; normal traffic keeps the usual fast path. Its state and counts are on the Network page, under Port forwards, where you can also set it to always on or off. It covers IPv4 TCP forwards; forwards the firewall limits (by source, schedule, or a block rule) stay with the firewall as before. See [docs/FLOOD-PROTECTION.md](docs/FLOOD-PROTECTION.md).

### Changed
- **Once you have a TCP port forward, a connection through the box that stays silent for over 2 hours ends.** Flood protection needs this whenever it's set to Automatic (the default) or Always on, not only during a flood. It affects connections with no keepalives, such as an idle SSH session; they reconnect. Set flood protection to Off to go back to the old behaviour.
- **Quick Setup is now one page.** After the first-time setup, Quick Setup shows every setting together with one Save, instead of walking through screen by screen. It no longer asks for a password: first-time setup asks only while the box has none.

### Fixed
- **The web pages open over https:// again.** The box makes its own certificate, so the browser warns once that it is self-signed; http:// still works without the warning.
- **Internet comes up after a reboot on Unifi lines that needed the OLT profile switched by hand.** When the fibre registers but the provider doesn't answer the internet login (PPPoE) within a minute, the box restarts the fibre link once by itself ([#8](https://github.com/idiazraz/gn630v-alphawrt/issues/8)).
- **A VLAN the fibre provider tags with a priority now passes traffic.** Some OLTs list a VLAN with a priority attached even when they only check the VLAN number; untagged-priority traffic on it was dropped, so a voice VLAN never got an address ([#7](https://github.com/idiazraz/gn630v-alphawrt/issues/7)).
- **Phone: registers once the voice VLAN gets its address.** The phone service started before the voice VLAN had an address and never tried again; it now restarts when the address arrives. The Phone page also shows the real registration state again ([#7](https://github.com/idiazraz/gn630v-alphawrt/issues/7)).

## 0.5.1 (2026-11-16)

### Changed
- **Both CPU cores now share the LAN traffic.** All wired receive work used to run on the first core while the second sat mostly idle. Now it goes to the second core, which leaves the first free for the web interface and SSH under heavy load. In the built-in Speed test on a 1 Gbit link this gave about 20% more download and up to 50% more upload (GitHub #6).

### Fixed
- **IPv6 on Unifi (TM) and other PPPoE lines:** turning on IPv6 now asks the provider through a separate DHCPv6 client, which Unifi answers, instead of PPPoE's built-in way, which got no IPv6 on Unifi. Turn IPv6 off and on again on the Network page, or rerun Quick Setup, to switch an existing box over.
- **System log filled with Pi-hole config errors** while the built-in Pi-hole was off and had never been turned on (for example when you use your own Pi-hole server). The status check no longer asks Pi-hole for its settings before it has any.

## 0.5.0 (2026-11-15)

### Added
- **Phone on the TEL port.** Plug in a normal home phone and set your provider's SIP line on the new Phone page: lift the handset for a dial tone, dial out, and incoming calls ring the phone. Calls use G.711 over plain SIP (UDP).
- **Internet over this box's Wi-Fi in bridge mode.** If you keep the box's Wi-Fi on in Quick Setup and give your router's 192.168.100.x address, Wi-Fi devices (and LAN 2-4) reach the internet through your router. Your router needs that second address on its Internet port and must forward the box's traffic, as for Pi-hole. Rerunning Quick Setup in bridge mode no longer switches the box's Wi-Fi off.

### Fixed
- **Fibre could stay down for hours after a short drop:** after a 1-second loss of signal, some OLTs keep rejecting the box each time it registers again. After two quick rejections in a row, the box now keeps its laser off for a minute before trying again, as a restart does.
- **Wi-Fi page showed 2.4 GHz at 40 MHz while it ran at 20 MHz.** With other Wi-Fi networks nearby, 2.4 GHz steps down to 20 MHz so it doesn't step on them. The page now says so under the Width setting.

### Known issues
- **Phone line:** tested on our unit with calls between the box and a test line, not yet with a provider's line (Unifi's voice VLAN included). There is no echo canceller, so on some phones you may hear a faint echo of your own voice. SIP over TLS and encrypted calls (SRTP) aren't supported.

## 0.4.3-test (tester build 2026-11-10)

### Fixed
- **One CPU core busy even with nothing happening:** the Wi-Fi interrupt fired about 115,000 times a second at idle, keeping `ksoftirqd/0` busy ([#6](https://github.com/idiazraz/gn630v-alphawrt/issues/6)). It now only fires for real Wi-Fi work. Speeds were never affected, only spare CPU.
- **2.4 GHz Wi-Fi could stay off after a restart:** on Auto channel, the box could pick channel 14, which Wi-Fi 4/5/6/7 can't use, and 2.4 GHz didn't start. Auto now picks from channels 1-13.
- **Unifi (TM) fibre: no internet on a TM-supplied GN630V.** The stock-identity import now sends what the stock firmware really sends TM: vendor CWTC, model GN630V, hardware version CW1.0 and OMCC 150 (not the SKYW/PT632/RP0201/A0 values in its settings), with the box's own serial and the stock firmware's image versions. With those, TM's equipment sets up the line. Confirmed on a live Unifi line.

### Added
- **"Skyworth GN630V (TM-supplied)" in Quick Setup's fibre box list** for Unifi, with the values TM expects. You still enter the serial and PLOAM password from your TM unit.
- **Speed test** page: download, upload, ping and jitter, measured by the box itself against the nearest Speedtest.net servers, or one you pick. Wi-Fi and your own device don’t slow the result.
- **Light and dark mode switch** in the Simple UI (sidebar, or the top bar on a phone) and in Advanced (LuCI): Auto follows your device, or pick Light or Dark. Both share the choice.
- **Change the internet login** (PPPoE username and password) from the Network page, without running Quick Setup again.
- **Fibre page shows the serial number and PLOAM password** the box gives your provider. The password stays hidden until you tap the eye.

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
