/*
 * Fibre: verdict, light and laser with a 24 h chart, line errors explained
 * with the bit error rate against the ISP's alarms, registration, Internet
 * checks and the event log, plus a text report for ISP tickets (no serial
 * number, PLOAM password or MAC address). Port of luci-app-alphawrt's
 * alphawrt/fibre.js.
 */
import { h, alert, rows, card, fmtTime, portName } from '../lib/ui.js';
import { maybe, uci } from '../lib/rpc.js';
import line from '../lib/line.js';
import { topology } from '../lib/topology.js';

const PON_STATES = [ 'No fibre', 'Initial (O1)', 'Standby (O2)', 'Serial number (O3)', 'Ranging (O4)', 'Registered (O5)', 'Signal lost (O6)', 'Stopped by the ISP (O7)' ];
const MODES = { combo: 'Combo (fibre and router)', bridge: 'Bridge (fibre only)', router: 'Router' };

/* name, key in line.errors(), live counter, what it means */
const ERRORS = [
	[ 'Uncorrectable header errors (HEC)', 'hecu', 'hec_uncorrectable', 'Damaged data headers that could not be repaired. The usual sign of a bent, dirty or damaged fibre; the stock firmware shows these as HEC errors.' ],
	[ 'Repaired header errors (HEC)', 'hec1', 'hec_corrected_1bit', 'Headers with one damaged bit, repaired. A few are harmless; a steady stream is an early warning.' ],
	[ 'Repaired header errors, 2 bits', 'hec2', 'hec_corrected_2bit', 'Headers with two damaged bits, repaired. More serious than one bit.' ],
	[ 'Bit errors (BIP)', 'bip', 'bip_errors', 'Bit errors counted over the incoming signal. The box reports these to the ISP too.' ],
	[ 'Damaged frames (CRC)', 'crc', 'rx_crc_errors', 'Data frames that arrived corrupted and were dropped.' ],
	[ 'Lost frame lock (LOF)', 'lof', 'lof', 'Times the box lost track of the signal’s framing: a short outage on the fibre.' ]
];

const minus = s => String(s).replace(/-/g, '−');
const dbmText = nw => { const d = line.dbm(nw); return d == null ? 'No light' : minus(`${d.toFixed(1)} dBm`); };

/*
 * 24 h chart of a history column as inline SVG. val(row) is a number, null
 * (no data: a gap) or NaN (an outage: a red mark); limit is a dashed line.
 */
function chart(ln, val, fmt, limit, H = 140) {
	const W = 720, PAD = 64, now = line.now(ln), COL = line.COL;
	const rs = ln.history.filter(r => r[COL.ts] >= now - 86400), x0 = rs.length ? rs[0][COL.ts] : now;
	const v = rs.map(val).filter(y => y != null && !isNaN(y));
	if (!v.length) return h('p', { class: 'text-sm opacity-70' }, 'No data yet.');
	let lo = Math.min(...v), hi = Math.max(...v);
	if (limit != null && limit > lo - 3 && limit < hi + 3) { lo = Math.min(lo, limit); hi = Math.max(hi, limit); }
	if (hi - lo < 2) { lo = (lo + hi) / 2 - 1; hi = lo + 2; }
	const X = t => (PAD + (t - x0) / Math.max(now - x0, 60) * (W - PAD)).toFixed(1);
	const Y = y => (H - 20 - (y - lo) / (hi - lo) * (H - 30)).toFixed(1);
	let d = '', marks = '', last = null;
	for (const r of rs) {
		const y = val(r), t = r[COL.ts];
		if (y == null || isNaN(y)) {
			if (y != null) marks += `<rect x="${X(t)}" y="10" width="3" height="${H - 30}" fill="var(--color-error)" opacity=".6"/>`;
			last = null;
			continue;
		}
		/* a sample more than 3 min after the last one: the box was off */
		d += (last == null || t - last > 180 ? 'M' : 'L') + X(t) + ',' + Y(y);
		last = t;
	}
	const div = h('div', { class: 'w-full overflow-hidden' });
	div.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" font-size="11" fill="currentColor" role="img" aria-label="Last 24 hours">` +
		`<text x="${PAD - 6}" y="14" text-anchor="end">${fmt(hi)}</text><text x="${PAD - 6}" y="${H - 20}" text-anchor="end">${fmt(lo)}</text>` +
		`<text x="${PAD}" y="${H - 4}">${new Date(x0 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text><text x="${W}" y="${H - 4}" text-anchor="end">now</text>` +
		`<line x1="${PAD}" y1="10" x2="${PAD}" y2="${H - 20}" stroke="currentColor" opacity=".25"/><line x1="${PAD}" y1="${H - 20}" x2="${W}" y2="${H - 20}" stroke="currentColor" opacity=".25"/>` +
		(limit != null && limit >= lo && limit <= hi ? `<line x1="${PAD}" y1="${Y(limit)}" x2="${W}" y2="${Y(limit)}" stroke="var(--color-error)" stroke-dasharray="4 4"/>` : '') +
		marks + `<path d="${d}" fill="none" stroke="var(--color-primary)" stroke-width="1.75"/></svg>`;
	return div;
}

function range(ln, col, fmt) {
	const r = line.range(ln, col);
	return r ? `${fmt(r[0])} to ${fmt(r[1])}` : '—';
}

const note = t => h('p', { class: 'text-xs opacity-70 mt-3' }, t);

export default {
	title: 'Fibre',

	async render(main) {
		const [ board ] = await Promise.all([ maybe('system', 'board'), uci.load('alphawrt', 'network') ]);
		const body = h('div', { class: 'space-y-4' });
		let last = null;
		main.append(h('div', { class: 'flex items-center justify-between gap-4' },
			h('h1', { class: 'text-2xl font-bold' }, 'Fibre'),
			h('button', { class: 'btn btn-sm btn-outline btn-primary', onclick: () => last && this.report(last, board) }, 'Download report')), body);

		const tick = async () => {
			const [ mode, port ] = line.mode();
			const [ st, ln, pon, ifaces, topo, leases, radios ] = await Promise.all([
				maybe('omci.agent', 'status', { device: 0 }).then(r => r.status || {}),
				line.load(),
				maybe('alphawrt', 'pon_info'),
				maybe('network.interface', 'dump').then(r => r.interface || []),
				maybe('alphawrt.fibre', 'topology', {}, null),
				mode == 'bridge' ? [] : maybe('luci-rpc', 'getDHCPLeases', { family: 4 }).then(r => r.dhcp_leases || []),
				mode == 'bridge' ? {} : maybe('network.wireless', 'status')
			]);
			const wan = ifaces.find(i => i.interface == 'wan'), wanUp = !!wan?.up;
			const v = line.verdict(st, ln, mode, wanUp);
			last = { st, ln, pon, mode, wanUp, v };
			const net = mode == 'bridge' ? `On ${portName(port)}, dials the Internet`
				: `Wi-Fi ${Object.values(radios).some(r => r.up) ? 'on' : 'off'} · ${leases.length} devices`;
			body.replaceChildren(topo?.optics ? card('fibre', 'Your fibre line', null, topology(topo, ln, wanUp, net)) : '',
				alert(v.level, v.title, v.text), this.rxChart(ln), h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' },
				this.light(st, ln), this.registration(st, pon), this.internet(mode, port, ln, wan, wanUp)),
				this.errors(st, ln), this.events(ln));
		};
		await tick();
		return tick;
	},

	light(st, ln) {
		const thr = ln.thr;
		return card('fibre', 'Light and laser', null, h('div', {}, rows([
			[ 'Received light', h('span', {}, dbmText(st.bosa_rx_power_nw),
				h('span', { class: 'block text-xs font-normal opacity-60' }, `24 h: ${range(ln, line.COL.rx, dbmText)}; good: ${minus(thr.rxMin)} to ${minus(thr.rxMax)} dBm`)) ],
			[ 'Sent light', dbmText(st.bosa_tx_power_nw) ],
			[ 'Laser current', st.bosa_bias_ua ? `${(st.bosa_bias_ua / 1000).toFixed(1)} mA` : '—' ],
			[ 'Optics temperature', st.bosa_temperature_mc ? h('span', {}, `${(st.bosa_temperature_mc / 1000).toFixed(1)} °C`,
				h('span', { class: 'block text-xs font-normal opacity-60' }, `24 h: ${range(ln, line.COL.temp, t => `${(t / 1000).toFixed(0)} °C`)}`)) : '—' ],
			[ 'Optics voltage', st.bosa_voltage_uv ? `${(st.bosa_voltage_uv / 1e6).toFixed(2)} V` : '—' ]
		]), note('Weak light means a dirty connector, a tight bend or a damaged fibre. A laser current that keeps rising at the same sent light means the laser is ageing.')));
	},

	rxChart(ln) {
		return card('fibre', 'Received light, last 24 h', null, h('div', {},
			chart(ln, r => r[line.COL.rx] > 0 ? line.dbm(r[line.COL.rx]) : NaN, y => minus(`${y.toFixed(1)} dBm`), ln.thr.rxMin, 220),
			note(`Red marks: no light. The dashed line is the lowest light the box works with (${minus(ln.thr.rxMin)} dBm), when it’s in range. A line that sags or jumps while nobody touched the fibre points to a loose connector or a fibre being bent.`)));
	},

	registration(st, pon) {
		return card('box', 'Registration', null, rows([
			[ 'State', PON_STATES[st.state] || PON_STATES[0] ],
			[ 'ONU ID', st.state == 5 && st.onu_id != null ? String(st.onu_id) : '—' ],
			[ 'Internet VLAN from the ISP', pon.vlan ? String(pon.vlan) : 'not provisioned yet' ]
		]));
	},

	internet(mode, port, ln, wan, wanUp) {
		if (mode == 'bridge')
			return card('globe', 'Internet', null, h('div', {}, rows([
				[ 'Mode', MODES.bridge ], [ 'Connection', `Made by your own router on ${portName(port)}` ]
			]), note('Your router dials the Internet, so its login, delay and loss checks are on the router.')));
		const COL = line.COL, lastRow = ln.history.at(-1) || [];
		const pings = ln.history.map(r => r[COL.ping]).filter(p => p != null);
		const logins = line.recent(ln, / (internet: |internet login failed|ISP says)/, 86400);
		return card('globe', 'Internet', null, h('div', { class: 'space-y-3' }, rows([
			[ 'Mode', MODES[mode] || mode ],
			[ 'Connection', wanUp ? `Up for ${fmtTime(wan.uptime)}` : 'Down' ],
			[ 'Drops in the last 24 h', String(line.recent(ln, / internet: down$/, 86400).length) ],
			[ 'Delay to the ISP', lastRow[COL.ping] != null ? `${lastRow[COL.ping]} ms, ${lastRow[COL.loss] || 0}% lost` : '—' ],
			[ 'Delay over 24 h', pings.length ? `average ${Math.round(pings.reduce((a, b) => a + b, 0) / pings.length)} ms, worst ${Math.max(...pings)} ms` : '—' ]
		]), chart(ln, r => r[COL.loss] == 100 ? NaN : r[COL.ping], y => `${Math.round(y)} ms`),
			logins.length > 0 && h('pre', { class: 'text-xs whitespace-pre-wrap bg-base-200 rounded-box p-3' }, logins.slice(-10).reverse().join('\n')),
			note('Once a minute the box pings the ISP’s gateway (3 pings). Red marks: no reply at all. Below: Internet logins, drops and what the ISP’s server said, last 24 h.')));
	},

	errors(st, ln) {
		const c = ln.counters, e15 = line.errors(ln, 900), e24 = line.errors(ln, 86400), thr = ln.thr;
		const cell = (t, cls = '') => h('td', { class: `text-right tabular-nums ${cls}` }, t);
		return card('warn', 'Line errors', null, h('div', { class: 'overflow-x-auto -mx-1' }, h('table', { class: 'w-full text-sm' },
			h('thead', {}, h('tr', { class: 'text-xs opacity-60' }, h('th', { class: 'text-left font-normal py-1' }, 'Counter'),
				[ 'Since boot', '15 min', '24 h' ].map(t => h('th', { class: 'text-right font-normal py-1 pl-3 whitespace-nowrap' }, t)))),
			h('tbody', { class: 'divide-y divide-base-300' },
				ERRORS.map(([ name, key, live, help ]) => h('tr', {},
					h('td', { class: 'py-2 pr-2' }, h('span', { class: 'font-medium' }, name), h('span', { class: 'block text-xs opacity-60' }, help)),
					cell(c[live] ?? '—', 'pl-3'), cell(e15[key], 'pl-3'), cell(e24[key], 'pl-3'))),
				h('tr', {}, h('td', { class: 'py-2 pr-2' }, h('span', { class: 'font-medium' }, 'Bit error rate'),
					h('span', { class: 'block text-xs opacity-60' }, `Bit errors per bit received, from BIP. The ISP’s equipment alarms at 1e-${thr.sd} (signal degraded) and 1e-${thr.sf} (signal fail).`)),
					cell(''), cell(line.fmtBer(line.ber(ln, 900)), 'pl-3'), cell(line.fmtBer(line.ber(ln, 86400)), 'pl-3')),
				h('tr', {}, h('td', { class: 'py-2 pr-2 font-medium' }, 'Error correction (FEC)'),
					h('td', { colspan: 3, class: 'text-right pl-3' }, st.fec_downstream == 2
						? `${c.fec_corrected_codewords || 0} repaired, ${c.fec_uncorrectable_codewords || 0} not repairable` : 'Off (set by the ISP)'))))));
	},

	events(ln) {
		return card('system', 'Events', null, h('div', {}, ln.events.length
			? h('pre', { class: 'text-xs whitespace-pre-wrap max-h-80 overflow-y-auto bg-base-200 rounded-box p-3' }, ln.events.slice(-50).reverse().join('\n'))
			: h('p', { class: 'text-sm opacity-70' }, 'Nothing logged yet.'), note('Kept in memory since the last start.')));
	},

	report(l, b) {
		const c = l.ln.counters, fmtDbm = nw => line.fmtDbm(nw);
		const out = [
			`AlphaWRT fibre report, ${new Date().toISOString()}`,
			`Firmware: ${b.release?.distribution || ''} ${b.release?.version || ''}, ${b.model || ''}`,
			`Mode: ${l.mode}, ISP preset: ${uci.get('alphawrt', 'setup', 'isp') || '-'}`,
			`Verdict: ${l.v.title}. ${l.v.text}`,
			'',
			`State: ${PON_STATES[l.st.state] || '-'}, ONU ID ${l.st.onu_id}, Internet VLAN ${l.pon.vlan || '-'}`,
			`RX ${fmtDbm(l.st.bosa_rx_power_nw)}, TX ${fmtDbm(l.st.bosa_tx_power_nw)}, bias ${l.st.bosa_bias_ua} uA, temp ${l.st.bosa_temperature_mc} mC, voltage ${l.st.bosa_voltage_uv} uV`,
			`FEC downstream: ${l.st.fec_downstream == 2 ? 'on' : 'off'}`,
			`OLT thresholds: SF 1e-${l.ln.thr.sf}, SD 1e-${l.ln.thr.sd}, light ${l.ln.thr.rxMin} to ${l.ln.thr.rxMax} dBm`,
			`Bit error rate: 15 min ${line.fmtBer(line.ber(l.ln, 900))}, 24 h ${line.fmtBer(line.ber(l.ln, 86400))}`,
			`Internet: ${l.wanUp ? 'up' : 'down'}`,
			'',
			'Counters since boot:',
			...Object.keys(c).map(k => `  ${k}=${c[k]}`),
			'', 'History (ts state rx_nw tx_nw bias_ua temp_mc hec1 hec2 hecu crc bip lof fec_cw fec_ucw ping_ms loss_pct rx_frames):',
			...l.ln.history.map(r => '  ' + r.map(x => x == null ? '-' : x).join(' ')),
			'', 'Events:', ...l.ln.events.map(e => '  ' + e)
		];
		const a = h('a', { href: URL.createObjectURL(new Blob([ out.join('\n') + '\n' ], { type: 'text/plain' })), download: 'alphawrt-fibre-report.txt' });
		document.body.append(a);
		a.click();
		a.remove();
	}
};
