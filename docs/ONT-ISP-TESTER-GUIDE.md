# AlphaWRT ONT and ISP field report

Use this guide to collect first-hand, reproducible observations from an ISP-provided ONT and line. The goal is to learn which settings are required for a particular ISP, OLT and service area without relying on unverified preset tables.

> **Device restriction:** Do not flash AlphaWRT on the 2.5G GN630V. This build supports only the AX3000 GN630V variant; the 2.5G variant is untested. Verify the full model/variant marking on the device label.

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

Stock GPON state and time to register:
Stock optical RX/TX power (value and units):
Stock counters at start / after 10 minutes (HEC, CRC, FEC, BIP, LOS/LOF):

AlphaWRT version / bank:
AlphaWRT GPON state and time to register:
OMCI state and non-secret service mapping:
Internet test result (link / address acquired / PPP established / DNS / reachability):
Other service test results:
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
