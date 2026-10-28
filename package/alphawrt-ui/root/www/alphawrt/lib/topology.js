/*
 * The fibre path as a picture: your ISP -> splitter -> fibre -> this box ->
 * your network, with one pulsing lane per service the ISP provisioned.
 * Port of luci-app-alphawrt's alphawrt/topology.js drawing (WS6 contract:
 * side-session notes ws6-fibre-contract.md), on alphawrt.fibre topology.
 * Horizontal from 640 px, vertical on phones.
 */
import { h } from './ui.js';
import line from './line.js';

const PON_STATES = [ 'No fibre', 'Initial (O1)', 'Standby (O2)', 'Serial number (O3)', 'Ranging (O4)', 'Registered (O5)', 'Signal lost (O6)', 'Stopped by the ISP (O7)' ];
const KINDS = { internet: 'Internet', iptv: 'IPTV', voice: 'Voice', management: 'ISP management', other: 'Other' };
const LANE = { internet: 'var(--color-primary)', iptv: '#8b5cf6', voice: '#0d9488', management: '#a16207', other: 'var(--color-secondary)' };
const LEVEL = { ok: 'var(--color-success)', warn: 'var(--color-warning)', bad: 'var(--color-error)', off: 'color-mix(in oklab, currentColor 30%, transparent)' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* light against the OLT's limits: ok, warn (within 3 dB of the low limit or 1 dB of the high one), bad, off */
function lightLevel(t) {
	const d = line.dbm(t.optics.rx_nw), l = t.limits;
	if (d == null || d < -32 || t.pon.los) return 'off';
	if (d < l.rx_min || d > l.rx_max) return 'bad';
	return d < l.rx_min + 3 || d > l.rx_max - 1 ? 'warn' : 'ok';
}

/* light, registration and (when the box dials) the Internet login */
export function states(t, ln, wanUp) {
	const light = lightLevel(t), st = t.pon.state, said = line.ispMessage(ln);
	return { light, said, reg: light == 'off' ? 'off' : st == 5 ? 'ok' : st == 7 ? 'bad' : 'warn',
		login: t.mode == 'bridge' ? null : wanUp ? 'ok' : said ? 'bad' : 'warn' };
}

function svg(t, s, net, vertical) {
	const T = vertical ? [ 40, 200, 470, 720 ] : [ 70, 270, 560, 790 ], C = 50, R = 24;
	const P = (tt, c) => vertical ? [ c, tt ] : [ tt, c ];
	const seg = (a, b, c, attrs) => { const p = P(a, c), q = P(b, c); return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" ${attrs}/>`; };
	const lit = s.light != 'off', reg = s.reg == 'ok', svc = reg ? t.services : [], dbm = line.dbm(t.optics.rx_nw);
	let out = '';

	/* feeder (ISP to splitter, not measured), drop fibre (measured), LAN side */
	out += seg(T[0], T[1], C, `style="stroke:${lit ? LEVEL.off : LEVEL.bad}" stroke-width="6" stroke-linecap="round"${lit ? '' : ' stroke-dasharray="2 10" opacity=".5"'}`);
	out += seg(T[1], T[2], C, `style="stroke:${LEVEL[s.light == 'off' ? 'bad' : s.light]}" stroke-width="6" stroke-linecap="round"${s.light == 'off' ? ' stroke-dasharray="2 10"' : !reg ? ' stroke-dasharray="14 8"' : ''}`);
	out += seg(T[2], T[3], C, `style="stroke:${LEVEL.off}" stroke-width="6" stroke-linecap="round"`);

	svc.forEach((sv, i) => {
		const o = (i - (svc.length - 1) / 2) * 5, bad = sv.kind == 'internet' && s.login == 'bad';
		out += seg(T[0], sv.ports.length ? T[3] : T[2], C + o,
			`style="stroke:${bad ? LEVEL.bad : LANE[sv.kind] || LANE.other};animation-delay:-${(i * 0.3).toFixed(1)}s" stroke-width="2.5"${bad ? '' : ' class="aw-pulse"'}`);
	});

	const nodes = [
		[ 'Your ISP', t.olt.vendor ? `OLT by ${t.olt.vendor}` : 'Their OLT', lit ? 'ok' : 'off' ],
		[ 'Splitter', 'Shared with neighbours', lit ? 'ok' : 'off' ],
		[ 'This box', [ lit ? PON_STATES[t.pon.state] || PON_STATES[0] : 'No light', t.optics.temp_c != null ? `${Math.round(t.optics.temp_c)} °C` : '' ].filter(Boolean).join(' · '), s.reg ],
		[ t.mode == 'bridge' ? 'Your router' : 'Your network', net, 'ok' ]
	];
	nodes.forEach(([ name, sub, lvl ], i) => {
		const p = P(T[i], C), lx = vertical ? C + R + 14 : T[i], ly = vertical ? T[i] - 4 : C + R + 22, anchor = vertical ? 'start' : 'middle';
		out += `<circle cx="${p[0]}" cy="${p[1]}" r="${R}" style="fill:var(--color-base-100);stroke:${LEVEL[lvl]}" stroke-width="3"/>`;
		out += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" font-weight="bold">${esc(name)}</text>`;
		out += `<text x="${lx}" y="${ly + 17}" text-anchor="${anchor}" opacity=".75">${esc(sub)}</text>`;
	});

	/* the light reading on the drop fibre */
	const m = P((T[1] + T[2]) / 2, C);
	out += `<text x="${vertical ? m[0] + 16 : m[0]}" y="${vertical ? m[1] : m[1] - 16}" text-anchor="${vertical ? 'start' : 'middle'}" style="fill:${LEVEL[s.light == 'off' ? 'bad' : s.light]}" font-weight="bold">${
		dbm == null || s.light == 'off' ? 'No light' : `${dbm.toFixed(1).replace('-', '−')} dBm`}</text>`;
	return `<svg viewBox="0 0 ${vertical ? 340 : 920} ${vertical ? 770 : 125}" class="w-full h-auto" font-size="13" fill="currentColor" role="img" aria-label="Fibre path from your ISP to your network">${out}</svg>`;
}

/* the drawing, the service legend and, when the ISP refused the login, the reason */
export function topology(t, ln, wanUp, net) {
	const s = states(t, ln, wanUp), vertical = matchMedia('(max-width: 639px)').matches;
	const pic = h('div', { class: vertical ? 'max-w-[360px] mx-auto' : 'max-w-[900px]' });
	pic.innerHTML = svg(t, s, net, vertical);
	return h('div', { class: 'space-y-3' }, pic,
		h('p', { class: 'flex flex-wrap gap-x-5 gap-y-1 text-sm' }, t.services.length && s.reg == 'ok'
			? t.services.map(sv => h('span', { class: 'whitespace-nowrap' },
				h('span', { class: 'inline-block w-6 h-1 rounded align-middle mr-1.5', style: `background:${sv.kind == 'internet' && s.login == 'bad' ? LEVEL.bad : LANE[sv.kind] || LANE.other}` }),
				`${KINDS[sv.kind] || sv.kind} · VLAN ${sv.vlan}`))
			: h('em', { class: 'opacity-70' }, s.reg == 'ok' ? 'No services provisioned yet.' : 'Services appear once your provider accepts the box.')),
		s.login == 'bad' && h('div', { role: 'alert', class: 'alert alert-soft alert-error text-sm' },
			`Fibre OK, the ISP refused the Internet login at ${s.said[0]}: “${s.said[1]}”`));
}
