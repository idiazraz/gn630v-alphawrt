/*
 * Wi-Fi: per band on/off, channel (Auto, self-healing, or a fixed channel
 * and width) and a join QR code; one name, password and security for both
 * bands or one each; band steering; the guest network. On WS3's
 * alphawrt.wifi backend (contract v2: side-session notes ws3-wifi-contract.md).
 */
import { h, icon, badge, card, field, toggle, choice, modal, toast, redraw, fmtTime } from '../lib/ui.js';
import { call, maybe, uci } from '../lib/rpc.js';
import { save } from '../lib/apply.js';
import { qrSvg, wifiQr } from '../lib/qr.js';

const BAND = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' };
const SECURITY = [ [ 'wpa2-wpa3', 'WPA2 + WPA3 (recommended)' ], [ 'wpa2', 'WPA2 only' ], [ 'wpa3', 'WPA3 only' ] ];
const ENCRYPTION = { wpa2: 'psk2', 'wpa2-wpa3': 'sae-mixed', wpa3: 'sae' };

/* WPA passphrase: 8-63 printable characters, or 64 hex digits (not with WPA3 only) */
const keyOk = (k, sec) => /^[\x20-\x7e]{8,63}$/.test(k) || (sec != 'wpa3' && /^[0-9a-fA-F]{64}$/.test(k));
const ssidOk = s => s.length > 0 && new TextEncoder().encode(s).length <= 32;
const secOf = s => SECURITY.some(x => x[0] == s) ? s : 'wpa2-wpa3';

function showQr(ssid, key) {
	modal(`Join ${ssid}`, h('div', { class: 'flex flex-col items-center gap-3' }, qrSvg(wifiQr(ssid, key)),
		h('p', { class: 'text-sm opacity-70 text-center' }, 'Point a phone camera at the code to join without typing the password.')),
		[ [ 'Done', 'btn-primary', true ] ]);
}

export default {
	title: 'Wi-Fi',

	async render(main) {
		const [ st ] = await Promise.all([ maybe('alphawrt.wifi', 'status', {}, null), uci.load('usteer') ]);
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'Wi-Fi'));
		if (!st || !st.bands)
			return main.append(card('wifi', 'Wi-Fi', badge('off', 'Unavailable'),
				h('p', { class: 'text-sm opacity-70' }, 'Wi-Fi status backend is not available on this image.')));
		const bands = st.bands;
		if (!bands.length)
			return main.append(h('p', {}, 'No Wi-Fi radios found.'));
		if (st.mode == 'bridge')
			main.append(h('div', { role: 'status', class: 'alert alert-soft alert-info text-sm' }, icon('warn'),
				'In bridge mode your own router normally does Wi-Fi. If you switch this box’s Wi-Fi on, it serves the devices on LAN 2–4, not your router’s network.'));

		const together = toggle('Same name and password on both bands', st.same_name, 'Phones and laptops pick the faster band by themselves.');
		const pw = (label, value, sec) => field(label, { value: value || '', password: true, autocomplete: 'new-password',
			hint: sec == 'wpa3' ? '8 to 63 characters. WPA3 only: older devices may not connect.' : '8 to 63 characters.' });
		const shared = { ssid: field('Network name', { value: bands[0].ssid || '', maxlength: 32 }), key: pw('Password', bands[0].key),
			sec: choice('Security', SECURITY, secOf(bands[0].security)) };

		const per = bands.map(b => {
			const p = { b, on: toggle(`${BAND[b.band] || b.band} on`, b.enabled),
				ssid: field('Network name', { value: b.ssid || '', maxlength: 32 }), key: pw('Password', b.key),
				sec: choice('Security', SECURITY, secOf(b.security)),
				chan: choice('Channel', [ [ 'auto', 'Auto (self-healing)' ], ...(b.channels || []).map(c => [ String(c.channel), `${c.channel}${c.dfs ? ' · radar check' : ''}` ]) ],
					b.auto_channel ? 'auto' : String(b.channel)),
				width: choice('Width', (b.widths || []).map(w => [ String(w), `${w} MHz` ]), String(b.width_mhz)),
				info: h('div') };
			/* widths the chosen channel allows (5 GHz 149+ stops at 80 MHz) */
			/* on a channel change, never on load: the saved width stays as it is */
			const fit = changed => {
				const auto = p.chan.input.value == 'auto', c = (b.channels || []).find(x => String(x.channel) == p.chan.input.value);
				const ok = auto ? b.widths || [] : c?.widths || b.widths || [];
				for (const o of p.width.input.options) o.disabled = changed && !ok.includes(+o.value);
				if (changed && p.width.input.selectedOptions[0]?.disabled) p.width.input.value = String(Math.max(...ok));
				const a = b.auto, sw = a?.last_switch;
				p.info.replaceChildren(h('p', { class: 'text-xs opacity-70 mt-1' }, auto
					? [ 'Picks a quiet channel and moves if it gets crowded, never while you’re using it.',
						a?.busy_pct != null && b.channel != null && ` Now: channel ${b.channel}, ${a.busy_pct}% busy.`,
						sw && ` Last moved ${fmtTime(Date.now() / 1000 - sw.time)} ago, ${sw.from} → ${sw.to}: ${sw.reason}.` ]
					: c?.dfs ? 'Radar channel: Wi-Fi starts after a 1-minute radar check.' : ''));
			};
			p.chan.input.addEventListener('change', () => fit(true));
			fit(false);
			return p;
		});
		const qrButton = (ssid, key) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => showQr(ssid, key) }, 'Show QR code');
		const radio = p => h('div', { class: 'grid grid-cols-2 gap-3' }, p.chan, p.width);

		const steer = st.band_steering?.installed && toggle('Band steering', st.band_steering.enabled,
			'Nudges phones and laptops onto the faster band when they’re close enough. Fast roaming (802.11k/v) stays on either way.');

		const g = st.guest || {};
		const guest = { on: toggle('Guest Wi-Fi on', g.enabled, 'Guests get the Internet but can’t see your devices or this box.'),
			ssid: field('Guest network name', { value: g.ssid || `${bands[0].ssid || 'AlphaWRT'}-Guest`, maxlength: 32 }),
			key: pw('Guest password', g.key), sec: choice('Security', SECURITY, secOf(g.security)) };
		if (!g.available) for (const x of Object.values(guest)) x.input.disabled = true;

		const body = h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' });
		const draw = () => body.replaceChildren(...[
			together.input.checked && card('wifi', 'Your Wi-Fi', null, h('div', {}, shared.ssid, shared.key, shared.sec,
				h('div', { class: 'card-actions justify-end mt-2' }, qrButton(bands[0].ssid, bands[0].key)))),
			per.map(p => card('wifi', BAND[p.b.band] || p.b.band, p.b.enabled ? badge('ok', `${p.b.clients} connected`) : badge('off', 'Off'),
				h('div', {}, p.on, !together.input.checked && [ p.ssid, p.key, p.sec ], radio(p), p.info,
					!together.input.checked && p.b.enabled && h('div', { class: 'card-actions justify-end mt-2' }, qrButton(p.b.ssid, p.b.key))))),
			card('wifi', 'Guest Wi-Fi', g.enabled ? badge('ok', `${g.clients || 0} connected`) : badge('off', 'Off'),
				h('div', { class: g.available ? '' : 'opacity-50' }, guest.on, guest.ssid, guest.key, guest.sec,
					!g.available && h('p', { class: 'text-sm mt-2' }, g.reason == 'bridge' ? 'Your own router handles guest Wi-Fi in bridge mode.' : 'Guest Wi-Fi isn’t available right now.'),
					g.enabled && h('div', { class: 'card-actions justify-end mt-2' }, qrButton(g.ssid, g.key)))),
			steer && card('wifi', 'Band steering', null, steer)
		].flat().filter(Boolean));
		together.input.addEventListener('change', draw);
		draw();

		const button = h('button', { class: 'btn btn-primary w-full sm:w-auto sm:px-8' }, 'Save');
		button.addEventListener('click', () => this.save(st, per, together.input.checked, shared, steer, guest).catch(e => toast('bad', e.message)));
		main.append(h('div', { class: 'card bg-base-100 border border-base-300' }, h('div', { class: 'card-body p-5' }, together)),
			body, h('div', { class: 'flex justify-end' }, button));
	},

	async save(st, per, one, shared, steer, guest) {
		const ops = [], problems = new Set();
		let cutsOff = false, goingOff = false;

		for (const p of per) {
			const src = one ? shared : p, ssid = src.ssid.input.value, key = src.key.input.value, sec = src.sec.input.value, on = p.on.input.checked;
			if (!ssidOk(ssid)) problems.add('A network name needs 1 to 32 characters.');
			if (!keyOk(key, sec)) problems.add('A Wi-Fi password needs 8 to 63 characters.');
			if (p.b.enabled && !on) goingOff = true;
			if (p.b.enabled && (!on || ssid != p.b.ssid || key != p.b.key || sec != secOf(p.b.security))) cutsOff = true;
			ops.push([ 'set', 'wireless', p.b.iface, { disabled: on ? '0' : '1', ssid, key, encryption: ENCRYPTION[sec] } ]);
			/* OpenWrt then picks the PMF setting that matches the encryption */
			ops.push([ 'unset', 'wireless', p.b.iface, 'ieee80211w' ]);
			/* the band is on only if its radio is too: Advanced can switch off either */
			const radio = { channel: p.chan.input.value, ...(p.width.input.value ? { htmode: `HE${p.width.input.value}` } : {}) };
			ops.push([ 'set', 'wireless', p.b.radio, radio ]);
			if (on) ops.push([ 'unset', 'wireless', p.b.radio, 'disabled' ]);
		}

		const g = st.guest || {};
		if (g.available && (guest.on.input.checked || g.enabled)) {
			const on = guest.on.input.checked, ssid = guest.ssid.input.value, key = guest.key.input.value, sec = guest.sec.input.value;
			if (on && !ssidOk(ssid)) problems.add('The guest network name needs 1 to 32 characters.');
			if (on && !keyOk(key, sec)) problems.add('The guest password needs 8 to 63 characters.');
			if (on && !g.configured && !problems.size) {
				const r = await call('alphawrt.wifi', 'guest_setup');
				if (!r.ok) return toast('bad', r.error == 'bridge' ? 'Guest Wi-Fi isn’t available in bridge mode.' : 'Setting up guest Wi-Fi failed.');
			}
			for (const s of [ 'guest_2g', 'guest_5g' ]) {
				ops.push([ 'set', 'wireless', s, on ? { disabled: '0', ssid, key, encryption: ENCRYPTION[sec] } : { disabled: '1' } ]);
				if (on) ops.push([ 'unset', 'wireless', s, 'ieee80211w' ]);
			}
		}

		if (steer && steer.input.checked != st.band_steering.enabled) {
			const sec = uci.sections('usteer', 'usteer')[0]?.['.name'];
			if (sec) ops.push([ 'set', 'usteer', sec, { band_steering_interval: steer.input.checked ? '30000' : '0' } ]);
		}

		if (problems.size)
			return toast('warn', [ ...problems ].join(' '));
		if (goingOff && !await modal('Switch Wi-Fi off?', h('p', {}, 'If this phone or laptop is connected over that Wi-Fi, it loses this page. Use a cable or the other band to get back.'),
			[ [ 'Cancel', 'btn-ghost', false ], [ 'Switch off', 'btn-warning', true ] ]))
			return;

		/* a browser on a network whose name, password or security just changed can never confirm,
		 * so that save goes through without rollback; everything else keeps the 30 s safety net */
		const ok = await save(ops, { rollback: !cutsOff, what: 'Saving Wi-Fi' });
		toast(ok ? 'ok' : 'warn', ok ? 'Saved. Devices reconnect with the new settings.' : 'The box didn’t confirm the change, so it was undone.');
		redraw();
	}
};
