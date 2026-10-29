/*
 * Quick Setup, one question per screen (the layout of ui-draft/setup.html):
 *   welcome -> password -> how you'll use it -> provider -> fibre identity
 *   -> Internet login / your router -> Wi-Fi -> plug in the fibre -> review.
 * Port of luci-app-alphawrt's alphawrt/quicksetup.js: the same uci writes,
 * the password and fibre identity applied at their own steps, the rest
 * staged and applied at the end with rollback. If the computer's connection
 * moves with the new mode, the box undoes the change and the page offers to
 * apply without the check and names the address to open, as LuCI did.
 */
import { h, icon, rows, field, toggle, choice, modal, busy, toast } from '../lib/ui.js';
import { call, maybe, uci, list } from '../lib/rpc.js';
import { save } from '../lib/apply.js';
import line from '../lib/line.js';

const IDENTITY = [ 'serial', 'password', 'equipment_id', 'hardware_version', 'software_version_0', 'software_version_1', 'omcc_version', 'traffic_management_option' ];
/* fields an ONT-model preset fills; serial and PLOAM password always come from the user */
const ONT_FIELDS = [ 'equipment_id', 'hardware_version', 'software_version_0', 'software_version_1', 'traffic_management_option' ];
const LAN_PORTS = [ 'lan1', 'lan2', 'lan3', 'lan4' ];
const PORTS = LAN_PORTS.map(p => [ p, p.replace(/^lan/, 'LAN ') ]);
/* combo mode can give this port to the ISP's IPTV box (br-iptv), as stock does for Unifi */
const IPTV_PORT = 'lan4';
const MODES = { combo: 'Fibre and router (combo)', bridge: 'Fibre only (bridge)', router: 'Router only' };
const SETUP_TIMEOUT = 90;   // seconds the box waits for this page to confirm a new mode

/* "48575443xxxxxxxx" (vendor as hex, as some ISPs print it) -> "HWTCxxxxxxxx" */
function normalizeSerial(v) {
	v = (v || '').trim();
	if (/^[0-9A-Fa-f]{16}$/.test(v)) {
		const vendor = v.slice(0, 8).match(/../g).map(x => String.fromCharCode(parseInt(x, 16))).join('');
		if (/^[A-Z0-9]{4}$/.test(vendor)) return vendor + v.slice(8).toUpperCase();
	}
	return /^[A-Za-z0-9]{4}[0-9A-Fa-f]{8}$/.test(v) ? v.toUpperCase() : v;
}

let d, presets, onts, phStatus, phPresets, first, cur, err, fibre, root;

const preset = () => presets.find(p => p.id == d.isp);
/* bridge mode: the main router's address next to the box's 192.168.100.1 (issues/0008) */
const gwError = v => /^192\.168\.100\.(\d{1,3})$/.test(v) && +v.split('.')[3] > 1 && +v.split('.')[3] < 255 ? null
	: 'Enter your router’s address on the 192.168.100.x network (2 to 254), for example 192.168.100.2.';

/* --- form pieces bound to d --- */
function bound(el, key, redraw) {
	el.input.addEventListener(el.input.type == 'checkbox' ? 'change' : 'input', () => {
		d[key] = el.input.type == 'checkbox' ? el.input.checked : el.input.value;
		if (redraw) draw();
	});
	return el;
}
const text = (label, key, o = {}) => bound(field(label, { value: d[key] || '', ...o }), key, o.redraw);
const sw = (label, key, hint) => bound(toggle(label, !!d[key], hint), key, true);
const pick = (label, key, options) => bound(choice(label, options, d[key]), key, true);

function card(key, value, title, textLine, tag, onpick) {
	const r = h('input', { type: 'radio', name: key, class: 'radio radio-primary radio-sm mt-1', checked: d[key] == value });
	r.addEventListener('change', () => { d[key] = value; onpick?.(value); draw(); });
	return h('label', { class: 'flex gap-3 p-4 rounded-box bg-base-100 border border-base-300 cursor-pointer has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary' },
		r, h('span', { class: 'flex-1 min-w-0' },
			h('span', { class: 'flex items-center gap-2 font-semibold' }, title, tag),
			textLine && h('span', { class: 'block text-sm opacity-70 mt-1' }, textLine)));
}

const note = (cls, ic, kids) => h('div', { role: 'status', class: `alert alert-soft ${cls} items-start text-sm mt-4` }, icon(ic, 'size-5 shrink-0'), h('div', {}, kids));

/* --- the steps --- */
const STEPS = {
	welcome: {
		rail: 'Welcome',
		body: () => [
			h('h1', { class: 'text-3xl font-bold leading-tight' }, first ? 'Let’s set up your fibre box' : 'Quick Setup'),
			h('p', { class: 'mt-3 opacity-80' }, first ? 'About 5 minutes. Have these ready:' : 'Change how the box connects. Have these ready:'),
			h('ul', { class: 'mt-4 space-y-3' }, [
				[ 'key', 'Your Internet login', 'The PPPoE username and password from your provider’s welcome email or self-care portal.' ],
				[ 'fibre', 'Your old fibre box', 'Its serial number (“GPON SN”) and PLOAM password, from its label or status page.' ],
				[ 'wifi', 'A Wi-Fi name and password', 'Keep your old ones and your devices reconnect by themselves.' ]
			].map(([ ic, t, x ]) => h('li', { class: 'flex gap-3' },
				h('span', { class: 'grid place-items-center size-9 shrink-0 rounded-full bg-base-100 text-primary' }, icon(ic)),
				h('span', {}, h('b', {}, t), h('span', { class: 'block text-sm opacity-70' }, x))))),
			note('alert-warning', 'warn', [ h('b', {}, 'Don’t plug in the fibre yet. '),
				'The box saves its identity first, so your provider never sees an unknown box. Repeated unknown boxes can get a serial number blocked.' ])
		]
	},

	password: {
		rail: 'Password',
		title: 'Set a password for this box',
		lead: () => first ? 'It protects these pages, Advanced settings and SSH (user “root”). Right now anyone on your network could change things.'
			: 'Leave both empty to keep the current password.',
		body: () => [
			text('New password', 'pw1', { password: true, autocomplete: 'new-password', hint: 'At least 8 characters.' }),
			text('Type it again', 'pw2', { password: true, autocomplete: 'new-password' })
		],
		async check() {
			if (!d.pw1 && !first) return;
			if ((d.pw1 || '').length < 8) return 'The password needs at least 8 characters.';
			if (d.pw1 != d.pw2) return 'The two passwords don’t match.';
			const r = await call('luci', 'setPassword', { username: 'root', password: d.pw1 }).catch(() => ({}));
			if (!r.result) return 'Setting the password failed.';
			d.root_password = d.pw1;
			d.pw1 = d.pw2 = '';
		}
	},

	mode: {
		rail: 'How you’ll use it',
		title: 'How will you use this box?',
		body: () => h('div', { class: 'space-y-3' },
			card('mode', 'combo', MODES.combo, 'The fibre goes into this box and it does everything: Internet login, Wi-Fi and your home network. It replaces your provider’s box.',
				h('span', { class: 'badge badge-soft badge-primary badge-sm' }, 'Most people')),
			card('mode', 'bridge', MODES.bridge, 'This box only converts the fibre. Your own router (ASUS, TP-Link, Deco…) plugs into a LAN port and does the Internet login and Wi-Fi.'),
			card('mode', 'router', MODES.router, 'Keep your provider’s fibre box. Plug it into a LAN port of this box, which then works as your router.'))
	},

	pihole: {
		rail: 'Block ads & trackers',
		title: 'Block ads and trackers with Pi-hole?',
		lead: () => 'Pi-hole stops ads, tracking and malicious domains for every phone, laptop and smart TV on your network automatically.',
		body() {
			const presetOptions = phPresets?.length ? phPresets.map(p => [ p.id, `${p.name} · ${p.about}` ]) : [
				[ 'multi', 'Normal · Recommended for most homes' ],
				[ 'light', 'Light · Basic ad and tracker blocking' ],
				[ 'pro', 'Pro · Extended blocking' ]
			];
			return [
				h('div', { class: 'space-y-3' },
					card('pihole', '1', 'Yes, turn on Pi-hole (Recommended)',
						'Blocks ads and malicious domains automatically across all your devices using Hagezi blocklists.',
						h('span', { class: 'badge badge-soft badge-primary badge-sm' }, 'Recommended')),
					card('pihole', '0', 'No, use standard DNS',
						'No ad blocking. You can turn it on later on the Pi-hole page.')),
				d.mode == 'bridge' && d.pihole == '1' && note('alert-info', 'warn', [
					h('b', {}, 'Bridge mode: '),
					'Pi-hole reaches the internet through your router. Give your router’s Internet (WAN) port a second address on 192.168.100.x and let it forward this box’s traffic, then set its DNS server to ',
					h('b', {}, '192.168.100.1'),
					'.'
				]),
				d.mode == 'bridge' && d.pihole == '1' && h('div', { class: 'mt-4' },
					text('Your router’s address', 'pihole_gw', { placeholder: '192.168.100.2', hint: 'This box sends its own internet traffic (block lists, time) here.' })),
				d.pihole == '1' && h('div', { class: 'mt-6 space-y-4 p-4 rounded-box bg-base-100 border border-base-300' },
					h('h3', { class: 'font-semibold text-sm' }, 'Pi-hole settings'),
					pick('Blocklist preset', 'pihole_preset', presetOptions),
					sw('Threat intelligence feed', 'pihole_tif', 'Also block known phishing and malware domains (+213,000 domains).'),
					!phStatus?.password_set && text(d.root_password ? 'Pi-hole admin password (optional)' : 'Pi-hole admin password', 'pihole_pw', {
						password: true,
						placeholder: d.root_password ? 'Leave empty to use box password' : 'At least 8 characters',
						hint: d.root_password ? 'Uses the password you set in Step 1 if left empty.' : 'At least 8 characters for the Pi-hole web admin.'
					})
				)
			];
		},
		check() {
			if (d.pihole != '1') return;
			if (d.mode == 'bridge' && gwError(d.pihole_gw)) return gwError(d.pihole_gw);
			const pw = d.pihole_pw || d.root_password;
			if (!phStatus?.password_set && (!pw || pw.length < 8))
				return 'Set a password for the Pi-hole admin (at least 8 characters).';
			if (d.pihole_pw && d.pihole_pw.length < 8)
				return 'The Pi-hole admin password needs at least 8 characters.';
		}
	},

	isp: {
		rail: 'Provider',
		title: 'Who is your fibre provider?',
		lead: () => 'This only fills in the usual settings. You can change them on the next screens.',
		body: () => h('div', { class: 'space-y-3' }, presets.map(p => card('isp', p.id, p.name,
			p.id == 'other' ? 'Maxis, CelcomDigi and others: you enter the settings.'
				: [ p.proto == 'pppoe' ? 'PPPoE' : 'Automatic IP', p.vlan ? `VLAN ${p.vlan}` : '' ].filter(Boolean).join(' · '),
			null, id => {
				const q = presets.find(x => x.id == id);
				Object.assign(d, { proto: q.proto, vlan: q.vlan ? String(q.vlan) : '', omcc_version: q.omcc_version || d.omcc_version,
					olt_profile: q.olt_profile || '', trunk: !!q.bridge_trunk, iptv_vlan: q.iptv_vlan ? String(q.iptv_vlan) : '' });
				if (!q.iptv_vlan) d.iptv = false;
			}))),
		check: () => d.isp ? null : 'Choose your provider, or Other.'
	},

	identity: {
		rail: 'Fibre identity',
		title: 'Fibre identity',
		skip: () => d.mode == 'router',
		lead: () => 'Copy these from the fibre box your provider installed, so the provider’s equipment accepts this one in its place. Don’t guess: ask your provider if they aren’t on its label or status page.',
		body() {
			const p = preset() || {}, models = onts.filter(t => !t.isps || t.isps.includes(p.id) || p.id == 'other');
			return [
				p.note && h('p', { class: 'text-xs opacity-70 mb-3' }, p.note),
				p.stock_identity && h('div', {},
					h('button', { type: 'button', class: 'btn btn-outline btn-primary w-full', onclick: async () => {
						const r = await maybe('alphawrt', 'stock_identity');
						if (!r || r.error) return toast('warn', r?.error || 'Could not read the stock configuration.');
						for (const k of IDENTITY) if (r[k]) d[k] = r[k];
						draw();
					} }, icon('key', 'size-4'), 'Use the saved stock identity'),
					h('p', { class: 'text-xs opacity-70 mt-2' }, 'The identity the stock firmware kept. Only if your provider supplied this GN630V itself (Unifi does).'),
					h('div', { class: 'divider text-xs opacity-60' }, 'or copy it from your old box')),
				models.length > 0 && (() => {
					const el = pick('Your provider’s fibre box', 'ont', [ [ '', 'Choose the model' ], ...models.map(t => [ t.id, t.name ]) ]);
					el.input.addEventListener('change', () => {
						const t = onts.find(x => x.id == el.input.value);
						if (t) for (const k of ONT_FIELDS) d[k] = t[k] || '';
						draw();
					});
					return el;
				})(),
				text('Serial number (GPON SN)', 'serial', { placeholder: 'ABCD12345678', hint: 'On the label of your provider’s box (“GPON SN” or “ONT SN”), or its status page.' }),
				text('PLOAM password', 'password', { password: true,
					hint: p.id == 'time' ? 'For TIME this is your PPPoE password (TIME Self Care).' : 'Also called the ONT password or registration ID. Leave empty if your provider doesn’t use one.' }),
				h('details', { class: 'collapse collapse-arrow bg-base-100 border border-base-300 mt-4' },
					h('summary', { class: 'collapse-title text-sm font-medium' }, 'Model details (filled in by the model above)'),
					h('div', { class: 'collapse-content' },
						text('Equipment ID', 'equipment_id'), text('Hardware version', 'hardware_version'),
						text('Software version (image 0)', 'software_version_0'), text('Software version (image 1)', 'software_version_1'),
						text('OMCC version', 'omcc_version', { hint: 'Only if your provider or a verified stock configuration gives it.' })))
			];
		},
		check() {
			d.serial = normalizeSerial(d.serial);
			if (!/^[A-Z0-9]{4}[0-9A-F]{8}$/.test(d.serial)) return 'The serial number is 4 letters and 8 digits or letters A–F (like ABCD1234ABCD), or 16 hex digits.';
			if (d.password && !(d.password.length <= 10 || /^[0-9A-Fa-f]{20}$/.test(d.password))) return 'The PLOAM password is up to 10 characters, or 20 hex digits.';
		}
	},

	login: {
		rail: () => d.mode == 'bridge' ? 'Your router' : 'Internet login',
		title: () => d.mode == 'bridge' ? 'Connect your own router' : 'Internet login',
		body() {
			const p = preset() || {};
			if (d.mode == 'bridge')
				return [
					pick('Plug your router’s WAN port into', 'port', PORTS),
					h('p', { class: 'text-xs opacity-70 mt-1' }, 'Not the port your computer is on. The other ports keep this page at 192.168.1.1; your router reaches it at 192.168.100.1.'),
					h('div', { class: 'mt-3' }, sw('Pass every provider VLAN, tagged (trunk)', 'trunk',
						'Your router then handles Internet, IPTV and voice itself, like TM’s own bridge mode (Unifi: Internet 500, IPTV 600, voice 400). Off: only the Internet, untagged.')),
					!d.trunk && text('Internet VLAN', 'vlan', { hint: 'Filled in from the provider. Once the fibre registers, the VLAN your provider’s equipment sends replaces it.' }),
					note('alert-info', 'warn', 'Your router does the Internet login (PPPoE) with the username and password from your provider.')
				];
			return [
				d.mode == 'router' && [ pick('Plug your provider’s fibre box into', 'port', PORTS),
					h('p', { class: 'text-xs opacity-70 mt-1 mb-3' }, 'Not the port your computer is on.') ],
				h('div', { class: 'grid grid-cols-2 gap-2 mb-2' }, card('proto', 'pppoe', 'PPPoE', 'Username and password'), card('proto', 'dhcp', 'Automatic', 'No login (DHCP)')),
				d.proto == 'pppoe' && [
					text('PPPoE username', 'username', { placeholder: 'name@unifi', autocomplete: 'username', hint: 'From your provider’s welcome email or self-care portal.' }),
					text('PPPoE password', 'ppp_password', { password: true, autocomplete: 'current-password', hint: 'Capital letters matter.' })
				],
				d.mode == 'combo' && d.iptv_vlan && h('div', { class: 'mt-4' }, sw('IPTV box on LAN 4', 'iptv',
					`For a TV box. LAN 4 then carries the provider’s IPTV VLAN (${d.iptv_vlan}) only; the other ports and Wi-Fi stay on the Internet. Leave off if you have no TV box.`)),
				h('details', { class: 'collapse collapse-arrow bg-base-100 border border-base-300 mt-4' },
					h('summary', { class: 'collapse-title text-sm font-medium' }, `VLAN: ${d.vlan || 'none'}${p.vlan && d.vlan == String(p.vlan) ? ` (from ${p.name})` : ''}`),
					h('div', { class: 'collapse-content' }, text('Internet VLAN', 'vlan', { hint: d.mode == 'router'
						? 'Usually empty: the provider’s box sends the Internet untagged. Only set it if your provider says so.'
						: 'Once the fibre registers, the VLAN your provider’s equipment sends replaces this.' })))
			];
		},
		check() {
			const v = +d.vlan || 0;
			if (d.vlan && !(v >= 1 && v <= 4094)) return 'The VLAN is a number from 1 to 4094, or empty.';
			if (d.mode != 'bridge' && d.proto == 'pppoe' && !d.username) return 'Enter the PPPoE username.';
		}
	},

	wifi: {
		rail: 'Wi-Fi',
		title: 'Your Wi-Fi',
		lead: () => d.mode == 'bridge' ? null : 'Use the name and password of your old Wi-Fi and your phones and TV reconnect by themselves.',
		body() {
			const fields = [
				text(d.same ? 'Wi-Fi name' : 'Wi-Fi name (2.4 GHz)', 'ssid0', { maxlength: 32 }),
				!d.same && text('Wi-Fi name (5 GHz)', 'ssid1', { maxlength: 32 }),
				text(d.same ? 'Wi-Fi password' : 'Password (2.4 GHz)', 'key0', { password: true, autocomplete: 'new-password', hint: 'At least 8 characters.' }),
				!d.same && text('Password (5 GHz)', 'key1', { password: true, autocomplete: 'new-password' }),
				h('div', { class: 'mt-3' }, sw('Same name and password on both bands', 'same', 'Phones pick the faster band by themselves.'))
			];
			if (d.mode != 'bridge') return fields;
			return [
				sw('Keep this box’s Wi-Fi on', 'wifi_keep', 'Normally your own router does Wi-Fi. If you keep it on, it serves this box’s own network on LAN 2–4 (192.168.1.x, no Internet unless you connect one of those ports to your router’s LAN), not your router’s.'),
				d.wifi_keep && h('div', { class: 'mt-3' }, fields)
			];
		},
		check() {
			if (d.mode == 'bridge' && !d.wifi_keep) return;
			const keys = d.same ? [ d.key0 ] : [ d.key0, d.key1 ];
			if (keys.some(k => k && !/^[\x20-\x7e]{8,63}$/.test(k) && !/^[0-9a-fA-F]{64}$/.test(k))) return 'Wi-Fi passwords need 8 to 63 characters.';
			if ((d.same ? [ d.ssid0 ] : [ d.ssid0, d.ssid1 ]).some(s => s && new TextEncoder().encode(s).length > 32)) return 'A Wi-Fi name is at most 32 characters.';
		}
	},

	fibre: {
		rail: 'Plug in the fibre',
		title: 'Plug in the fibre',
		skip: () => d.mode == 'router',
		body() {
			const stages = [ 'No light', 'Light from the fibre', 'Talking to your provider', 'Registered' ], st = fibre.stage;
			return [
				h('p', { class: 'opacity-80' }, 'First the box saves the fibre identity, then you plug in the fibre and watch it register. Saving it before the fibre goes in avoids alarms at your provider, which can get the serial number blocked.'),
				!fibre.saved ? h('button', { type: 'button', class: 'btn btn-primary w-full mt-4', onclick: saveIdentity }, 'Save the identity')
					: h('p', { class: 'mt-3' }, h('b', {}, 'Identity saved. Now plug the fibre into the PON port'), ' until it clicks.'),
				fibre.saved && h('ol', { class: 'mt-4 space-y-2' }, stages.map((s, i) => h('li', { class: `flex items-center gap-3${i > st ? ' opacity-50' : ''}` },
					h('span', { class: `grid place-items-center size-7 rounded-full ${i <= st ? 'bg-primary text-primary-content' : 'bg-base-300'}` }, i <= st ? icon('ok', 'size-4') : String(i + 1)),
					h('span', { class: i == st ? 'font-semibold' : '' }, s, i == 1 && fibre.light && h('span', { class: 'text-xs opacity-70 ml-2' }, fibre.light))))),
				fibre.extra,
				h('p', { class: 'text-xs opacity-70 mt-4' }, 'You can also finish now and plug the fibre in later; Home shows the fibre state.')
			];
		}
	},

	finish: {
		rail: 'Review',
		title: 'Check and finish',
		body() {
			const p = preset();
			const wifi = d.mode == 'bridge' && !d.wifi_keep ? 'Off (your router does Wi-Fi)' : d.same ? (d.ssid0 || '—') : `${d.ssid0 || '—'} / ${d.ssid1 || '—'}`;
			return [
				h('div', { class: 'card bg-base-100 border border-base-300' }, h('div', { class: 'card-body p-5' }, rows([
					[ 'Use', MODES[d.mode] ],
					[ 'Provider', p?.name || '—' ],
					d.mode != 'router' && [ 'Serial number', d.serial || '—' ],
					d.mode != 'combo' && [ d.mode == 'bridge' ? 'Your router on' : 'Provider’s box on', d.port.replace(/^lan/, 'LAN ') ],
					d.mode == 'combo' && d.iptv && [ 'IPTV', `LAN 4 · VLAN ${d.iptv_vlan}` ],
					d.mode != 'bridge' && [ 'Internet', d.proto == 'pppoe' ? `PPPoE as ${d.username}` : 'Automatic' ],
					[ 'VLAN', d.mode == 'bridge' && d.trunk ? 'All, passed to your router' : d.vlan || 'none' ],
					[ 'Wi-Fi', wifi ],
					phStatus && [ 'Ad blocking', d.pihole == '1' ? `On · Pi-hole (${phPresets.find(p => p.id == d.pihole_preset)?.name || 'Normal'})` : 'Off' ]
				]))),
				h('div', { class: 'mt-4' }, sw('Malaysian time zone (UTC+8)', 'tz')),
				note('alert-info', 'warn', `Finish applies everything with a safety net: if this page can’t reach the box afterwards, the old settings come back by themselves within ${SETUP_TIMEOUT} seconds.`),
				h('p', { class: 'text-xs opacity-70 mt-4' }, 'The stock firmware stays in the other flash bank. System → Firmware banks switches back to it.')
			];
		}
	}
};
const ORDER = [ 'welcome', 'password', 'mode', 'pihole', 'isp', 'identity', 'login', 'wifi', 'fibre', 'finish' ];
const visible = () => ORDER.filter(id => !STEPS[id].skip?.());
const val = x => typeof x == 'function' ? x() : x;

/* --- the fibre step: save the identity, then watch it register --- */
async function saveIdentity(ev) {
	const btn = ev.currentTarget;
	btn.disabled = true;
	const args = Object.fromEntries(IDENTITY.map(k => [ k, d[k] || '' ]));
	args.olt_profile = d.olt_profile || preset()?.olt_profile || '';
	try { await call('alphawrt', 'set_identity', args); }
	catch (e) { btn.disabled = false; return toast('bad', e.message); }
	fibre.saved = true;
	draw();
	pollFibre();
}

function pollFibre() {
	clearInterval(fibre.timer);
	const tick = async () => {
		if (!root?.isConnected || cur != 'fibre') return clearInterval(fibre.timer);
		const [ st, pon ] = await Promise.all([ maybe('omci.agent', 'status', { device: 0 }).then(r => r.status || {}), maybe('alphawrt', 'pon_info') ]);
		const rx = line.dbm(st.bosa_rx_power_nw);
		fibre.stage = st.state == 5 ? 3 : rx != null && rx > -32 ? (st.state >= 2 && st.state <= 4 ? 2 : 1) : 0;
		fibre.light = rx != null ? `${rx.toFixed(1).replace('-', '−')} dBm` : null;
		if (fibre.stage >= 1 && !fibre.since) fibre.since = Date.now();
		fibre.extra = null;
		if (st.state == 5) {
			let t = pon.vlan ? `Your provider sends the Internet on VLAN ${pon.vlan}.` : '';
			if (pon.vlan && String(pon.vlan) != String(d.vlan)) { t = `Your provider’s equipment uses VLAN ${pon.vlan} (the preset said ${d.vlan || 'untagged'}): Quick Setup uses ${pon.vlan}.`; d.vlan = String(pon.vlan); }
			fibre.extra = note('alert-success', 'ok', [ h('b', {}, 'Registered. '), t ]);
		}
		else if (st.state == 7)
			fibre.extra = note('alert-error', 'bad', 'Your provider’s equipment has stopped this box (serial number blocked or not registered). Unplug the fibre now and check the serial number.');
		else if (fibre.since && Date.now() - fibre.since > 180000)
			fibre.extra = note('alert-error', 'bad', [ h('b', {}, 'Not registered after 3 minutes: unplug the fibre now. '),
				rx != null && rx < line.RX_MIN ? `The light is too weak (${rx.toFixed(1)} dBm); clean the connector and check for bends.`
					: 'The light is fine, so the serial number or PLOAM password is probably wrong. Go back, check them, and plug the fibre in again.' ]);
		draw();
	};
	tick();
	fibre.timer = setInterval(tick, 2000);
}

/* --- writing the configuration (quicksetup.js writeNetwork / apply) --- */
function networkOps() {
	const ops = [], vlan = +d.vlan || 0, iptv = d.mode == 'combo' && d.iptv && +d.iptv_vlan;
	const devices = uci.sections('network', 'device'), has = s => !!uci.get('network', s);
	const setOrAdd = (config, section, type, values) => ops.push(uci.get(config, section) ? [ 'set', config, section, values ] : [ 'add', config, type, values, section ]);

	/* an earlier bridge mode: the pon0 bridge and the interfaces on it. Reused in
	 * bridge mode (removing and re-adding the same names in one save isn't safe),
	 * removed otherwise. */
	const br = devices.find(s => s.type == 'bridge' && s.name != 'br-iptv' && list(s.ports).some(p => /^pon\d/.test(p)));
	if (d.mode != 'bridge') {
		if (br) for (const i of uci.sections('network', 'interface').filter(i => i.device == br.name)) ops.push([ 'remove', 'network', i['.name'] ]);
		if (br) ops.push([ 'remove', 'network', br['.name'] ]);
		for (const z of uci.sections('firewall', 'zone').filter(z => z.name == 'gnmgmt')) ops.push([ 'remove', 'firewall', z['.name'] ]);
	}

	/* combo mode's IPTV port, with no address on the box (no IPv6 link-local either) */
	const tv = devices.find(s => s.name == 'br-iptv');
	if (iptv) {
		const v = { type: 'bridge', name: 'br-iptv', ports: [ IPTV_PORT, `pon0.${iptv}` ], ipv6: '0' };
		ops.push(tv ? [ 'set', 'network', tv['.name'], v ] : [ 'add', 'network', 'device', v, 'br_iptv' ]);
		setOrAdd('network', 'iptv', 'interface', { proto: 'none', device: 'br-iptv' });
	}
	else {
		if (has('iptv')) ops.push([ 'remove', 'network', 'iptv' ]);
		if (tv) ops.push([ 'remove', 'network', tv['.name'] ]);
	}

	/* LAN bridge: every port except the one this mode takes */
	const lanBr = devices.find(s => s.name == 'br-lan');
	if (lanBr) ops.push([ 'set', 'network', lanBr['.name'], { ports: LAN_PORTS.filter(p => d.mode == 'combo' ? !(iptv && p == IPTV_PORT) : p != d.port) } ]);

	if (d.mode == 'bridge') {
		/* trunk: pon0 itself passes every ISP VLAN tagged; else only the Internet VLAN, untagged */
		const bv = { type: 'bridge', name: 'br-wan', ports: [ d.port, vlan && !d.trunk ? `pon0.${vlan}` : 'pon0' ] };
		ops.push(br ? [ 'set', 'network', br['.name'], bv ] : [ 'add', 'network', 'device', bv, 'br_wan' ]);
		setOrAdd('network', 'ontbridge', 'interface', { proto: 'none', device: 'br-wan' });
		/* reachable from the router's side, like an ISP ONT: 192.168.100.1 */
		setOrAdd('network', 'gnmgmt', 'interface', { proto: 'static', device: 'br-wan', ipaddr: '192.168.100.1', netmask: '255.255.255.0',
			...(d.pihole == '1' && d.pihole_gw ? { gateway: d.pihole_gw } : {}) });
		const zone = uci.sections('firewall', 'zone').find(z => z.name == 'gnmgmt'), zv = { name: 'gnmgmt', network: [ 'gnmgmt' ], input: 'ACCEPT', output: 'ACCEPT', forward: 'REJECT' };
		ops.push(zone ? [ 'set', 'firewall', zone['.name'], zv ] : [ 'add', 'firewall', 'zone', zv ]);
		setOrAdd('network', 'wan', 'interface', { device: 'pon0', disabled: '1' });
		if (has('wan6')) ops.push([ 'set', 'network', 'wan6', { disabled: '1' } ]);
		return ops;
	}

	const wv = { device: (d.mode == 'router' ? d.port : 'pon0') + (vlan ? `.${vlan}` : ''), proto: d.proto || 'dhcp' };
	if (d.proto == 'pppoe') Object.assign(wv, { username: d.username, password: d.ppp_password, ipv6: 'auto' });
	setOrAdd('network', 'wan', 'interface', wv);
	ops.push([ 'unset', 'network', 'wan', 'disabled' ]);
	if (d.proto == 'pppoe') { if (has('wan6')) ops.push([ 'remove', 'network', 'wan6' ]); }
	else {
		for (const o of [ 'username', 'password', 'ipv6' ]) ops.push([ 'unset', 'network', 'wan', o ]);
		setOrAdd('network', 'wan6', 'interface', { proto: 'dhcpv6', device: '@wan' });
		ops.push([ 'unset', 'network', 'wan6', 'disabled' ]);
	}
	return ops;
}

function allOps() {
	const ops = networkOps();
	for (const r of [ '0', '1' ]) {
		const sid = `default_radio${r}`, w = uci.get('wireless', sid);
		if (!w) continue;
		if (d.mode == 'bridge' && !d.wifi_keep) { ops.push([ 'set', 'wireless', sid, { disabled: '1' } ]); continue; }
		const ssid = d.same ? d.ssid0 : d[`ssid${r}`], key = d.same ? d.key0 : d[`key${r}`];
		ops.push([ 'set', 'wireless', sid, { disabled: '0', ...(ssid ? { ssid } : {}), ...(key ? { key, encryption: 'sae-mixed' } : {}) } ]);
		/* the radio too: a fresh config can leave it off */
		ops.push([ 'unset', 'wireless', w.device, 'disabled' ]);
	}
	const sys = uci.sections('system', 'system')[0];
	if (d.tz && sys) ops.push([ 'set', 'system', sys['.name'], { zonename: 'Asia/Kuala Lumpur', timezone: '<+08>-8' } ]);
	if (phStatus && uci.get('pihole', 'main')) {
		ops.push([ 'set', 'pihole', 'main', {
			enabled: d.pihole == '1' ? '1' : '0',
			preset: d.pihole_preset || 'multi',
			tif: d.pihole_tif ? '1' : '0'
		} ]);
	}
	ops.push([ 'set', 'alphawrt', 'setup', { isp: d.isp || '', mode: d.mode, port: d.port || '', done: '1' } ]);
	return ops;
}

/* the address to open afterwards, when the computer's connection moves with the mode */
const newAddress = () => d.mode == 'bridge' ? '192.168.100.1 (from your router) or 192.168.1.1 (from LAN 2–4)' : String(uci.get('network', 'lan', 'ipaddr') || '192.168.1.1').split('/')[0];

async function finish() {
	clearInterval(fibre.timer);
	/* once registered, the VLAN the OLT provisioned beats the preset */
	if (d.mode != 'router') {
		const pon = await maybe('alphawrt', 'pon_info');
		if (pon.state == 5 && pon.vlan) d.vlan = String(pon.vlan);
	}
	const ops = allOps();
	let ok = await save(ops, { timeout: SETUP_TIMEOUT, what: 'Applying your settings' }).catch(e => { toast('bad', e.message); return null; });
	if (ok == null) return;
	if (!ok) {
		const again = await modal('The box undid the change', h('div', { class: 'space-y-2 text-sm' },
			h('p', {}, 'This page couldn’t reach the box after the change, so it went back to the old settings. That’s expected when the new mode moves the port this computer is on.'),
			h('p', {}, 'Apply without the safety net if you’re sure, then open ', h('b', {}, newAddress()), '.')),
			[ [ 'Keep the old settings', 'btn-ghost', false ], [ 'Apply anyway', 'btn-warning', true ] ]);
		if (!again) return draw();
		ok = await save(ops, { rollback: false, what: 'Applying your settings' }).catch(e => { toast('bad', e.message); return null; });
		if (ok == null) return;
	}
	if (phStatus) {
		const pw = d.pihole_pw || d.root_password || undefined;
		await call('alphawrt-pihole', 'set', {
			enabled: d.pihole == '1',
			preset: d.pihole_preset || 'multi',
			tif: !!d.pihole_tif,
			password: pw
		}).catch(e => console.warn('Pi-hole setup error:', e));
	}
	cur = 'done';
	draw();
}

/* --- drawing --- */
function draw() {
	if (!root?.isConnected) return;
	if (cur == 'done')
		return root.replaceChildren(h('div', { class: 'text-center py-12' },
			h('span', { class: 'inline-grid place-items-center size-20 rounded-full bg-base-100 text-success' }, icon('ok', 'size-10')),
			h('h1', { class: 'text-2xl font-bold mt-6' }, 'All set'),
			h('p', { class: 'opacity-70 mt-2' }, d.mode == 'bridge' ? `Plug your router into ${d.port.replace(/^lan/, 'LAN ')}. This box stays reachable at ${newAddress()}.` : 'Home shows whether the fibre and the Internet are up.'),
			h('a', { href: '#/home', class: 'btn btn-primary mt-8' }, 'Go to Home', icon('chevron', 'size-4'))));

	const steps = visible(), i = steps.indexOf(cur), s = STEPS[cur], n = steps.length - 1;
	const back = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go(-1) }, 'Back');
	const next = h('button', { type: 'button', class: 'btn btn-primary flex-1 lg:flex-none lg:px-8', onclick: e => go(1, e) },
		cur == 'welcome' ? 'Start' : cur == 'finish' ? 'Finish and apply' : 'Next', cur != 'finish' && icon('chevron', 'size-4'));
	root.replaceChildren(h('div', {},
		h('div', { class: 'flex items-center gap-3 mb-6' },
			h('progress', { class: 'progress progress-primary flex-1', value: i, max: n }),
			h('span', { class: 'text-sm opacity-70 whitespace-nowrap' }, i ? `Step ${i} of ${n} · ${val(s.rail)}` : 'Quick Setup')),
		s.title && h('h1', { class: 'text-2xl font-bold leading-tight' }, val(s.title)),
		val(s.lead) && h('p', { class: 'mt-2 mb-4 opacity-80' }, val(s.lead)),
		h('div', { class: s.title ? 'mt-2' : '' }, s.body()),
		err && h('div', { role: 'alert', class: 'alert alert-soft alert-error text-sm mt-4' }, icon('bad', 'size-5'), err),
		h('div', { class: 'sticky bottom-16 lg:bottom-0 lg:static mt-8 -mx-4 px-4 py-3 bg-base-200 lg:bg-transparent lg:mx-0 lg:px-0 flex gap-2 lg:justify-end' },
			cur == 'welcome' ? (first ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: skip }, 'Skip setup') : null) : back, next)));
}

async function go(delta, ev) {
	const steps = visible(), i = steps.indexOf(cur), s = STEPS[cur], btn = ev?.currentTarget;
	if (delta > 0) {
		if (btn) btn.disabled = true;
		err = (await s.check?.()) || null;
		if (btn) btn.disabled = false;
		if (err) return draw();
		if (cur == 'finish') return finish();
	}
	err = null;
	cur = steps[Math.max(0, Math.min(steps.length - 1, i + delta))];
	draw();
	scrollTo(0, 0);
	if (cur == 'fibre' && fibre.saved) pollFibre();
}

/* first run only: mark setup done without changing anything else */
async function skip() {
	if (!await modal('Skip Quick Setup?', h('p', {}, 'The box keeps its current settings. You can run Quick Setup any time from the top of Home.'),
		[ [ 'Cancel', 'btn-ghost', false ], [ 'Skip', 'btn-primary', true ] ])) return;
	if (await save([ [ 'set', 'alphawrt', 'setup', { done: '1' } ] ], { what: 'Saving' })) location.hash = '#/home';
}

export default {
	title: 'Quick Setup',

	async render(main) {
		const [ pr, phSt, phPr ] = await Promise.all([
			maybe('alphawrt', 'presets'),
			maybe('alphawrt-pihole', 'status', {}, null),
			maybe('alphawrt-pihole', 'presets', {}, { presets: [] }),
			uci.load('alphawrt', 'firewall', 'network', 'omci', 'system', 'wireless', 'pihole')
		]);
		presets = pr.presets || [];
		onts = pr.onts || [];
		phStatus = phSt || null;
		phPresets = phPr.presets || [];
		first = uci.get('alphawrt', 'setup', 'done') != '1';
		const [ mode, port ] = line.mode(), wan = uci.get('network', 'wan', 'device') || '', m = /^(pon0|lan\d)(?:\.(\d+))?$/.exec(wan);

		d = Object.fromEntries(IDENTITY.map(k => [ k, uci.get('omci', 'main', k) || '' ]));
		const piholeOn = uci.get('pihole', 'main', 'enabled') == '1';
		Object.assign(d, {
			isp: uci.get('alphawrt', 'setup', 'isp') || '', mode, port: port || 'lan1',
			proto: uci.get('network', 'wan', 'proto') || 'pppoe', vlan: m?.[2] || '',
			username: uci.get('network', 'wan', 'username') || '', ppp_password: uci.get('network', 'wan', 'password') || '',
			wifi_keep: false, tz: true, pw1: '', pw2: '', root_password: '',
			pihole: first ? '1' : (piholeOn ? '1' : '0'),
			pihole_preset: uci.get('pihole', 'main', 'preset') || 'multi',
			pihole_tif: uci.get('pihole', 'main', 'tif') == '1',
			pihole_pw: '',
			pihole_gw: uci.get('network', 'gnmgmt', 'gateway') || ''
		});
		/* the VLAN is on the WAN device (combo/router) or on the bridge's pon0 port (bridge) */
		for (const s of uci.sections('network', 'device'))
			for (const p of list(s.ports)) {
				const v = /^pon0\.(\d+)$/.exec(p);
				if (v && s.name == 'br-iptv') Object.assign(d, { iptv: true, iptv_vlan: v[1] });
				else if (v && !d.vlan) d.vlan = v[1];
			}
		const p = preset();
		if (!d.vlan && p?.vlan) d.vlan = String(p.vlan);
		if (!d.iptv_vlan && p?.iptv_vlan) d.iptv_vlan = String(p.iptv_vlan);
		d.trunk = uci.sections('network', 'device').some(s => s.type == 'bridge' && list(s.ports).includes('pon0')) || !!p?.bridge_trunk;
		for (const r of [ '0', '1' ]) {
			d[`ssid${r}`] = uci.get('wireless', `default_radio${r}`, 'ssid') || '';
			d[`key${r}`] = uci.get('wireless', `default_radio${r}`, 'key') || '';
		}
		d.same = d.ssid0 == d.ssid1 && d.key0 == d.key1;

		cur = 'welcome';
		err = null;
		fibre = { stage: -1, saved: false };
		root = h('div', { class: 'mx-auto max-w-xl' });
		main.append(root);
		draw();
	}
};
