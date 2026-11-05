/*
 * Devices: everything with a DHCP lease or on the Wi-Fi, with how it's
 * connected. Tap one to rename it, give it a fixed address (one dhcp "host"
 * section for both), block its Internet (MACs in firewall.alphawrt_blocked, a
 * section type fw4 ignores, applied by /usr/libexec/alphawrt-ui/block) or wake it (WS4's
 * alphawrt-homelab wol). The box's own address and the DHCP range are on the
 * Network page.
 */
import { h, icon, badge, field, toggle, modal, toast, redraw, fmtTime } from '../lib/ui.js';
import { call, maybe, uci, list } from '../lib/rpc.js';
import { save } from '../lib/apply.js';

const BAND = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' };

export default {
	title: 'Devices',

	async render(main) {
		await uci.load('wireless', 'dhcp', 'alphawrt', 'firewall');
		const bridge = uci.get('alphawrt', 'setup', 'mode') == 'bridge';
		const head = h('h1', { class: 'text-2xl font-bold' }, 'Devices'), box = h('div');
		main.append(head, box);
		if (bridge)
			main.append(h('p', { class: 'text-sm opacity-70' }, 'In bridge mode your devices are on your own router; only devices on this box’s other ports and Wi-Fi show here.'));

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
			/* blocked devices stay listed while away, so they can be unblocked */
			const blocked = new Set(list(uci.get('firewall', 'alphawrt_blocked', 'mac')).map(m => m.toUpperCase()));
			for (const mac of [ ...Object.keys(wifi), ...blocked ]) if (!rows.has(mac)) rows.set(mac, { name: hints[mac.toLowerCase()]?.name || hints[mac]?.name, ip: (hints[mac]?.ipaddrs || [])[0] });
			const devs = [ ...rows ].map(([ mac, d ]) => ({ mac, ...d, name: named[mac]?.name || d.name, w: wifi[mac], blocked: blocked.has(mac) }))
				.sort((a, b) => !a.name - !b.name || (a.name || '').localeCompare(b.name || ''));   // unnamed last

			head.replaceChildren('Devices ', h('span', { class: 'badge badge-neutral badge-soft align-middle' }, devs.length));
			box.replaceChildren(!devs.length ? h('p', { class: 'opacity-70' }, 'No devices connected.')
				: h('ul', { class: 'card bg-base-100 border border-base-300 divide-y divide-base-300' }, devs.map(d =>
					h('li', {}, h('button', { type: 'button', class: 'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-base-200 rounded-box',
						onclick: () => this.rename(d, named[d.mac], bridge) },
						h('span', { class: `grid place-items-center size-9 shrink-0 rounded-full bg-base-200 ${d.blocked ? 'text-error' : 'text-primary'}` }, icon(d.blocked ? 'block' : d.w ? 'wifi' : 'cable')),
						h('span', { class: 'flex-1 min-w-0' },
							h('span', { class: 'flex items-center gap-2' }, h('span', { class: 'font-medium truncate' }, d.name || 'Unnamed device'),
								d.blocked && badge('bad', 'Blocked')),
							h('span', { class: 'block text-sm opacity-70 truncate' }, d.blocked && !d.ip && !d.w ? 'Not connected' : d.w
								? `Wi-Fi ${d.w.band} · ${d.w.signal} dBm${d.w.connected_time ? ` · ${fmtTime(d.w.connected_time)}` : ''}`
								: 'Cable or other')),
						h('span', { class: 'text-sm opacity-60 tabular-nums' }, d.ip || ''))))));
		};
		await tick();
		return tick;
	},

	async rename(d, host, bridge) {
		const f = field('Name', { value: d.name || '', placeholder: 'e.g. Living-room-TV', maxlength: 63,
			hint: 'Letters, digits and dashes. This box and your other devices then know it by this name.' });
		const keep = toggle('Always give it the same address', !!host?.ip, 'Handy for printers, servers and port forwards.');
		const ip = field('Address', { value: host?.ip || d.ip || '', placeholder: '192.168.1.50' });
		/* bridge mode: your own router does the routing, so it does the blocking */
		const block = !bridge && toggle('Block its Internet', d.blocked, 'It stays connected to Wi-Fi and your network, but can’t reach the Internet until you unblock it.');
		const wake = h('button', { type: 'button', class: 'btn btn-ghost btn-sm mt-3', onclick: async () => {
			const r = await call('alphawrt-homelab', 'wol', { mac: d.mac }).catch(e => ({ error: e.message }));
			toast(r.ok ? 'ok' : 'bad', r.ok ? 'Wake-up sent.' : r.error || 'Sending the wake-up failed.');
		} }, 'Wake it up (Wake-on-LAN)');
		const ok = await modal(d.name || 'Device', h('div', {}, f, h('div', { class: 'mt-3' }, keep), ip,
			block && h('div', { class: 'mt-3' }, block),
			h('p', { class: 'text-xs opacity-60 mt-2' }, `MAC address ${d.mac}`), wake),
			[ [ 'Cancel', 'btn-ghost', false ], [ 'Save', 'btn-primary', true ] ]);
		if (!ok) return;
		const name = f.input.value.trim().replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
		const addr = ip.input.value.trim();
		const ops = [], done = [];

		/* the dhcp host only when it changed: each change restarts dnsmasq (issues/0022) */
		if (name != (d.name || '') || keep.input.checked != !!host?.ip || (keep.input.checked && addr != host?.ip)) {
			if (!name) return toast('warn', 'Use letters, digits or dashes.');
			if (keep.input.checked && !/^(\d{1,3}\.){3}\d{1,3}$/.test(addr)) return toast('warn', 'Enter an address like 192.168.1.50.');
			const v = { name, mac: d.mac, ...(keep.input.checked ? { ip: addr } : {}) };
			ops.push(...(host ? [ [ 'set', 'dhcp', host['.name'], v ], !keep.input.checked && host.ip && [ 'unset', 'dhcp', host['.name'], 'ip' ] ].filter(Boolean)
				: [ [ 'add', 'dhcp', 'host', v ] ]));
			done.push(keep.input.checked ? `${name} keeps ${addr}.` : `Renamed to ${name}.`);
		}
		if (block && block.input.checked != d.blocked) {
			const macs = list(uci.get('firewall', 'alphawrt_blocked', 'mac')).filter(m => m.toUpperCase() != d.mac);
			if (block.input.checked) macs.push(d.mac);
			/* the MACs live outside the include: fw4 warns about unknown options on an include on every reload */
			ops.push(uci.get('firewall', 'alphawrt_blocked')
				? macs.length ? [ 'set', 'firewall', 'alphawrt_blocked', { mac: macs } ] : [ 'unset', 'firewall', 'alphawrt_blocked', 'mac' ]
				: [ 'add', 'firewall', 'alphawrt_block', { mac: macs }, 'alphawrt_blocked' ]);
			if (!uci.get('firewall', 'alphawrt_block'))
				ops.push([ 'add', 'firewall', 'include', { type: 'script', path: '/usr/libexec/alphawrt-ui/block', fw4_compatible: '1' }, 'alphawrt_block' ]);
			done.push(block.input.checked ? `${name || 'The device'} is blocked.` : `${name || 'The device'} is unblocked.`);
		}
		if (!ops.length) return;
		const r = await save(ops, { what: 'Saving' }).catch(e => { toast('bad', e.message); return null; });
		if (r === false) toast('warn', 'The box didn’t confirm the change, so it was undone.');
		else if (r) toast('ok', done.join(' '));
		redraw();
	}
};
