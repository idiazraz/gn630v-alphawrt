'use strict';
'require baseclass';
'require rpc';
'require uci';

/*
 * Fibre line data shared by Basic > Home and the Fibre page: the line
 * monitor's history (see alphawrt-linemon), error counts over a time
 * window and a plain-language verdict.
 */

var callLine = rpc.declare({
	object: 'alphawrt',
	method: 'line'
});

/* history columns, as written by alphawrt-linemon */
var COL = { ts: 0, state: 1, rx: 2, tx: 3, bias: 4, temp: 5, hec1: 6, hec2: 7,
	hecu: 8, crc: 9, bip: 10, lof: 11, feccw: 12, fecucw: 13, ping: 14, loss: 15 };

/* receiver range: TM accepts this box at 28 dB loss (-28 dBm); overload -8 dBm */
var RX_MIN = -28, RX_LOW = -25, RX_MAX = -8;

function dbm(nw) {
	return nw > 0 ? 10 * Math.log10(nw / 1e6) : null;
}

/* counters are 32-bit in hardware: a wrap is a small positive step */
function delta(a, b) {
	var d = b - a;
	return d >= 0 ? d : d + 4294967296;
}

return baseclass.extend({
	COL: COL,
	RX_MIN: RX_MIN,

	MODES: {
		combo: _('Combo (fibre and router)'),
		router: _('Router'),
		bridge: _('Bridge (fibre only)')
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
			var p = L.toArray(d.ports);
			return d.type == 'bridge' && p.some(lan) &&
				p.some(function(x) { return /^pon\d/.test(x) });
		})[0],
		    wan = (uci.get('network', 'wan', 'device') || '').split('.')[0],
		    mode = uci.get('alphawrt', 'setup', 'mode');

		if (!mode)
			mode = br ? 'bridge' : lan(wan) ? 'router' : 'combo';

		return [ mode, br ? L.toArray(br.ports).filter(lan)[0] : lan(wan) ? wan : null ];
	},

	portName: function(p) {
		return p ? p.replace(/^lan(\d+)$/, function(m, n) { return _('LAN %s').format(n) }) : '?';
	},

	dbm: dbm,

	fmtDbm: function(nw) {
		var d = dbm(nw);
		return d == null ? _('no light') : '%.1f dBm'.format(d);
	},

	load: function() {
		return L.resolveDefault(callLine(), {}).then(function(r) {
			var c = {};
			(r.counters || '').split(/\s+/).forEach(function(kv) {
				var i = kv.indexOf('=');
				if (i > 0)
					c[kv.substr(0, i)] = +kv.substr(i + 1);
			});
			return {
				counters: c,
				history: (r.history || []).map(function(l) {
					return l.split(' ').map(function(v) { return v == '-' ? null : +v; });
				}),
				events: r.events || []
			};
		});
	},

	/* error counts over the last <seconds>, from the history plus now */
	errors: function(line, seconds) {
		var h = line.history, c = line.counters, now = Date.now() / 1000,
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
		  [ 'fecucw', 'fec_uncorrectable_codewords' ] ].forEach(function(k) {
			out[k[0]] = (first && c[k[1]] != null) ? delta(first[COL[k[0]]], c[k[1]]) : 0;
		});
		return out;
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
		var d = dbm(st.bosa_rx_power_nw), e = this.errors(line, 900),
		    hard = e.hecu + e.bip + e.lof + e.crc, light = this.fmtDbm(st.bosa_rx_power_nw);

		if (mode == 'router')
			return { level: 'ok', title: _('Fibre not used'),
				text: _('In router mode the Internet comes in on a LAN port, so this box\'s fibre is idle.') };

		if (st.state == 7)
			return { level: 'bad', title: _('Stopped by the ISP'),
				text: _('The ISP\'s equipment has switched this box off (emergency stop). This usually means the serial number is blocked or not registered. Unplug the fibre and call the ISP.') };

		if (d == null || d < -32)
			return { level: 'bad', title: _('No light from the fibre'),
				text: _('No light is reaching the box. Check that the fibre is clicked in at both ends and not bent or pinched. If it is, the fibre is probably broken or the ISP side is down: call the ISP.') };

		if (st.state != 5)
			return d < RX_MIN
				? { level: 'bad', title: _('Light too weak to register'),
					text: _('The light (%s) is below the %d dBm the box needs. Clean and reseat the connector and look for sharp bends; if that does not help, the fibre is damaged.').format(light, RX_MIN) }
				: { level: 'warn', title: _('Not accepted by the ISP yet'),
					text: _('The light is fine (%s), but the ISP\'s equipment has not accepted the box. Check the serial number and PLOAM password in Quick Setup; if they are right, the ISP may not have them on record.').format(light) };

		if (d < RX_MIN)
			return { level: 'bad', title: _('Light too weak'),
				text: _('The light (%s) is below the %d dBm limit: usually a dirty connector or a tight bend. Clean and reseat the connector and look for sharp bends.').format(light, RX_MIN) };

		if (hard > 0)
			return d < RX_LOW
				? { level: 'bad', title: _('Line errors, weak light'),
					text: _('%d uncorrectable errors in the last 15 minutes and the light is low (%s): the fibre or connector on your side is the likely cause (bend, dirt or damage).').format(hard, light) }
				: { level: 'bad', title: _('Line errors with good light'),
					text: _('%d uncorrectable errors in the last 15 minutes although the light is normal (%s). That points to the ISP\'s side (their splitter or equipment). Download the report and send it to the ISP.').format(hard, light) };

		if (d > RX_MAX)
			return { level: 'warn', title: _('Light too strong'),
				text: _('The light (%s) is above %d dBm and can overload the receiver. This is rare; the ISP may need to add an attenuator.').format(light, RX_MAX) };

		if (st.bosa_temperature_mc > 85000)
			return { level: 'warn', title: _('Optics running hot'),
				text: _('The optics are at %.0f °C. Give the box more air.').format(st.bosa_temperature_mc / 1000) };

		if (e.hec1 + e.hec2 > 0 || d < RX_LOW)
			return { level: 'warn', title: _('Signal is marginal'),
				text: _('The light is %s with %d repaired errors in the last 15 minutes. It works, but a connector clean or a gentler fibre bend would give more margin.').format(light, e.hec1 + e.hec2) };

		if (mode != 'bridge' && !wanUp)
			return { level: 'warn', title: _('Fibre OK, Internet login failed'),
				text: _('The fibre is healthy, but the Internet connection is not up. Check the PPPoE username and password in Quick Setup. If you just moved the line from another router, the ISP may still hold that router\'s session for a few minutes ("already logged in"); the box keeps retrying. The event log on the Fibre page shows what the ISP said.') };

		return { level: 'ok', title: _('Fibre is healthy'),
			text: _('Light %s, no line errors in the last 15 minutes.').format(light) };
	}
});
