/*
 * Fibre line data and the plain-language verdict, ported from
 * luci-app-alphawrt's alphawrt/line.js (keep the two in step until the LuCI
 * pages are retired).
 */
import { maybe, uci, list } from './rpc.js';

/* printf subset the verdict texts use: %s %d %.Nf */
function fmt(s, ...a) {
	let i = 0;
	return s.replace(/%(\.(\d+))?([sdf])/g, (m, p, n, t) => {
		const v = a[i++];
		return t == 'f' ? Number(v).toFixed(n == null ? 6 : +n) : t == 'd' ? String(Math.trunc(v)) : String(v);
	});
}

/* history columns, as written by alphawrt-linemon */
var COL = { ts: 0, state: 1, rx: 2, tx: 3, bias: 4, temp: 5, hec1: 6, hec2: 7,
	hecu: 8, crc: 9, bip: 10, lof: 11, feccw: 12, fecucw: 13, ping: 14, loss: 15, frames: 16 };

/* bits in one 125 us downstream frame at 2.48832 Gbit/s */
var FRAME_BITS = 311040;

function dbm(nw) {
	return nw > 0 ? 10 * Math.log10(nw / 1e6) : null;
}

/* counters are 32-bit in hardware: a wrap is a small positive step */
function delta(a, b) {
	var d = b - a;
	return d >= 0 ? d : d + 4294967296;
}

export default {
	COL: COL,
	/* the receiver's own limit, for pages without line data */
	RX_MIN: -28,

	MODES: {
		combo: 'Combo (fibre and router)',
		router: 'Router',
		bridge: 'Bridge (fibre only)'
	},

	/*
	 * Operating mode: what Quick Setup saved, else what the network config
	 * looks like (a LAN port bridged to a pon0 VLAN = bridge, WAN on a LAN
	 * port = router). Needs uci 'alphawrt' and 'network' loaded.
	 * Returns [ mode, LAN port of the bridge or the router WAN ].
	 */
	mode: function() {
		var lan = function(p) { return /^lan\d/.test(p) },
		    br = uci.sections('network', 'device').filter(function(d) {
			var p = list(d.ports);
			/* br-iptv is combo mode's IPTV port (Quick Setup), not bridge mode */
			return d.type == 'bridge' && d.name != 'br-iptv' && p.some(lan) &&
				p.some(function(x) { return /^pon\d/.test(x) });
		})[0],
		    wan = (uci.get('network', 'wan', 'device') || '').split('.')[0],
		    mode = uci.get('alphawrt', 'setup', 'mode');

		if (!mode)
			mode = br ? 'bridge' : lan(wan) ? 'router' : 'combo';

		return [ mode, br ? list(br.ports).filter(lan)[0] : lan(wan) ? wan : null ];
	},

	portName: function(p) {
		return p ? p.replace(/^lan(\d+)$/, function(m, n) { return fmt('LAN %s', n) }) : '?';
	},

	dbm: dbm,

	fmtDbm: function(nw) {
		var d = dbm(nw);
		return d == null ? 'no light' : fmt('%.1f dBm', d);
	},

	load: function() {
		return maybe('alphawrt', 'line').then(function(r) {
			/* the OLT's ANI-G thresholds (linemon falls back to G.988's
			 * SF 1e-5 / SD 1e-9 and the receiver's -28 to -8 dBm) */
			var c = {}, t = (r.thresholds || '').split(' ').map(Number);
			(r.counters || '').split(/\s+/).forEach(function(kv) {
				var i = kv.indexOf('=');
				if (i > 0)
					c[kv.substr(0, i)] = +kv.substr(i + 1);
			});
			return {
				counters: c,
				thr: t.length == 4 ? { sf: t[0], sd: t[1], rxMin: t[2] / 10, rxMax: t[3] / 10 }
					: { sf: 5, sd: 9, rxMin: -28, rxMax: -8 },
				history: (r.history || []).map(function(l) {
					return l.split(' ').map(function(v) { return v == '-' ? null : +v; });
				}),
				events: r.events || []
			};
		});
	},

	/*
	 * "Now" on the box's clock: its latest history sample (one a minute). In
	 * bridge mode the box has no Internet, so its clock is often hours or a
	 * day off the browser's, and the browser clock would empty every window.
	 */
	now: function(line) {
		var h = line.history;
		return h.length ? h[h.length - 1][COL.ts] : Date.now() / 1000;
	},

	/* error counts over the last <seconds>, from the history plus now */
	errors: function(line, seconds) {
		var h = line.history, c = line.counters, now = this.now(line),
		    first = null, i, out = {};

		for (i = 0; i < h.length; i++)
			if (h[i][COL.ts] >= now - seconds) {
				first = h[i];
				break;
			}

		[ [ 'hec1', 'hec_corrected_1bit' ], [ 'hec2', 'hec_corrected_2bit' ],
		  [ 'hecu', 'hec_uncorrectable' ], [ 'crc', 'rx_crc_errors' ],
		  [ 'bip', 'bip_errors' ], [ 'lof', 'lof' ],
		  [ 'feccw', 'fec_corrected_codewords' ],
		  [ 'fecucw', 'fec_uncorrectable_codewords' ], [ 'frames', 'rx_frames' ] ].forEach(function(k) {
			out[k[0]] = (first && first[COL[k[0]]] != null && c[k[1]] != null) ? delta(first[COL[k[0]]], c[k[1]]) : 0;
		});
		return out;
	},

	/* downstream bit error rate (BIP) over the last <seconds>, or null */
	ber: function(line, seconds) {
		var e = this.errors(line, seconds);
		return e.frames > 0 ? e.bip / (e.frames * FRAME_BITS) : null;
	},

	fmtBer: function(ber) {
		return ber == null ? '-' : ber == 0 ? '0' : ber.toExponential(0);
	},

	/* events of the last <seconds> matching re */
	recent: function(line, re, seconds) {
		var since = (this.now(line) - seconds) * 1000;
		return line.events.filter(function(e) {
			return re.test(e) && new Date(e.substr(0, 19).replace(' ', 'T')) >= since;
		});
	},

	/* the upstream-stall detector fired and nothing cleared it since */
	stalled: function(line) {
		for (var i = line.events.length - 1; i >= 0; i--) {
			if (/ upstream stall: /.test(line.events[i]))
				return true;
			if (/ (upstream moving again|monitor started)$/.test(line.events[i]))
				return false;
		}
		return false;
	},

	/* the ISP server's last login message ("You are already logged in…"),
	 * unless the Internet came up after it: [ time, text ] or null */
	ispMessage: function(line) {
		for (var i = line.events.length - 1; i >= 0; i--) {
			var m = /^(\S+ \S+) (internet: up|ISP says: (.*))$/.exec(line.events[i]);
			if (m)
				return m[3] ? [ m[1], m[3] ] : null;
		}
		return null;
	},

	/* min / max of a history column over the last 24 h, ignoring no-light */
	range: function(line, col) {
		var v = line.history.map(function(r) { return r[col]; })
			.filter(function(x) { return x > 0; });
		return v.length ? [ Math.min.apply(null, v), Math.max.apply(null, v) ] : null;
	},

	/*
	 * st: omci.agent status, mode: combo|router|bridge, wanUp: bool.
	 * Returns { level: 'ok'|'warn'|'bad', title, text }.
	 */
	verdict: function(st, line, mode, wanUp) {
		var d = dbm(st.bosa_rx_power_nw), e = this.errors(line, 900), ber = this.ber(line, 900),
		    thr = line.thr, RX_MIN = thr.rxMin, RX_LOW = thr.rxMin + 3, RX_MAX = thr.rxMax,
		    /* BIP is judged by its rate against the OLT's alarms when the
		     * frame count is known, else any BIP error counts */
		    hard = e.hecu + e.lof + e.crc + (ber == null ? e.bip : 0),
		    light = this.fmtDbm(st.bosa_rx_power_nw), said = this.ispMessage(line),
		    drops = this.recent(line, /Deactivate_ONU-ID/, 900).length;

		if (mode == 'router')
			return { level: 'ok', title: 'Fibre not used',
				text: 'In router mode the Internet comes in on a LAN port, so this box\'s fibre is idle.' };

		if (st.state == 7)
			return { level: 'bad', title: 'Stopped by the ISP',
				text: 'The ISP\'s equipment has switched this box off (emergency stop). This usually means the serial number is blocked or not registered. Unplug the fibre and call the ISP.' };

		if (d == null || d < -32)
			return { level: 'bad', title: 'No light from the fibre',
				text: 'No light is reaching the box. Check that the fibre is clicked in at both ends and not bent or pinched. If it is, the fibre is probably broken or the ISP side is down: call the ISP.' };

		if (st.state != 5)
			return d < RX_MIN
				? { level: 'bad', title: 'Light too weak to register',
					text: fmt('The light (%s) is below the %s dBm the box needs. Clean and reseat the connector and look for sharp bends; if that does not help, the fibre is damaged.', light, RX_MIN) }
				: drops > 1
				? { level: 'bad', title: 'The ISP keeps dropping the box',
					text: fmt('The light is fine (%s), but the ISP\'s equipment dropped the registration %d times in the last 15 minutes (Deactivate_ONU-ID). Check the serial number, PLOAM password and ONT model in Quick Setup; if they are right, the fault is on the ISP\'s side: download the report and send it to the ISP.', light, drops) }
				: { level: 'warn', title: 'Not accepted by the ISP yet',
					text: fmt('The light is fine (%s), but the ISP\'s equipment has not accepted the box. Check the serial number and PLOAM password in Quick Setup; if they are right, the ISP may not have them on record.', light) };

		if (d < RX_MIN)
			return { level: 'bad', title: 'Light too weak',
				text: fmt('The light (%s) is below the %s dBm limit: usually a dirty connector or a tight bend. Clean and reseat the connector and look for sharp bends.', light, RX_MIN) };

		if (this.stalled(line))
			return { level: 'bad', title: 'Upload stuck',
				text: 'The fibre is registered, but the box has sent nothing upstream for over 30 seconds although data is waiting. This is a fault in the box, not the line. If it does not clear within a minute, restart the box and download the report first.' };

		if (ber != null && ber >= Math.pow(10, -thr.sf))
			return d < RX_LOW
				? { level: 'bad', title: 'Signal failing, weak light',
					text: fmt('The bit error rate (%s) in the last 15 minutes is past the ISP\'s signal-fail alarm (1e-%d) and the light is low (%s): the fibre or connector on your side is the likely cause (bend, dirt or damage).', this.fmtBer(ber), thr.sf, light) }
				: { level: 'bad', title: 'Signal failing with good light',
					text: fmt('The bit error rate (%s) in the last 15 minutes is past the ISP\'s signal-fail alarm (1e-%d) although the light is normal (%s). That points to the ISP\'s side. Download the report and send it to the ISP.', this.fmtBer(ber), thr.sf, light) };

		if (hard > 0)
			return d < RX_LOW
				? { level: 'bad', title: 'Line errors, weak light',
					text: fmt('%d uncorrectable errors in the last 15 minutes and the light is low (%s): the fibre or connector on your side is the likely cause (bend, dirt or damage).', hard, light) }
				: { level: 'bad', title: 'Line errors with good light',
					text: fmt('%d uncorrectable errors in the last 15 minutes although the light is normal (%s). That points to the ISP\'s side (their splitter or equipment). Download the report and send it to the ISP.', hard, light) };

		if (ber != null && ber >= Math.pow(10, -thr.sd))
			return { level: 'warn', title: 'Signal degraded',
				text: fmt('The bit error rate (%s) in the last 15 minutes is past the ISP\'s signal-degrade alarm (1e-%d), so the ISP sees this line as degraded. %s', this.fmtBer(ber), thr.sd,
					d < RX_LOW ? fmt('The light is low (%s): clean and reseat the connector and look for sharp bends.', light)
						: fmt('The light is normal (%s), which points to the ISP\'s side.', light)) };

		if (d > RX_MAX)
			return { level: 'warn', title: 'Light too strong',
				text: fmt('The light (%s) is above %s dBm and can overload the receiver. This is rare; the ISP may need to add an attenuator.', light, RX_MAX) };

		if (st.bosa_temperature_mc > 85000)
			return { level: 'warn', title: 'Optics running hot',
				text: fmt('The optics are at %.0f °C. Give the box more air.', st.bosa_temperature_mc / 1000) };

		if (e.hec1 + e.hec2 + (ber == null ? 0 : e.bip) > 0 || d < RX_LOW)
			return { level: 'warn', title: 'Signal is marginal',
				text: fmt('The light is %s with %d repaired or minor errors in the last 15 minutes. It works, but a connector clean or a gentler fibre bend would give more margin.', light, e.hec1 + e.hec2 + (ber == null ? 0 : e.bip)) };

		if (mode != 'bridge' && !wanUp && said)
			return { level: 'warn', title: 'Fibre OK, the ISP refused the login',
				text: fmt('The fibre is healthy, but the ISP\'s server turned the Internet login down at %s, saying: "%s". "Already logged in" clears by itself within a few minutes (the ISP still holds an older session) and the box keeps retrying; anything else usually means a wrong PPPoE username or password, or an account problem to raise with the ISP.', said[0], said[1]) };

		if (mode != 'bridge' && !wanUp)
			return { level: 'warn', title: 'Fibre OK, Internet login failed',
				text: 'The fibre is healthy, but the Internet connection is not up. Check the PPPoE username and password in Quick Setup. If you just moved the line from another router, the ISP may still hold that router\'s session for a few minutes ("already logged in"); the box keeps retrying. The event log on the Fibre page shows what the ISP said.' };

		return { level: 'ok', title: 'Fibre is healthy',
			text: fmt('Light %s, no line errors in the last 15 minutes.', light) };
	}
};
