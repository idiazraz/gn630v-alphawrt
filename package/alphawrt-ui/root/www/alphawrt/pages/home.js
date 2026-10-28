/*
 * Home: one verdict banner, then one card per subject (Internet, Fibre,
 * Wi-Fi, Devices, This box). Read-only; refreshed every 5 s. Ported from
 * luci-app-alphawrt's basic/home.js, laid out as ui-draft/home.html.
 */
import { h, icon, badge, alert, rows, card, fmtTime, portName } from '../lib/ui.js';
import { call, maybe, uci, list } from '../lib/rpc.js';
import line from '../lib/line.js';
import { usage } from '../lib/stats.js';

const PON_STATES = [ null, 'Initial', 'Standby', 'Serial number', 'Ranging', 'Registered', 'Signal lost', 'Stopped by the ISP' ];
const MODES = { combo: 'Combo (fibre and router)', bridge: 'Bridge (fibre only)', router: 'Router' };
const SETUP = '#/setup';

/* dnsmasq forwarding to dnsproxy means encrypted DNS: name its upstreams */
function dnsServers(wan) {
	const port = uci.get('dnsproxy', 'global', 'listen_port');
	if (uci.get('dnsproxy', 'global', 'enabled') == '1' && list(uci.get('dhcp', '@dnsmasq[0]', 'server')).includes(`127.0.0.1#${port}`))
		return 'Encrypted via ' + list(uci.get('dnsproxy', 'servers', 'upstream')).map(u => u.replace(/^\w+:\/\/|\/.*$/g, '')).join(', ');
	return (wan?.['dns-server'] || []).join(', ') || '—';
}

/* combo mode's IPTV port: br-iptv = lan4 + pon0.<vlan> (Quick Setup) */
function iptv() {
	const br = uci.sections('network', 'device').find(d => d.name == 'br-iptv');
	const ports = list(br?.ports), pon = ports.find(p => /^pon\d\.\d+$/.test(p));
	return br && pon ? [ ports.find(p => /^lan\d$/.test(p)), pon.split('.')[1] ] : null;
}

const minus = n => String(n).replace('-', '−');

/* healthy window shaded on a -35..-5 dBm scale, from the OLT's own thresholds */
function rxMeter(nw, thr) {
	const d = line.dbm(nw), pct = v => (Math.min(-5, Math.max(-35, v)) + 35) / 30 * 100;
	return h('div', { class: 'col-span-2 -mt-1' },
		h('div', { class: 'relative h-2 rounded-full bg-base-300', role: 'img', 'aria-label': `Healthy range ${thr.rxMin} to ${thr.rxMax} dBm` },
			h('div', { class: 'absolute inset-y-0 rounded-full bg-success/35', style: `left:${pct(thr.rxMin)}%;right:${100 - pct(thr.rxMax)}%` }),
			d != null && h('div', { class: 'absolute -top-1 h-4 w-1.5 rounded-full bg-base-content ring-2 ring-base-100', style: `left:calc(${pct(d)}% - 3px)` })),
		h('div', { class: 'flex justify-between text-xs opacity-60 mt-1' },
			h('span', {}, '−35'), h('span', {}, `healthy ${minus(thr.rxMin)} to ${minus(thr.rxMax)}`), h('span', {}, '−5')));
}

const fmtDbm = nw => { const d = line.dbm(nw); return d == null ? 'No light' : `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(1)} dBm`; };

export default {
	title: 'Home',

	async render(main) {
		const [ presets, board, banks, piPresets ] = await Promise.all([
			maybe('alphawrt', 'presets').then(r => r.presets || []),
			maybe('system', 'board'),
			maybe('alphawrt', 'banks'),
			maybe('alphawrt-pihole', 'presets', {}, { presets: [] }),
			uci.load('alphawrt', 'network', 'wireless', 'dhcp', 'dnsproxy')
		]);
		const isp = presets.find(p => p.id == uci.get('alphawrt', 'setup', 'isp'));
		let rx = null;

		const banner = h('div'), cards = h('div', { class: 'grid gap-4 lg:grid-cols-2' });
		/* uptime is already in This box */
		const u = usage([], { uptime: false });
		main.append(
			h('div', { class: 'flex items-center justify-between gap-4' },
				h('h1', { class: 'text-2xl font-bold' }, 'Home'),
				h('a', { href: SETUP, class: 'hidden lg:inline-flex btn btn-sm btn-outline btn-primary' }, icon('wand'), 'Quick Setup')),
			banner, cards);

		const tick = async () => {
			const [ mode, port ] = line.mode();
			const wifiIfaces = uci.sections('wireless', 'wifi-iface');
			const [ st, ln, ifaces, leases, wstatus, sys, pon, dev, pi ] = await Promise.all([
				maybe('omci.agent', 'status', { device: 0 }).then(r => r.status || {}),
				line.load(),
				maybe('network.interface', 'dump').then(r => r.interface || []),
				maybe('luci-rpc', 'getDHCPLeases', { family: 4 }).then(r => r.dhcp_leases || []),
				maybe('network.wireless', 'status'),
				maybe('system', 'info'),
				maybe('alphawrt', 'pon_info'),
				port ? maybe('network.device', 'status', { name: port }) : {},
				maybe('alphawrt-pihole', 'status', {}, null)
			]);

			/* Wi-Fi clients per interface section, via the ifname netifd gave it */
			const ifname = {};
			for (const r of Object.values(wstatus))
				for (const i of r.interfaces || [])
					if (i.ifname) ifname[i.section] = i.ifname;
			const assoc = await Promise.all(wifiIfaces.map(w => ifname[w['.name']]
				? maybe('iwinfo', 'assoclist', { device: ifname[w['.name']] }).then(r => r.results || []) : []));
			const wifiMacs = new Set(assoc.flat().map(a => a.mac.toLowerCase()));

			/* telemetry can be missing in a single poll: keep the last reading */
			if (st.bosa_rx_power_nw != null) rx = st.bosa_rx_power_nw;
			st.bosa_rx_power_nw = rx;

			const wan = ifaces.find(i => i.interface == 'wan'), wanUp = !!wan?.up, registered = st.state == 5;
			const v = line.verdict(st, ln, mode, wanUp);

			await u.tick();
			banner.replaceChildren(this.banner(v, mode, port, dev, wan, wanUp));
			cards.replaceChildren(...[
				this.internet(mode, port, dev, wan, wanUp, registered, ln, isp, pon),
				this.fibre(mode, st, v, ln, pon),
				this.wifi(mode, wifiIfaces, assoc),
				this.devices(mode, port, leases, wifiMacs),
				this.adblock(mode, pi, piPresets?.presets || [], tick),
				card('system', 'CPU and memory', null, u.el, [ 'System', '#/system' ]),
				this.box(mode, port, board, banks, sys)
			].filter(Boolean));
		};
		await tick();
		return tick;
	},

	banner(v, mode, port, dev, wan, wanUp) {
		const fix = h('a', { href: SETUP, class: 'btn btn-sm btn-warning mt-2' }, 'Open Quick Setup');
		if (v.level != 'ok')
			return alert(v.level, v.title, v.text, /login|serial|ISP has not accepted/i.test(v.title + v.text) ? fix : null);
		if (mode == 'bridge')
			return dev.carrier
				? alert('ok', 'Fibre OK, passing through to your router', `Your own router on ${portName(port)} connects to the Internet. Its own page shows the Internet address.`)
				: alert('warn', `Fibre OK, no router on ${portName(port)}`, `Plug your router’s WAN port into ${portName(port)}.`);
		if (!wanUp)
			return alert('warn', 'Internet not connected', 'Check the Internet login in Quick Setup.', fix);
		return alert('ok', 'Everything’s working', `${v.text} Internet connected for ${fmtTime(wan.uptime)}.`);
	},

	internet(mode, port, dev, wan, wanUp, registered, ln, isp, pon) {
		const link = [ 'Change setup', SETUP ];
		if (mode == 'bridge')
			return card('globe', 'Internet',
				!registered ? badge('bad', 'Waiting for fibre') : dev.carrier ? badge('ok', 'Passing through') : badge('warn', 'No router'),
				rows([
					[ 'Mode', MODES.bridge ],
					[ 'Your router', `on ${portName(port)}` ],
					[ 'Internet login', 'done by your router' ],
					[ 'Provider', isp?.name || 'not set up' ],
					[ 'Internet VLAN', String(pon.vlan || '—') ],
					[ 'Internet address', h('span', { class: 'font-normal opacity-70' }, 'Shown on your own router') ]
				]), link);

		const said = !wanUp && line.ispMessage(ln), tv = iptv(), ip = wan?.['ipv4-address']?.[0]?.address;
		const gw = wan?.route?.find(r => r.target == '0.0.0.0')?.nexthop;
		const errors = (wan?.errors || []).map(e => e.code);
		return card('globe', 'Internet',
			mode != 'router' && !registered ? badge('bad', 'Waiting for fibre') : wanUp ? badge('ok', 'Connected') : badge('warn', 'Not connected'),
			rows([
				said && [ 'Your ISP says', h('span', {}, h('q', { class: 'font-bold' }, said[1]), h('span', { class: 'block text-xs opacity-60 font-normal' }, `at ${said[0]}`)) ],
				!wanUp && errors.length && [ 'Error', errors.join(', ') ],
				mode == 'router' && [ 'Mode', MODES.router ],
				[ 'Provider', isp?.name || 'not set up' ],
				uci.get('network', 'wan', 'proto') == 'pppoe' ? [ 'PPPoE username', uci.get('network', 'wan', 'username') || '—' ] : [ 'Login', 'Automatic (DHCP)' ],
				[ 'Internet VLAN', (uci.get('network', 'wan', 'device') || '').split('.')[1] || 'none' ],
				tv && [ 'IPTV', `${portName(tv[0])} · VLAN ${tv[1]}` ],
				[ 'Internet address', ip || '—' ],
				wanUp && [ 'Gateway', gw || '—' ],
				wanUp && [ 'DNS', dnsServers(wan) ],
				wanUp && [ 'Connected for', fmtTime(wan.uptime) ]
			]), link);
	},

	fibre(mode, st, v, ln, pon) {
		const link = [ 'Fibre details', '#/fibre' ];
		if (mode == 'router')
			return card('fibre', 'Fibre', badge('off', 'Not used'), h('p', { class: 'text-sm opacity-70' }, 'In router mode the Internet comes in on a LAN port, so this box’s fibre is idle.'), link);
		const ok = st.state == 5, light = line.dbm(st.bosa_rx_power_nw) != null;
		const dl = rows([ [ 'Signal received (Rx)', fmtDbm(st.bosa_rx_power_nw) ] ]);
		dl.append(rxMeter(st.bosa_rx_power_nw, ln.thr), ...rows([
			light && st.bosa_tx_power_nw != null && [ 'Signal sent (Tx)', fmtDbm(st.bosa_tx_power_nw) ],
			light && st.bosa_temperature_mc != null && [ 'Optics temperature', `${Math.round(st.bosa_temperature_mc / 1000)} °C` ],
			!ok && [ 'State', PON_STATES[st.state] || 'No fibre' ],
			pon.vlan && [ 'VLAN from your ISP', String(pon.vlan) ],
			[ 'Line quality', v.level == 'ok' ? 'Fibre is healthy' : v.title ]
		]).children);
		return card('fibre', 'Fibre', ok ? badge('ok', 'Registered') : light ? badge('warn', 'Not registered') : badge('bad', 'No light'), dl, link);
	},

	wifi(mode, ifaces, assoc) {
		const on = ifaces.map(w => w.disabled != '1' && uci.get('wireless', w.device, 'disabled') != '1');
		const n = on.filter(Boolean).length;
		return card('wifi', 'Wi-Fi',
			!ifaces.length ? null : n == ifaces.length ? badge('ok', 'On') : n ? badge('warn', `${n} of ${ifaces.length} on`) : badge('off', 'Off'),
			mode == 'bridge' && !n ? h('p', { class: 'text-sm opacity-70' }, 'Off in bridge mode: your own router does Wi-Fi.')
			: h('ul', {}, ifaces.map((w, i) => h('li', { class: 'flex items-center gap-3 py-2.5 border-b border-base-300 first:pt-0 last:pb-0 last:border-b-0' },
				h('div', { class: 'flex-1 min-w-0' },
					h('div', { class: 'text-xs opacity-60' }, uci.get('wireless', w.device, 'band') == '5g' ? '5 GHz' : '2.4 GHz'),
					h('div', { class: on[i] ? 'font-medium truncate' : 'font-medium truncate opacity-50' }, w.ssid || '?')),
				on[i] ? h('span', { class: 'text-sm whitespace-nowrap' }, h('b', {}, assoc[i].length), ' connected') : badge('off', 'Off')))),
			[ 'Change Wi-Fi', '#/wifi' ]);
	},

	devices(mode, port, leases, wifiMacs) {
		if (mode == 'bridge')
			return card('devices', 'Devices', null, h('p', { class: 'text-sm opacity-70' }, `Your devices are on your own router. Only the router on ${portName(port)} talks to this box.`), null);
		return card('devices', 'Devices', null,
			h('div', {},
				h('div', { class: 'flex items-baseline gap-2 mb-3' }, h('span', { class: 'text-4xl font-bold' }, leases.length), h('span', { class: 'opacity-70' }, 'connected')),
				h('ul', {}, leases.slice(0, 3).map(l => {
					const wifi = wifiMacs.has(String(l.macaddr).toLowerCase());
					return h('li', { class: 'flex items-center gap-3 py-2 border-b border-base-300 last:border-b-0' },
						h('span', { class: 'opacity-60', title: wifi ? 'Wi-Fi' : 'Cable' }, icon(wifi ? 'wifi' : 'cable', 'size-4')),
						h('span', { class: 'flex-1 min-w-0 truncate font-medium' }, l.hostname || 'Unnamed device'),
						h('span', { class: 'text-sm opacity-60 tabular-nums' }, l.ipaddr));
				}))),
			[ 'All devices', '#/devices' ]);
	},

	adblock(mode, pi, presets, tick) {
		const link = [ 'Settings', '#/homelab' ];
		if (!pi) return null;
		if (mode == 'bridge')
			return card('vpn', 'Ad blocking', badge('off', 'Bridge mode'),
				h('p', { class: 'text-sm opacity-70' }, 'Off in bridge mode: your own router does DNS.'), link);
		if (!pi.enabled)
			return card('vpn', 'Ad blocking', badge('off', 'Off'),
				h('p', { class: 'text-sm opacity-70' }, 'Network-wide ad blocking is turned off.'), link);

		const pName = presets.find(p => p.id == pi.preset)?.name || pi.preset;
		const b = pi.updating ? badge('warn', 'Updating lists…')
			: pi.blocking == 'disabled' ? badge('warn', pi.timer ? `Paused (${fmtTime(pi.timer)})` : 'Paused')
			: pi.blocking == 'enabled' ? badge('ok', 'Blocking')
			: badge('bad', 'Not running');

		const rowsEl = rows([
			[ 'Filter preset', pName + (pi.tif ? ' + TIF' : '') ],
			pi.domains ? [ 'Domains blocked', Number(pi.domains).toLocaleString() ] : null,
			pi.timer > 0 ? [ 'Paused for', fmtTime(pi.timer) ] : null
		]);

		let actions = null;
		if (pi.running) {
			if (pi.blocking == 'enabled') {
				actions = h('div', { class: 'flex items-center gap-2 pt-1' },
					h('span', { class: 'text-xs opacity-60' }, 'Pause:'),
					h('button', {
						type: 'button',
						class: 'btn btn-xs btn-outline',
						onclick: async () => { await call('alphawrt-pihole', 'pause', { minutes: 5 }); tick(); }
					}, '5m'),
					h('button', {
						type: 'button',
						class: 'btn btn-xs btn-outline',
						onclick: async () => { await call('alphawrt-pihole', 'pause', { minutes: 15 }); tick(); }
					}, '15m'));
			} else if (pi.blocking == 'disabled') {
				actions = h('div', { class: 'pt-1' },
					h('button', {
						type: 'button',
						class: 'btn btn-xs btn-primary',
						onclick: async () => { await call('alphawrt-pihole', 'pause', { minutes: 0 }); tick(); }
					}, 'Resume blocking'));
			}
		}

		return card('vpn', 'Ad blocking', b, h('div', { class: 'space-y-3' }, rowsEl, actions), link);
	},

	box(mode, port, board, banks, sys) {
		const lan = String(uci.get('network', 'lan', 'ipaddr') || '—').split('/')[0];
		return card('box', 'This box', null,
			h('div', { class: 'space-y-4' },
				rows([
					[ 'Mode', MODES[mode] || mode ],
					[ 'Firmware', board.release?.description?.replace(/ r\d+.*$/, '') || '—' ],
					[ 'Model', board.model || '—' ],
					banks.running && [ 'Running from', `Bank ${banks.running.toUpperCase()}` ],
					sys.uptime && [ 'Up for', fmtTime(sys.uptime) ],
					mode == 'bridge'
						? [ 'Manage this box at', uci.get('network', 'gnmgmt', 'ipaddr') || '192.168.100.1' ]
						: [ 'Box address', lan ],
					mode == 'bridge' && [ 'Other LAN ports', lan ]
				]),
				h('div', { class: 'flex flex-wrap justify-end gap-1' },
					h('a', { href: '/cgi-bin/luci/', class: 'btn btn-ghost btn-sm' }, 'Advanced settings', icon('external', 'size-4')),
					h('a', { href: '#/system', class: 'btn btn-ghost btn-sm text-primary' }, 'System', icon('chevron', 'size-4')))),
			null);
	}
};
