# AlphaWRT ONT and ISP field report

Use this guide to collect first-hand, reproducible observations from an ISP-provided ONT and line. The goal is to learn which settings are required for a particular ISP, OLT and service area without relying on unverified preset tables.

> **Device restriction:** Do not flash AlphaWRT on the 2.5G GN630V. This build supports only the AX3000 GN630V variant; the 2.5G variant is untested. Verify the full model/variant marking on the device label.

For TM UniFi testers whose ISP supplied and provisioned this same GN630V, Quick Setup can copy its saved GPON identity: choose **Unifi (TM)**, then click **Use the identity saved by the stock firmware**. This only copies the identity; Internet protocol and VLAN settings still need to match the tester's service. Do not include the copied identity in a report.

Only test equipment and lines you own or are authorized to use. Do not change the ISP ONT, GPON identity, VLANs or bridge configuration without the account holder's and ISP's approval. Keep the ISP's original ONT available so service can be restored.

## Privacy and files

Never submit actual GPON serial numbers, PLOAM/registration IDs, PPPoE credentials, Wi-Fi passwords, MAC addresses, public IP addresses, account numbers, QR codes, or unredacted screenshots and logs. Do not upload a firmware image, flash dump, configuration backup, or packet capture. These can contain credentials and device-specific secrets.

For identity fields, report the **field name, format, and length only**. For example: `GPON SN: vendor prefix + 8 hex characters; 16 characters total`. Replace secret values with `[REDACTED]` before sharing. Remove serials and MACs from console output, filenames, image metadata, and screenshots too.

## Collect the stock baseline

Before changing anything, record:

- ISP, plan, country/state, and broad service area (city or district only).
- ONT vendor and model; hardware and software versions; which page or label showed each value.
- OLT vendor/model if the ISP interface exposes it. Do not probe an ISP network to discover it.
- Stock operating mode and which physical port connects to the router.
- Service types in use: Internet, IPTV, voice, management. For each, record whether it is tagged/untagged and the VLAN ID **only when visible in the owner's stock settings or supplied by the ISP**.
- WAN connection type: PPPoE, DHCP/IPoE, static, or other. Record whether authentication is required, not the username or password.
- GPON registration state (for example, O1–O5), ONU ID if shown, and whether the service is stable.
- Optical RX/TX power and units, plus HEC, CRC, FEC corrected/uncorrectable, BIP, LOS/LOF and uptime counters if available. Take a timestamped baseline and another reading after a fixed interval (suggested: 10 minutes).
- Which LAN ports, Wi-Fi bands, LEDs and voice/IPTV services work in the stock setup.

Record the exact UI labels and menu paths. A cropped screenshot with all identifiers and secrets fully masked is useful, but text notes are preferred.

To compare speed, latency, boot time and line health between stock and AlphaWRT on the same box, follow [STOCK-VS-ALPHAWRT.md](STOCK-VS-ALPHAWRT.md) and add its results block to the report.

## AlphaWRT test sequence

1. Confirm the recovery route and that the original ONT can be restored. Keep a second connection to the Internet if the test will interrupt the household connection.
2. Record AlphaWRT version, bank, boot time, and the test date. Do not include the unit's MAC or serial in the report.
3. Enter only identity values the ISP has authorized for use on this ONT. Compare the field names and formatting expected by AlphaWRT with the stock baseline; never paste those values into the report.
4. Test GPON registration first. Record each observed state, elapsed time, and any non-secret error message. Do not repeatedly reboot or alter optical settings to force registration.
5. After registration, record OMCI state and the service types/ports AlphaWRT reports. If reporting OMCI managed entities, include ME class/instance and attribute names only; redact identity or credential attribute values.
6. Test one service at a time. For Internet, record the selected protocol, whether a VLAN was explicitly configured, and the outcome (link, address acquired, PPP session established, DNS, and reachability). Do not include the assigned address or PPPoE account details.
7. Test IPTV, voice, and management only if present on the account and authorized. Record pass/fail and the relevant port/service mapping without capturing payloads or credentials.
8. Repeat the optical/error-counter reading after the same interval as the stock baseline. Note whether counters increased; do not treat a counter's presence alone as proof of a fault.
9. Restore the stock ONT and confirm the ISP service returns. Record the recovery result.

## OMCI and VLAN capture for other ISPs and OLTs

How the OLT asks the ONT to handle VLANs differs between ISPs and OLT vendors. AlphaWRT has been verified on one TIME line (Huawei OLT). There, the OLT uses the older ME 78 (VLAN tagging operation) to tag the first LAN port with the Internet VLAN. Unifi (TM) and other OLT vendors (Nokia/ALCL, ZTE, FiberHome and others) may use ME 171 (extended VLAN tagging), VLAN filters only, or an 802.1p mapper instead. Each of these needs separate confirmation, so the information below is the most useful thing a tester can send.

All commands here are read-only. Run them on AlphaWRT over SSH after the fibre reaches O5. They print only the VLAN and service-mapping entities, which contain no identity or credentials.

**Do not paste the full output of `ubus call omci.agent status`.** It includes the GPON serial and the ONT identity. Print only the safe fields instead:

```sh
ubus call omci.agent status '{"device":0}' | jsonfilter \
  -e '@.status.state' -e '@.status.omcc_version' \
  -e '@.status.olt_profile_effective_name' -e '@.status.olt_profile_quirk_names' \
  -e '@.status.onu_type_name' -e '@.status.mib_objects' -e '@.status.unsupported'
```

Then print the VLAN and service entities. The allowlist covers ME 47 (bridge ports), 78 (VLAN tagging operation), 84 (VLAN filters), 130 (802.1p mapper), 171 (extended VLAN), 262 (T-CONT), 266 (GEM interworking point), 268 (GEM port) and 329 (VEIP):

```sh
for c in 47 78 84 130 171 262 266 268 329; do
  ubus call omci.agent mib_list '{"device":0}' | jsonfilter -e "@.objects[@.class_id=$c]"
done
```

Never share other classes. ONU-G (256), ONU2-G (257), IP host (134), authentication (148), large string (157), TR-069 (340) and vendor-specific classes can hold serials, addresses, URLs or passwords.

From that output, report:

- **Which VLAN entities the OLT created:** 78, 84, 130 and/or 171, and whether they attach to a LAN port (ME 11 entity 257–260) or to the VEIP (ME 329).
- **For ME 78:** bytes 1–2 of `data` are the tag (the low 12 bits are the VLAN ID), byte 0 is the upstream mode and byte 3 the downstream mode. Report all three. On TIME both modes read `0f`.
- **For ME 171:** the rule count and each rule's treatment VLAN. The `extended_vlan` block shows them.
- **Which VLAN carries the Internet,** and which GEM port and T-CONT it maps to.
- **Where the Internet works:** untagged on `pon0`, on `pon0.<VLAN>`, or both. Build 998 and later tag untagged `pon0` frames when the OLT uses ME 78. With ME 171 or filters only, expect `pon0.<VLAN>` to be needed; report it either way.
- **Kernel messages about the OMCI service mapping:** `dmesg | grep -E "OMCI install failed|ME 78|MIB reset"`. These lines contain no identity.

### Unifi (TM)

The GN630V's own stock firmware, as TM supplies it, says Internet is PPPoE on VLAN 500, IPTV is VLAN 600, voice VLAN 400 and TR-069 management VLAN 209, with OMCC version `A0`. None of this has been confirmed on a live Unifi line with AlphaWRT yet. A Unifi tester should report:

- whether registration reaches O5 with the identity saved by the stock firmware, and the OMCC version AlphaWRT reports;
- the OMCI capture above, especially whether VLAN 500 arrives as ME 78, ME 171 or filters only, and whether it attaches to a LAN port or the VEIP;
- whether PPPoE comes up on `pon0.500`, and (on build 998 or later) on untagged `pon0`;
- IPTV only if the account has it: whether VLAN 600 is provisioned and multicast reaches the set-top box (see the next section).

### Unifi IPTV on LAN 4 (combo mode)

Only for Unifi accounts with TV and a set-top box, and only once the Internet already works in combo mode. Newer Unifi TV boxes may stream over the normal Internet rather than VLAN 600: if yours works on LAN 1 with this option off, report that and stop here.

**Turn it on:** run **Quick Setup** again from the top menu, choose **Unifi (TM)** and **Combo**, tick **IPTV box on LAN 4 (VLAN 600)** on the settings page, then finish. Plug the set-top box into LAN 4. LAN 4 then carries only VLAN 600, passed straight through untagged, as TM's own ONT does; LAN 1–3 and Wi-Fi stay on the Internet. To undo it, run Quick Setup again and untick the box.

**Check, in this order:**

1. The set-top box gets an address (its own network or status screen). Report yes/no only, not the address.
2. Live channels play, and how long a channel change takes. Then try catch-up or on-demand if the account has it.
3. The Internet on LAN 1–3 and Wi-Fi still works while a channel plays: the PPPoE stays up, and a speed test is about the same as without TV.
4. Leave a channel playing for 30 minutes and note any freezes.

If the box gets an address but no channels play, or nothing at all arrives, say which; both are useful.

**Read-only outputs to send** (run over SSH while a channel plays). These print no serials or MACs; do not add `bridge fdb show`, `ip link` or `ifconfig` output, which do.

```sh
uci show network.iptv; uci show network.br_iptv
bridge link show | grep -E 'lan4|pon0\.600' | sed 's/ link-netnsid.*//'
cat /sys/class/net/br-iptv/bridge/multicast_snooping
bridge fdb show br br-iptv | grep -vc permanent
for f in rx_bytes rx_packets multicast tx_bytes; do
  echo "pon0.600 $f $(cat /sys/class/net/pon0.600/statistics/$f)"
done
echo "lan4 tx_bytes $(cat /sys/class/net/lan4/statistics/tx_bytes)"
dmesg | grep -E "OMCI install failed|ME 78|MIB reset|multicast"
```

Run the counter loop twice, a minute apart, so the rate shows. Also send the OMCI capture from the section above with classes `281 309 310` added to the loop (multicast GEM port, multicast operations profile, multicast subscriber config). They hold multicast group addresses and VLANs, not your identity.

### Other OLT vendors

Report the OLT profile AlphaWRT selected (`olt_profile_effective_name`) and any quirks it lists, the `unsupported` count, and the capture above. If the ISP's own ONT shows the OLT vendor, record it. Do not probe the ISP network to find it. A line that registers (O5) but passes no traffic is worth reporting too: include the capture and say which of `pon0` or `pon0.<VLAN>` you tried.

Do not infer ISP-wide settings from one line. Record the location at city/district level and mark each value as **ISP-provided**, **visible in stock UI**, **measured**, or **unknown**. A value observed on one line should not become a default until it has been independently confirmed on additional lines or by the ISP.

## Report template

Copy this template into a new report. Keep the secret fields redacted even when sending privately to the project team.

```text
Report ID:
Date/time and timezone:
Tester contact (optional; share separately if needed):

ISP / plan:
Country / state / city or district:
ONT vendor / model:
Hardware version:
Software version:
OLT vendor / model (if shown):
Evidence source for each value (label / stock UI / ISP document / measured):

Stock mode:
Internet protocol (PPPoE / DHCP-IPoE / static / other):
Authentication required? (yes/no; do not include credentials):
Internet VLAN (value or unknown; source):
Other services and VLANs (value or unknown; source):
Port/service mapping:

Identity fields requested by ISP/stock UI (field name, format, length only):
PLOAM/registration credential required? (yes/no/unknown; never include value):
OMCC version (if displayed; otherwise unknown):
OLT profile/vendor hint (if explicitly displayed; otherwise unknown):
AlphaWRT OLT profile and quirks (olt_profile_effective_name):
VLAN entities the OLT created (78 / 84 / 130 / 171; on LAN port or VEIP):
ME 78 values if present (upstream mode, VLAN, downstream mode):
Internet works on (untagged pon0 / pon0.<VLAN> / both / neither):
OMCI unsupported count and sanitized dmesg OMCI lines:

Stock GPON state and time to register:
Stock optical RX/TX power (value and units):
Stock counters at start / after 10 minutes (HEC, CRC, FEC, BIP, LOS/LOF):

AlphaWRT version / bank:
AlphaWRT GPON state and time to register:
OMCI state and non-secret service mapping:
Internet test result (link / address acquired / PPP established / DNS / reachability):
Other service test results:
Unifi IPTV on LAN 4 (box address yes/no / live channels / catch-up / Internet unaffected / 30 min stable):
AlphaWRT optical RX/TX power (value and units):
AlphaWRT counters at start / after 10 minutes:
Relevant sanitized error messages:

Stock recovery result:
Differences from stock:
Confidence (single observation / repeated / ISP-confirmed):
Attachments (sanitized screenshots only; no dumps, backups, credentials, or packet captures):
```

## Sending a report

Review every attachment and text field for secrets before sharing. If a secret was accidentally included, delete the shared copy and notify the project maintainer so it can be removed from any history or artifacts. The project may use sanitized, independently verified observations to improve AlphaWRT documentation and presets; ask testers before attributing a report to them.
