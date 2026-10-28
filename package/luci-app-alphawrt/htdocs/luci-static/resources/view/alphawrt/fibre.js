'use strict';
'require view';
'require poll';
'require rpc';
'require uci';
'require network';
'require alphawrt.line as line';

/*
 * Fibre diagnostics: verdict, light and laser (with a 24 h chart), line
 * error counters explained with the bit error rate against the ISP's
 * alarms, registration, Internet service checks (login history, delay and
 * loss to the ISP) and the event log, plus a text report for ISP tickets.
 * The report holds no serial number, PLOAM password or MAC address.
 */

var callOmciStatus = rpc.declare({
	object: 'omci.agent',
	method: 'status',
	params: [ 'device' ],
	expect: { status: {} }
});

var callPonInfo = rpc.declare({
	object: 'alphawrt',
	method: 'pon_info'
});

var callBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

var PON_STATES = [ _('No fibre'), _('Initial (O1)'), _('Standby (O2)'), _('Serial number (O3)'),
	_('Ranging (O4)'), _('Registered (O5)'), _('Signal lost (O6)'), _('Stopped by the ISP (O7)') ];

var ALERT = { ok: 'alert-message success', warn: 'alert-message', bad: 'alert-message danger' };

/* name, counter key in line.errors(), live counter, what it means */
var ERRORS = [
	[ _('Uncorrectable header errors (HEC)'), 'hecu', 'hec_uncorrectable',
		_('Damaged data headers that could not be repaired. The usual sign of a bent, dirty or damaged fibre; the stock firmware shows these as HEC errors.') ],
	[ _('Repaired header errors (HEC)'), 'hec1', 'hec_corrected_1bit',
		_('Headers with one damaged bit, repaired. A few are harmless; a steady stream is an early warning.') ],
	[ _('Repaired header errors, 2 bits'), 'hec2', 'hec_corrected_2bit',
		_('Headers with two damaged bits, repaired. More serious than one bit.') ],
	[ _('Bit errors (BIP)'), 'bip', 'bip_errors',
		_('Bit errors counted over the incoming signal. The box reports these to the ISP too.') ],
	[ _('Damaged frames (CRC)'), 'crc', 'rx_crc_errors',
		_('Data frames that arrived corrupted and were dropped.') ],
	[ _('Lost frame lock (LOF)'), 'lof', 'lof',
		_('Times the box lost track of the signal\'s framing: a short outage on the fibre.') ]
];

function table(rows, head) {
	return E('table', { 'class': 'table' }, (head ? [ E('tr', { 'class': 'tr table-titles' },
		head.map(function(h) { return E('th', { 'class': 'th' }, h); })) ] : []).concat(rows.map(function(r) {
		return E('tr', { 'class': 'tr' }, r.map(function(c, i) {
			return E('td', { 'class': 'td left', 'width': (!head && i == 0) ? '40%' : null }, c);
		}));
	})));
}

function section(title, content, help) {
	return E('div', { 'class': 'cbi-section' }, [ E('h3', {}, title), help ? E('p', {}, help) : '', content ]);
}

/*
 * 24 h chart of a history column as inline SVG. val(row) is a number, null
 * (no data: a gap) or NaN (an outage: a red mark); limit is a dashed line.
 */
function chart(ln, val, fmt, limit) {
	var W = 720, H = 140, PAD = 64, now = line.now(ln), COL = line.COL,
	    rows = ln.history.filter(function(r) { return r[COL.ts] >= now - 86400; }),
	    x0 = rows.length ? rows[0][COL.ts] : now, v, lo, hi, X, Y, d = '', marks = '', last = null, svg, div;

	v = rows.map(val).filter(function(y) { return y != null && !isNaN(y); });
	if (!v.length)
		return E('p', {}, _('No data yet.'));
	lo = Math.min.apply(null, v);
	hi = Math.max.apply(null, v);
	/* show the limit when it is near enough to matter */
	if (limit != null && limit > lo - 3 && limit < hi + 3) {
		lo = Math.min(lo, limit);
		hi = Math.max(hi, limit);
	}
	if (hi - lo < 2) {
		lo = (lo + hi) / 2 - 1;
		hi = lo + 2;
	}
	X = function(t) { return (PAD + (t - x0) / Math.max(now - x0, 60) * (W - PAD)).toFixed(1); };
	Y = function(y) { return (H - 20 - (y - lo) / (hi - lo) * (H - 30)).toFixed(1); };

	rows.forEach(function(r) {
		var y = val(r), t = r[COL.ts];
		if (y == null || isNaN(y)) {
			if (y != null)
				marks += '<rect x="%s" y="10" width="3" height="%d" fill="#d9534f" opacity=".6"/>'.format(X(t), H - 30);
			last = null;
			return;
		}
		/* a sample more than 3 min after the last one: the box was off */
		d += (last == null || t - last > 180 ? 'M' : 'L') + X(t) + ',' + Y(y);
		last = t;
	});

	svg = '<svg viewBox="0 0 %d %d" style="width:100%%;max-width:900px;height:auto" font-size="11" fill="currentColor">'.format(W, H) +
		'<text x="%d" y="14" text-anchor="end">%s</text><text x="%d" y="%d" text-anchor="end">%s</text>'.format(PAD - 6, fmt(hi), PAD - 6, H - 20, fmt(lo)) +
		'<text x="%d" y="%d">%s</text><text x="%d" y="%d" text-anchor="end">%s</text>'.format(PAD, H - 4,
			new Date(x0 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), W, H - 4, _('now')) +
		'<line x1="%d" y1="10" x2="%d" y2="%d" stroke="currentColor" opacity=".25"/><line x1="%d" y1="%d" x2="%d" y2="%d" stroke="currentColor" opacity=".25"/>'.format(PAD, PAD, H - 20, PAD, H - 20, W, H - 20) +
		(limit != null && limit >= lo && limit <= hi
			? '<line x1="%d" y1="%s" x2="%d" y2="%s" stroke="#d9534f" stroke-dasharray="4 4"/>'.format(PAD, Y(limit), W, Y(limit)) : '') +
		marks + '<path d="%s" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'.format(d);

	div = E('div');
	div.innerHTML = svg;
	return div;
}

function range(ln, col, fmt) {
	var r = line.range(ln, col);
	return r ? _('%s to %s').format(fmt(r[0]), fmt(r[1])) : '-';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load([ 'alphawrt', 'network' ]),
			L.resolveDefault(callBoard(), {})
		]);
	},

	fetch: function() {
		return Promise.all([
			L.resolveDefault(callOmciStatus(0), {}),
			line.load(),
			L.resolveDefault(callPonInfo(), {}),
			network.getWANNetworks()
		]);
	},

	update: function(node, d) {
		var st = d[0] || {}, ln = d[1], pon = d[2] || {}, wan = d[3][0],
		    mode = line.mode(), wanUp = !!(wan && wan.isUp()),
		    v = line.verdict(st, ln, mode[0], wanUp),
		    e15 = line.errors(ln, 900), e24 = line.errors(ln, 86400), thr = ln.thr,
		    pings = ln.history.filter(function(r) { return r[line.COL.ping] != null; }).map(function(r) { return r[line.COL.ping]; }),
		    logins = line.recent(ln, / (internet: |internet login failed|ISP says)/, 86400),
		    c = ln.counters, last = ln.history[ln.history.length - 1] || [],
		    mw = function(nw) { return line.fmtDbm(nw); },
		    fec = st.fec_downstream == 2;

		this.last = { st: st, ln: ln, pon: pon, mode: mode, wanUp: wanUp, v: v };

		node.replaceChildren(
			E('div', { 'class': ALERT[v.level] }, [ E('h4', {}, v.title), E('p', {}, v.text) ]),

			section(_('Light and laser'), table([
				[ _('Received light'), E('span', {}, [ mw(st.bosa_rx_power_nw), ' ',
					E('small', {}, _('(24 h: %s; good: %s to %s dBm)').format(range(ln, line.COL.rx, mw), thr.rxMin, thr.rxMax)) ]) ],
				[ _('Sent light'), mw(st.bosa_tx_power_nw) ],
				[ _('Laser current'), st.bosa_bias_ua ? '%.1f mA'.format(st.bosa_bias_ua / 1000) : '-' ],
				[ _('Optics temperature'), st.bosa_temperature_mc ? E('span', {}, [ '%.1f °C'.format(st.bosa_temperature_mc / 1000), ' ',
					E('small', {}, _('(24 h: %s)').format(range(ln, line.COL.temp, function(t) { return '%.0f °C'.format(t / 1000); }))) ]) : '-' ],
				[ _('Optics voltage'), st.bosa_voltage_uv ? '%.2f V'.format(st.bosa_voltage_uv / 1e6) : '-' ]
			]), _('Weak light means a dirty connector, a tight bend or a damaged fibre. A laser current that keeps rising at the same sent light means the laser is ageing.')),

			section(_('Received light, last 24 h'), chart(ln, function(r) {
				return r[line.COL.rx] > 0 ? line.dbm(r[line.COL.rx]) : NaN;
			}, function(y) { return '%.1f dBm'.format(y); }, thr.rxMin),
				_('Red marks: no light. The dashed line is the lowest light the box works with (%s dBm), when it is in range. A line that sags or jumps while nobody touched the fibre points to a loose connector or a fibre being bent.').format(thr.rxMin)),

			section(_('Line errors'), table(ERRORS.map(function(r) {
				return [ E('span', { 'title': r[3] }, [ r[0], E('br'), E('small', {}, r[3]) ]),
					String(c[r[2]] != null ? c[r[2]] : '-'), String(e15[r[1]]), String(e24[r[1]]) ];
			}).concat([ [ E('span', {}, [ _('Bit error rate'), E('br'), E('small', {},
				_('Bit errors per bit received, from BIP. The ISP\'s equipment alarms at %s (signal degraded) and %s (signal fail).').format('1e-' + thr.sd, '1e-' + thr.sf)) ]),
				'', line.fmtBer(line.ber(ln, 900)), line.fmtBer(line.ber(ln, 86400)) ],
				[ _('Error correction (FEC)'), fec
				? _('%d repaired, %d not repairable').format(c.fec_corrected_codewords || 0, c.fec_uncorrectable_codewords || 0)
				: _('Off (set by the ISP)'), '', '' ] ]),
				[ _('Counter'), _('Since boot'), _('Last 15 min'), _('Last 24 h') ])),

			section(_('Registration'), table([
				[ _('State'), PON_STATES[st.state] || PON_STATES[0] ],
				[ _('ONU ID'), st.state == 5 && st.onu_id != null ? String(st.onu_id) : '-' ],
				[ _('Internet VLAN from the ISP'), pon.vlan ? String(pon.vlan) : _('not provisioned yet') ]
			])),

			mode[0] == 'bridge' ? section(_('Internet'), table([
				[ _('Mode'), line.MODES.bridge ],
				[ _('Connection'), _('Made by your own router on %s').format(line.portName(mode[1])) ]
			]), _('Your router dials the Internet, so its login, delay and loss checks are on the router.')) : section(_('Internet'), E([], [
				table([
					[ _('Mode'), line.MODES[mode[0]] || mode[0] ],
					[ _('Connection'), wanUp ? _('Up for %s').format('%t'.format(wan.getUptime())) : _('Down') ],
					[ _('Drops in the last 24 h'), String(line.recent(ln, / internet: down$/, 86400).length) ],
					[ _('Delay to the ISP'), last[line.COL.ping] != null
						? _('%d ms, %d%% lost').format(last[line.COL.ping], last[line.COL.loss] || 0) : '-' ],
					[ _('Delay over 24 h'), pings.length ? _('average %d ms, worst %d ms').format(
						pings.reduce(function(a, b) { return a + b; }, 0) / pings.length, Math.max.apply(null, pings)) : '-' ]
				]),
				chart(ln, function(r) {
					return r[line.COL.loss] == 100 ? NaN : r[line.COL.ping];
				}, function(y) { return '%d ms'.format(y); }),
				logins.length ? E('pre', { 'style': 'white-space:pre-wrap' }, logins.slice(-10).reverse().join('\n')) : ''
			]), _('Once a minute the box pings the ISP\'s gateway (3 pings). Red marks: no reply at all. Below: Internet logins, drops and what the ISP\'s server said, last 24 h.')),

			section(_('Events'), ln.events.length
				? E('pre', { 'style': 'white-space:pre-wrap' }, ln.events.slice(-50).reverse().join('\n'))
				: E('p', {}, _('Nothing logged yet.')),
				_('Kept in memory since the last boot.'))
		);
	},

	report: function() {
		var l = this.last, b = this.board || {}, c, out;

		if (!l)
			return;
		c = l.ln.counters;
		out = [
			'AlphaWRT fibre report, %s'.format(new Date().toISOString()),
			'Firmware: %s %s, %s'.format(b.release && b.release.distribution || '', b.release && b.release.version || '', b.model || ''),
			'Mode: %s, ISP preset: %s'.format(l.mode[0], uci.get('alphawrt', 'setup', 'isp') || '-'),
			'Verdict: %s. %s'.format(l.v.title, l.v.text),
			'',
			'State: %s, ONU ID %s, Internet VLAN %s'.format(PON_STATES[l.st.state] || '-', l.st.onu_id, l.pon.vlan || '-'),
			'RX %s, TX %s, bias %s uA, temp %s mC, voltage %s uV'.format(line.fmtDbm(l.st.bosa_rx_power_nw),
				line.fmtDbm(l.st.bosa_tx_power_nw), l.st.bosa_bias_ua, l.st.bosa_temperature_mc, l.st.bosa_voltage_uv),
			'FEC downstream: %s'.format(l.st.fec_downstream == 2 ? 'on' : 'off'),
			'OLT thresholds: SF 1e-%d, SD 1e-%d, light %s to %s dBm'.format(l.ln.thr.sf, l.ln.thr.sd, l.ln.thr.rxMin, l.ln.thr.rxMax),
			'Bit error rate: 15 min %s, 24 h %s'.format(line.fmtBer(line.ber(l.ln, 900)), line.fmtBer(line.ber(l.ln, 86400))),
			'Internet: %s'.format(l.wanUp ? 'up' : 'down'),
			'',
			'Counters since boot:'
		].concat(Object.keys(c).map(function(k) { return '  %s=%s'.format(k, c[k]); }),
			[ '', 'History (ts state rx_nw tx_nw bias_ua temp_mc hec1 hec2 hecu crc bip lof fec_cw fec_ucw ping_ms loss_pct rx_frames):' ],
			l.ln.history.map(function(r) { return '  ' + r.map(function(x) { return x == null ? '-' : x; }).join(' '); }),
			[ '', 'Events:' ], l.ln.events.map(function(e) { return '  ' + e; }));

		var a = E('a', {
			'href': URL.createObjectURL(new Blob([ out.join('\n') + '\n' ], { type: 'text/plain' })),
			'download': 'alphawrt-fibre-report.txt'
		});
		document.body.appendChild(a);
		a.click();
		a.remove();
	},

	render: function(data) {
		var self = this, node = E('div', {}, E('p', {}, _('Loading…')));

		this.board = data[1];

		var refresh = function() {
			return self.fetch().then(function(d) { self.update(node, d); });
		};
		refresh();
		poll.add(refresh, 5);

		return E([], [
			E('h2', {}, _('Fibre')),
			E('div', { 'class': 'right' }, E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': function() { self.report(); }
			}, _('Download report'))),
			node
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
