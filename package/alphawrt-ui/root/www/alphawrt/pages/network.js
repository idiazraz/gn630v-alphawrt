/*
 * Network: everything about the home network in one place. This box's
 * address and the DHCP range, where names are looked up (DNS), local names
 * IPv6, local names and port forwards. Moved here from Devices, System and
 * Home lab.
 */
import { h, icon, card, field, choice, toggle, modal, busy, toast, redraw } from '../lib/ui.js';
import { uci, list, maybe } from '../lib/rpc.js';
import { save } from '../lib/apply.js';

const IP4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const net3 = ip => ip.split('.').slice(0, 3).join('.');
const IP = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:]+)$/i;
const DNS = [ [ 'encrypted', 'Encrypted (recommended)' ], [ 'isp', 'Internet provider’s (e.g. TM Unifi)' ], [ 'custom', 'Other servers' ] ];
const ROUTER_ONLY = () => h('p', { class: 'text-sm opacity-70' }, 'Only in router mode. In bridge mode your own router does this.');
const PROTO = [ [ 'tcp', 'TCP' ], [ 'udp', 'UDP' ], [ 'tcp udp', 'TCP and UDP' ] ];
const ipOk = ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => +n < 256);
const portOk = p => /^\d{1,5}(-\d{1,5})?$/.test(p) && p.split('-').every(n => +n > 0 && +n < 65536);

export default {
	title: 'Network',

	async render(main) {
		await uci.load('network', 'dhcp', 'dnsproxy', 'firewall', 'alphawrt');
		const bridge = uci.get('alphawrt', 'setup', 'mode') == 'bridge';
		const ifaces = bridge ? [] : (await maybe('network.interface', 'dump')).interface || [];
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'Network'),
			h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' },
				this.lan(),
				this.dns(),
				this.ipv6(bridge, ifaces),
				this.names(bridge),
				this.forwards(bridge)));
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

	/* dnsmasq serves the LAN either way (Pi-hole, when on, asks dnsmasq); only where dnsmasq forwards changes */
	dns() {
		const dm = uci.get('dhcp', '@dnsmasq[0]'), port = uci.get('dnsproxy', 'global', 'listen_port') || '5353';
		const servers = list(dm?.server), proxy = `127.0.0.1#${port}`;
		const mode = servers.includes(proxy) ? 'encrypted' : servers.length ? 'custom' : 'isp';
		const sel = choice('DNS servers', DNS, mode);
		const own = field('DNS server addresses', { value: mode == 'custom' ? servers.join(' ') : '', placeholder: 'e.g. 8.8.8.8 1.1.1.1',
			hint: 'One or more addresses, separated by spaces.' });
		const show = () => own.classList.toggle('hidden', sel.input.value != 'custom');
		sel.input.addEventListener('change', show);
		show();
		const go = async () => {
			const m = sel.input.value, ips = own.input.value.trim().split(/[\s,]+/).filter(Boolean);
			if (m == 'custom' && (!ips.length || !ips.every(a => IP.test(a)))) return toast('warn', 'Type one or more IP addresses, such as 8.8.8.8.');
			const ops = m == 'isp'
				? [ [ 'unset', 'dhcp', dm['.name'], 'server' ], [ 'unset', 'dhcp', dm['.name'], 'noresolv' ] ]
				: [ [ 'set', 'dhcp', dm['.name'], { server: m == 'encrypted' ? [ proxy ] : ips, noresolv: '1' } ] ];
			if (m == 'encrypted') ops.push([ 'set', 'dnsproxy', 'global', { enabled: '1' } ]);
			if (await save(ops, { what: 'Saving DNS' }).catch(e => { toast('bad', e.message); return null; })) { toast('ok', 'DNS saved.'); redraw(); }
		};
		return card('globe', 'DNS', null, h('div', {},
			h('p', { class: 'text-sm opacity-80' }, 'Turns names like google.com into addresses for every device here. Encrypted uses AdGuard and Cloudflare, which don’t block anything; ad blocking is Pi-hole’s job.'),
			sel, own,
			h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-primary btn-sm', onclick: go }, 'Save'))));
	},

	/*
	 * Internet side: PPPoE asks for IPv6 itself (wan.ipv6, unset means auto);
	 * DHCP and static use the wan6 DHCPv6 interface, as Quick Setup writes it.
	 * Home side: odhcpd hands out addresses (SLAAC and DHCPv6) from the
	 * provider's prefix, network.lan ip6assign.
	 */
	ipv6(bridge, ifaces) {
		if (bridge) return card('globe', 'IPv6', null, ROUTER_ONLY());
		const pppoe = uci.get('network', 'wan', 'proto') == 'pppoe', w6 = uci.get('network', 'wan6');
		const wanOn = pppoe ? uci.get('network', 'wan', 'ipv6') != '0' : !!w6 && w6.disabled != '1';
		const lanOn = !!uci.get('network', 'lan', 'ip6assign') && /^(server|relay|hybrid)$/.test(uci.get('dhcp', 'lan', 'ra') || '');
		const wan = toggle('IPv6 on the internet connection', wanOn, 'Asks your provider for IPv6, if it gives it.');
		const lan = toggle('Give my devices IPv6', lanOn, 'Phones and computers here get IPv6 addresses from your provider’s range.');

		const pfx = ifaces.flatMap(i => /^wan/.test(i.interface) ? (i['ipv6-prefix'] || []).map(p => `${p.address}/${p.mask}`) : [])[0];
		const addr = ifaces.flatMap(i => /^wan/.test(i.interface) ? (i['ipv6-address'] || []).map(a => a.address) : [])[0];
		const now = !wanOn ? null : pfx ? `Your provider gave ${pfx}.` : addr ? `This box has ${addr}, but no range for your devices yet.` : 'No IPv6 from your provider yet.';

		const go = async () => {
			const ops = [];
			if (pppoe) { if (!wan.input.checked) ops.push([ 'set', 'network', 'wan', { ipv6: '0' } ]); else if (!wanOn) ops.push([ 'set', 'network', 'wan', { ipv6: 'auto' } ]); }
			else if (wan.input.checked) {
				ops.push(w6 ? [ 'set', 'network', 'wan6', { proto: 'dhcpv6', device: '@wan' } ] : [ 'add', 'network', 'interface', { proto: 'dhcpv6', device: '@wan' }, 'wan6' ]);
				if (w6?.disabled) ops.push([ 'unset', 'network', 'wan6', 'disabled' ]);
			}
			else if (w6) ops.push([ 'set', 'network', 'wan6', { disabled: '1' } ]);
			if (lan.input.checked) {
				if (!uci.get('network', 'lan', 'ip6assign')) ops.push([ 'set', 'network', 'lan', { ip6assign: '60' } ]);
				ops.push([ 'set', 'dhcp', 'lan', { ra: 'server', dhcpv6: 'server' } ]);
			}
			else ops.push([ 'set', 'dhcp', 'lan', { ra: 'disabled', dhcpv6: 'disabled' } ]);
			await this.apply(ops, 'IPv6 saved.');
		};
		return card('globe', 'IPv6', null, h('div', {},
			now && h('p', { class: 'text-sm opacity-80 mb-2' }, now),
			wan, h('div', { class: 'mt-3' }, lan),
			h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-primary btn-sm', onclick: go }, 'Save'))));
	},

	forwards(bridge) {
		if (bridge) return card('globe', 'Port forwards', null, ROUTER_ONLY());
		const fwds = uci.sections('firewall', 'redirect').filter(r => (r.target || 'DNAT') == 'DNAT' && (r.src || 'wan') == 'wan');
		const add = async () => {
			const name = field('Name', { placeholder: 'e.g. Minecraft' }), proto = choice('Protocol', PROTO, 'tcp'),
			      ext = field('Outside port', { placeholder: '25565', hint: 'A port or a range like 6000-6010.' }),
			      ip = field('To device address', { placeholder: '192.168.1.50' }), port = field('Device port', { placeholder: 'Same as outside' });
			if (!await modal('Add a port forward', h('div', {}, name, proto, ext, ip, port), [ [ 'Cancel', 'btn-ghost', false ], [ 'Add', 'btn-primary', true ] ])) return;
			const v = { name: name.input.value.trim() || 'Forward', proto: proto.input.value, src: 'wan', src_dport: ext.input.value.trim(),
				dest: 'lan', dest_ip: ip.input.value.trim(), dest_port: port.input.value.trim() || ext.input.value.trim(), target: 'DNAT' };
			if (!portOk(v.src_dport) || !portOk(v.dest_port)) return toast('warn', 'Ports are numbers from 1 to 65535.');
			if (!ipOk(v.dest_ip)) return toast('warn', 'Enter the device’s address, like 192.168.1.50.');
			await this.apply([ [ 'add', 'firewall', 'redirect', v ] ], 'Port forward added.');
		};
		return card('globe', 'Port forwards', null, h('div', { class: 'space-y-3' },
			h('div', { role: 'status', class: 'alert alert-soft alert-warning text-sm' }, icon('warn'),
				'Needs a public IPv4 address. TIME home plans are behind CGNAT unless you ask TIME for a public IP; Unifi usually gives one.'),
			this.listOf(fwds, r => `${r.name || 'Forward'}`, r => `${(list(r.proto).join('+') || 'tcp+udp').toUpperCase()} ${r.src_dport} → ${r.dest_ip}:${r.dest_port || r.src_dport}`, 'firewall', 'port forward'),
			h('div', { class: 'card-actions justify-end' }, h('button', { class: 'btn btn-sm btn-primary', onclick: add }, 'Add'))));
	},

	names(bridge) {
		if (bridge) return card('devices', 'Local names', null, ROUTER_ONLY());
		const list = uci.sections('dhcp', 'domain');
		const add = async () => {
			const name = field('Name', { placeholder: 'nas', hint: 'Devices on your network can then use nas.lan.' }), ip = field('Address', { placeholder: '192.168.1.20' });
			if (!await modal('Add a local name', h('div', {}, name, ip), [ [ 'Cancel', 'btn-ghost', false ], [ 'Add', 'btn-primary', true ] ])) return;
			const n = name.input.value.trim().toLowerCase().replace(/\.lan$/, '');
			if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(n)) return toast('warn', 'Use letters, digits and dashes.');
			if (!ipOk(ip.input.value.trim())) return toast('warn', 'Enter an address like 192.168.1.20.');
			await this.apply([ [ 'add', 'dhcp', 'domain', { name: n, ip: ip.input.value.trim() } ] ], `${n}.lan added.`);
		};
		return card('devices', 'Local names', null, h('div', { class: 'space-y-3' },
			this.listOf(list, d => `${d.name}.lan`, d => d.ip, 'dhcp', 'local name'),
			h('div', { class: 'card-actions justify-end' }, h('button', { class: 'btn btn-sm btn-primary', onclick: add }, 'Add'))));
	},

	/* a list of uci sections with a Remove button each */
	listOf(sections, title, sub, config, what) {
		if (!sections.length) return h('p', { class: 'text-sm opacity-70' }, 'None yet.');
		return h('ul', { class: 'divide-y divide-base-300' }, sections.map(s => h('li', { class: 'flex items-center gap-3 py-2' },
			h('span', { class: 'flex-1 min-w-0' }, h('span', { class: 'block font-medium truncate' }, title(s)), h('span', { class: 'block text-sm opacity-70 truncate' }, sub(s))),
			h('button', { class: 'btn btn-ghost btn-xs', onclick: async () => {
				if (await modal(`Remove this ${what}?`, null, [ [ 'Cancel', 'btn-ghost', false ], [ 'Remove', 'btn-error', true ] ])) this.apply([ [ 'remove', config, s['.name'] ] ], 'Removed.');
			} }, 'Remove'))));
	},

	async apply(ops, done) {
		const ok = await save(ops).catch(e => { toast('bad', e.message); return null; });
		if (ok != null) toast(ok ? 'ok' : 'warn', ok ? done : 'The box didn’t confirm the change, so it was undone.');
		redraw();
	}
};
