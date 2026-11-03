/*
 * Devices: everything with a DHCP lease or on the Wi-Fi, with how it's
 * connected. Tap one to rename it, give it a fixed address (one dhcp "host"
 * section for both) or wake it (WS4's alphawrt-homelab wol). Below the list,
 * this box's own LAN address and the DHCP range.
 */
import { h, icon, field, toggle, card, modal, busy, toast, redraw, fmtTime } from '../lib/ui.js';
import { call, maybe, uci, list } from '../lib/rpc.js';
import { save } from '../lib/apply.js';

const IP4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const net3 = ip => ip.split('.').slice(0, 3).join('.');

const BAND = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' };

export default {
	title: 'Devices',

	async render(main) {
		await uci.load('wireless', 'dhcp', 'alphawrt', 'network', 'firewall');
		const head = h('h1', { class: 'text-2xl font-bold' }, 'Devices'), box = h('div');
		main.append(head, box);
		if (uci.get('alphawrt', 'setup', 'mode') == 'bridge')
			main.append(h('p', { class: 'text-sm opacity-70' }, 'In bridge mode your devices are on your own router; only devices on this box’s other ports and Wi-Fi show here.'));
		main.append(h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start mt-4' }, this.lan()));

		const tick = async () => {
			const [ leases, hints, wstatus ] = await Promise.all([
				maybe('luci-rpc', 'getDHCPLeases', { family: 4 }).then(r => r.dhcp_leases || []),
				maybe('luci-rpc', 'getHostHints'),
				maybe('luci-rpc', 'getWirelessDevices')
			]);
			const radioOf = {};
			for (const [ radio, r ] of Object.entries(wstatus))
				for (const i of r.interfaces || []) if (i.ifname) radioOf[i.ifname] = radio;
			const wifi = {};
			await Promise.all(Object.keys(radioOf).map(dev => maybe('iwinfo', 'assoclist', { device: dev }).then(r => {
				for (const a of r.results || []) wifi[a.mac.toUpperCase()] = { ...a, band: BAND[uci.get('wireless', radioOf[dev], 'band')] || '' };
			})));

			/* one row per MAC: leases first, then Wi-Fi devices with a fixed address */
			const named = Object.fromEntries(uci.sections('dhcp', 'host').flatMap(s => list(s.mac).map(m => [ m.toUpperCase(), s ])));
			const rows = new Map();
			for (const l of leases) rows.set(String(l.macaddr).toUpperCase(), { name: l.hostname, ip: l.ipaddr });
			for (const mac of Object.keys(wifi)) if (!rows.has(mac)) rows.set(mac, { name: hints[mac.toLowerCase()]?.name || hints[mac]?.name, ip: (hints[mac]?.ipaddrs || [])[0] });
			const devs = [ ...rows ].map(([ mac, d ]) => ({ mac, ...d, name: named[mac]?.name || d.name, w: wifi[mac] }))
				.sort((a, b) => (a.name || '~').localeCompare(b.name || '~'));

			head.replaceChildren('Devices ', h('span', { class: 'badge badge-neutral badge-soft align-middle' }, devs.length));
			box.replaceChildren(!devs.length ? h('p', { class: 'opacity-70' }, 'No devices connected.')
				: h('ul', { class: 'card bg-base-100 border border-base-300 divide-y divide-base-300' }, devs.map(d =>
					h('li', {}, h('button', { type: 'button', class: 'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-base-200 rounded-box',
						onclick: () => this.rename(d, named[d.mac]) },
						h('span', { class: 'grid place-items-center size-9 shrink-0 rounded-full bg-base-200 text-primary' }, icon(d.w ? 'wifi' : 'cable')),
						h('span', { class: 'flex-1 min-w-0' },
							h('span', { class: 'block font-medium truncate' }, d.name || 'Unnamed device'),
							h('span', { class: 'block text-sm opacity-70 truncate' }, d.w
								? `Wi-Fi ${d.w.band} · ${d.w.signal} dBm${d.w.connected_time ? ` · ${fmtTime(d.w.connected_time)}` : ''}`
								: 'Cable or other')),
						h('span', { class: 'text-sm opacity-60 tabular-nums' }, d.ip || ''))))));
		};
		await tick();
		return tick;
	},

	/*
	 * network.lan ipaddr and dhcp.lan start/limit. The range is shown as host
	 * numbers on the router's /24; start and limit stay offsets as OpenWrt keeps them.
	 * Limit: assumes a /24 LAN (the default); other masks keep working, the
	 * range fields just read as offsets.
	 */
	lan() {
		const raw = list(uci.get('network', 'lan', 'ipaddr'))[0] || '192.168.1.1', [ cur, cidr ] = raw.split('/');
		const start = +(uci.get('dhcp', 'lan', 'start') || 100), limit = +(uci.get('dhcp', 'lan', 'limit') || 150);
		const ip = field('This box’s address', { value: cur, placeholder: '192.168.1.1',
			hint: 'Your devices reach the box and the internet through this address.' });
		const first = field('First address', { type: 'number', value: start }), last = field('Last address', { type: 'number', value: start + limit - 1 });
		const pre = h('span', { class: 'text-sm opacity-70 pb-3' });
		const showPre = () => { pre.textContent = IP4.test(ip.input.value.trim()) ? `${net3(ip.input.value.trim())}.` : ''; };
		ip.input.addEventListener('input', showPre);
		showPre();

		const go = async () => {
			const addr = ip.input.value.trim(), a = +first.input.value, b = +last.input.value, last8 = +addr.split('.')[3];
			if (!IP4.test(addr) || last8 < 1 || last8 > 254) return toast('warn', 'Enter an address like 192.168.1.1.');
			if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(addr)) return toast('warn', 'Use a private address: 192.168.x.x, 10.x.x.x or 172.16–31.x.x.');
			const mgmt = uci.get('network', 'gnmgmt', 'ipaddr');
			if (mgmt && net3(mgmt) == net3(addr)) return toast('warn', `${net3(mgmt)}.x is the fibre management network. Pick another.`);
			if (!(a >= 2 && b <= 254 && a <= b)) return toast('warn', 'The range must be from 2 to 254, first before last.');
			if (last8 >= a && last8 <= b) return toast('warn', `The box’s own address (.${last8}) is inside the range. Move one of them.`);

			const moved = addr != cur, ops = [ [ 'set', 'dhcp', 'lan', { start: String(a), limit: String(b - a + 1) } ] ];
			if (moved) {
				ops.push([ 'set', 'network', 'lan', { ipaddr: cidr ? `${addr}/${cidr}` : addr } ]);
				/* fixed addresses and port forwards follow to the new network */
				const was = net3(cur), now = net3(addr), swap = v => v.replace(was + '.', now + '.');
				if (was != now) {
					for (const s of uci.sections('dhcp', 'host')) if (String(s.ip || '').startsWith(was + '.')) ops.push([ 'set', 'dhcp', s['.name'], { ip: swap(s.ip) } ]);
					for (const s of uci.sections('firewall', 'redirect')) if (String(s.dest_ip || '').startsWith(was + '.')) ops.push([ 'set', 'firewall', s['.name'], { dest_ip: swap(s.dest_ip) } ]);
				}
				if (!await modal('Change the box’s address?', h('div', { class: 'space-y-2 text-sm' },
					h('p', {}, `The box moves to ${addr}. Devices on a cable or Wi-Fi get a new address within a minute; unplug and replug, or turn Wi-Fi off and on, if one doesn’t.`),
					was != now && h('p', {}, 'Fixed addresses and port forwards move to the new network too.'),
					h('p', {}, `This page then opens http://${addr}/ and you log in again.`)),
					[ [ 'Cancel', 'btn-ghost', false ], [ 'Change address', 'btn-warning', true ] ])) return;
			}
			/* a browser on the old address can never confirm a move, so no rollback for it */
			const ok = await save(ops, moved ? { rollback: false, what: 'Changing the address' } : { what: 'Saving' }).catch(e => { toast('bad', e.message); return null; });
			if (!ok) return ok === false && toast('warn', 'The box didn’t confirm the change, so it was undone.');
			if (!moved) { toast('ok', 'Saved.'); return redraw(); }
			busy('Moving to the new address', `Opening http://${addr}/ in a few seconds…`);
			setTimeout(() => { location.href = `${location.protocol}//${addr}/`; }, 8000);
		};

		return card('home', 'Local network', null, h('div', {},
			ip,
			h('p', { class: 'text-sm font-medium mt-3' }, 'Addresses given to devices (DHCP)'),
			h('div', { class: 'flex items-end gap-2' }, pre, first, h('span', { class: 'pb-3' }, 'to'), last),
			h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-primary btn-sm', onclick: go }, 'Save'))));
	},

	async rename(d, host) {
		const f = field('Name', { value: d.name || '', placeholder: 'e.g. Living-room-TV', maxlength: 63,
			hint: 'Letters, digits and dashes. This box and your other devices then know it by this name.' });
		const keep = toggle('Always give it the same address', !!host?.ip, 'Handy for printers, servers and port forwards.');
		const ip = field('Address', { value: host?.ip || d.ip || '', placeholder: '192.168.1.50' });
		const wake = h('button', { type: 'button', class: 'btn btn-ghost btn-sm mt-3', onclick: async () => {
			const r = await call('alphawrt-homelab', 'wol', { mac: d.mac }).catch(e => ({ error: e.message }));
			toast(r.ok ? 'ok' : 'bad', r.ok ? 'Wake-up sent.' : r.error || 'Sending the wake-up failed.');
		} }, 'Wake it up (Wake-on-LAN)');
		const ok = await modal(d.name || 'Device', h('div', {}, f, h('div', { class: 'mt-3' }, keep), ip,
			h('p', { class: 'text-xs opacity-60 mt-2' }, `MAC address ${d.mac}`), wake),
			[ [ 'Cancel', 'btn-ghost', false ], [ 'Save', 'btn-primary', true ] ]);
		if (!ok) return;
		const name = f.input.value.trim().replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
		const addr = ip.input.value.trim();
		if (!name) return toast('warn', 'Use letters, digits or dashes.');
		if (keep.input.checked && !/^(\d{1,3}\.){3}\d{1,3}$/.test(addr)) return toast('warn', 'Enter an address like 192.168.1.50.');
		const v = { name, mac: d.mac, ...(keep.input.checked ? { ip: addr } : {}) };
		const ops = host ? [ [ 'set', 'dhcp', host['.name'], v ], !keep.input.checked && host.ip && [ 'unset', 'dhcp', host['.name'], 'ip' ] ].filter(Boolean)
			: [ [ 'add', 'dhcp', 'host', v ] ];
		if (await save(ops, { what: 'Saving' })) toast('ok', keep.input.checked ? `${name} keeps ${addr}.` : `Renamed to ${name}.`);
		else toast('warn', 'The box didn’t confirm the change, so it was undone.');
		redraw();
	}
};
