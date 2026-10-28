'use strict';
'require view';
'require poll';
'require rpc';
'require uci';
'require network';
'require alphawrt.line as line';

/*
 * Fibre topology: the path from the ISP's OLT through the splitter and the
 * fibre to this box and your network, with the services the ISP provisioned
 * drawn along it, then the OMCI detail behind it (T-CONTs, GEM ports, VLAN
 * rules, ME inventory), PLOAM and ranging, optics, counters and events.
 * Backend: alphawrt.fibre (topology, detail), shared with the Simple UI.
 * The export holds no serial number, PLOAM password or MAC address.
 */

var callTopology = rpc.declare({ object: 'alphawrt.fibre', method: 'topology' });
var callDetail = rpc.declare({ object: 'alphawrt.fibre', method: 'detail' });
var callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
var callWireless = rpc.declare({ object: 'luci-rpc', method: 'getWirelessDevices', expect: { '': {} } });
var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', params: [ 'family' ], expect: { dhcp_leases: [] } });

var PON_STATES = [ _('No fibre'), _('Initial (O1)'), _('Standby (O2)'), _('Serial number (O3)'),
	_('Ranging (O4)'), _('Registered (O5)'), _('Signal lost (O6)'), _('Stopped by the ISP (O7)') ];

var KINDS = { internet: _('Internet'), iptv: _('IPTV'), voice: _('Voice'), management: _('ISP management'), other: _('Other') };
/* luci-theme-alphawrt's palette (switches for dark mode), with fallbacks for other themes */
var LANE = { internet: 'var(--accent, #1f6fe5)', iptv: '#8b5cf6', voice: '#0d9488', management: '#a16207', other: 'var(--ink-3, #6b7280)' };
var LEVEL = { ok: 'var(--ok, #1a7f37)', warn: 'var(--warn, #b45309)', bad: 'var(--err, #c41e3a)', off: 'var(--line, #9ca3af)' };

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

function hex(n) { return n == null ? '-' : '0x%04x'.format(n); }
function bytes(n) { return '%1024.2mB'.format(n || 0); }

/* light against the OLT's limits: ok, warn (within 3 dB of the low limit or 1 dB of the high one), bad, off */
function lightLevel(t) {
	var d = line.dbm(t.optics.rx_nw), l = t.limits;
	if (d == null || d < -32 || t.pon.los)
		return 'off';
	if (d < l.rx_min || d > l.rx_max)
		return 'bad';
	return d < l.rx_min + 3 || d > l.rx_max - 1 ? 'warn' : 'ok';
}

/*
 * The line's state in three words for the drawing: light, registration and,
 * when the box dials, the Internet login.
 */
function states(t, ln, wanUp) {
	var light = lightLevel(t), st = t.pon.state, said = line.ispMessage(ln);
	return {
		light: light,
		reg: light == 'off' ? 'off' : st == 5 ? 'ok' : st == 7 ? 'bad' : 'warn',
		login: t.mode == 'bridge' ? null : wanUp ? 'ok' : said ? 'bad' : 'warn',
		said: said
	};
}

/*
 * The topology as inline SVG: ISP -> splitter -> fibre -> this box -> your
 * network, laid out along x on a wide screen and along y on a phone. One
 * thin lane per provisioned service rides on the path; lit lanes pulse.
 */
function drawing(t, s, net, vertical) {
	var T = vertical ? [ 40, 200, 470, 720 ] : [ 70, 270, 560, 790 ], C = 50, R = 24,
	    P = function(tt, c) { return vertical ? [ c, tt ] : [ tt, c ]; },
	    seg = function(a, b, c, attrs) {
		var p = P(a, c), q = P(b, c);
		return '<line x1="%d" y1="%d" x2="%d" y2="%d" %s/>'.format(p[0], p[1], q[0], q[1], attrs);
	    },
	    lit = s.light != 'off', reg = s.reg == 'ok',
	    svc = reg ? t.services : [],
	    dbm = line.dbm(t.optics.rx_nw), out = '';

	/* feeder (ISP to splitter, not measured), drop fibre (measured), LAN side */
	out += seg(T[0], T[1], C, 'style="stroke:%s" stroke-width="6" stroke-linecap="round"%s'.format(
		lit ? LEVEL.off : LEVEL.bad, lit ? '' : ' stroke-dasharray="2 10" opacity=".5"'));
	out += seg(T[1], T[2], C, 'style="stroke:%s" stroke-width="6" stroke-linecap="round"%s'.format(
		LEVEL[s.light == 'off' ? 'bad' : s.light], s.light == 'off' ? ' stroke-dasharray="2 10"' : !reg ? ' stroke-dasharray="14 8"' : ''));
	out += seg(T[2], T[3], C, 'style="stroke:%s" stroke-width="6" stroke-linecap="round"'.format(LEVEL.off));

	svc.forEach(function(sv, i) {
		var o = (i - (svc.length - 1) / 2) * 5, bad = sv.kind == 'internet' && s.login == 'bad';
		out += seg(T[0], sv.ports.length ? T[3] : T[2], C + o,
			'style="stroke:%s;animation-delay:-%.1fs" stroke-width="2.5" class="%s"'.format(bad ? LEVEL.bad : LANE[sv.kind], i * 0.3, bad ? '' : 'aw-pulse'));
	});

	var nodes = [
		[ _('Your ISP'), t.olt.vendor ? _('OLT by %s').format(t.olt.vendor) : _('Their OLT'), lit ? 'ok' : 'off' ],
		[ _('Splitter'), _('Shared with neighbours'), lit ? 'ok' : 'off' ],
		[ _('This box'), [ lit ? PON_STATES[t.pon.state] || PON_STATES[0] : _('No light'),
			t.optics.temp_c != null ? '%.0f °C'.format(t.optics.temp_c) : '' ].filter(String).join(' · '), s.reg ],
		[ t.mode == 'bridge' ? _('Your router') : _('Your network'), net, 'ok' ]
	];
	nodes.forEach(function(n, i) {
		var p = P(T[i], C), lx = vertical ? C + R + 14 : T[i], ly = vertical ? T[i] - 4 : C + R + 22,
		    anchor = vertical ? 'start' : 'middle';
		out += '<circle cx="%d" cy="%d" r="%d" style="fill:var(--surface, #fff);stroke:%s" stroke-width="3"/>'.format(p[0], p[1], R, LEVEL[n[2]]);
		out += '<text x="%d" y="%d" text-anchor="%s" font-weight="bold">%s</text>'.format(lx, ly, anchor, n[0]);
		out += '<text x="%d" y="%d" text-anchor="%s" opacity=".75">%s</text>'.format(lx, ly + 17, anchor, n[1]);
	});

	/* the light reading on the drop fibre */
	var m = P((T[1] + T[2]) / 2, C);
	out += '<text x="%d" y="%d" text-anchor="%s" style="fill:%s" font-weight="bold">%s</text>'.format(
		vertical ? m[0] + 16 : m[0], vertical ? m[1] : m[1] - 16, vertical ? 'start' : 'middle',
		LEVEL[s.light == 'off' ? 'bad' : s.light], dbm == null || s.light == 'off' ? _('No light') : '%.1f dBm'.format(dbm));

	var div = E('div', { 'style': vertical ? 'max-width:360px' : 'max-width:900px' });
	div.innerHTML = '<style>.aw-pulse{stroke-dasharray:3 13;animation:aw-flow 1.2s linear infinite}' +
		'@keyframes aw-flow{to{stroke-dashoffset:-16}}@media (prefers-reduced-motion:reduce){.aw-pulse{animation:none}}</style>' +
		'<svg viewBox="0 0 %d %d" style="width:100%%;height:auto" font-size="13" fill="currentColor" role="img" aria-label="%s">%s</svg>'.format(
			vertical ? 340 : 920, vertical ? 770 : 125, _('Fibre topology'), out);
	return div;
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('alphawrt'), uci.load('network') ]);
	},

	fetch: function() {
		return Promise.all([
			L.resolveDefault(callTopology(), null),
			L.resolveDefault(callDetail(), {}),
			line.load(),
			network.getWANNetworks(),
			L.resolveDefault(callDevices(), {}),
			L.resolveDefault(callWireless(), {}),
			L.resolveDefault(callLeases(4), [])
		]);
	},

	update: function(node, d) {
		var t = d[0], det = d[1] || {}, ln = d[2], wan = d[3][0], devs = d[4], radios = d[5], leases = d[6],
		    wanUp = !!(wan && wan.isUp()), s, lanUp, wifiOn, net, c;

		if (!t)
			return node.replaceChildren(E('p', {}, _('The fibre backend (alphawrt.fibre) is not answering.')));

		this.last = { topology: t, detail: det, events: ln.events };
		s = states(t, ln, wanUp);
		lanUp = [ 1, 2, 3, 4 ].filter(function(n) { var x = devs['lan' + n]; return x && x.link && x.link.carrier; });
		wifiOn = Object.keys(radios).filter(function(r) { return radios[r].up; }).length;
		net = t.mode == 'bridge'
			? _('On %s, dials the Internet').format(line.portName(uci.get('alphawrt', 'setup', 'port')))
			: _('%d LAN up · Wi-Fi %s · %d devices').format(lanUp.length, wifiOn ? _('on') : _('off'), leases.length);
		c = det.counters || {};

		node.replaceChildren(
			section(_('Topology'), E([], [
				drawing(t, s, net, window.matchMedia('(max-width: 639px)').matches),
				E('p', {}, t.services.length && s.reg == 'ok' ? t.services.map(function(sv) {
					return E('span', { 'style': 'margin-right:1.2em;white-space:nowrap' }, [
						E('span', { 'style': 'display:inline-block;width:1.4em;height:.3em;vertical-align:middle;margin-right:.3em;background:' +
							(sv.kind == 'internet' && s.login == 'bad' ? LEVEL.bad : LANE[sv.kind]) }),
						'%s · VLAN %d'.format(KINDS[sv.kind] || sv.kind, sv.vlan) ]);
				}) : E('em', {}, s.reg == 'ok' ? _('No services provisioned yet.') : _('Services appear once the ISP accepts the box.'))),
				s.login == 'bad' ? E('p', { 'class': 'alert-message danger' },
					_('Fibre OK, the ISP refused the Internet login at %s: "%s"').format(s.said[0], s.said[1])) : ''
			]), _('Your ISP\'s equipment (OLT) sends light through a splitter it shares with your neighbours, down your fibre to this box. Coloured lanes are the services the ISP set up on this line.')),

			section(_('Services'), table(t.services.map(function(sv) {
				return [ KINDS[sv.kind] || sv.kind, String(sv.vlan), sv.gem.join(', ') || '-', sv.alloc.join(', ') || '-',
					sv.ports.map(line.portName).join(', ') || _('this box'),
					sv.netdev ? '%s / %s'.format(bytes(sv.rx_bytes), bytes(sv.tx_bytes)) : '-' ];
			}), [ _('Service'), _('VLAN'), _('GEM ports'), _('Alloc-IDs'), _('Delivered to'), _('Received / sent') ]),
				_('Per GEM port and T-CONT traffic is not counted by the hardware; the traffic column is the VLAN interface on this box, where there is one.')),

			section(_('Registration and ranging'), table([
				[ _('PLOAM state'), PON_STATES[t.pon.state] || PON_STATES[0] ],
				[ _('ONU ID'), t.pon.state == 5 && t.pon.onu_id != null ? String(t.pon.onu_id) : '-' ],
				[ _('Equalisation delay (EqD)'), t.pon.eqd ? _('%d bytes + %d bits').format(t.pon.eqd.bytes, t.pon.eqd.bits) : _('not in the kernel log') ],
				[ _('Loss of signal'), t.pon.los ? _('yes') : _('no') ],
				[ _('FEC downstream / upstream'), '%s / %s'.format(t.pon.fec_down ? _('on') : _('off'), t.pon.fec_up ? _('on') : _('off')) ],
				[ _('OMCI channel'), t.pon.omci_up ? _('up, MIB sync %d').format(t.pon.mib_sync) : _('down') ],
				[ _('Multicast GEM port'), t.multicast_gem != null ? String(t.multicast_gem) : '-' ]
			]), _('The EqD is the delay the OLT adds so every box on the splitter answers in step. It includes the OLT\'s own padding, so it does not tell the fibre length.')),

			section(_('Optics'), table([
				[ _('Received light'), line.fmtDbm(t.optics.rx_nw) + ' ' + _('(ISP limits %s to %s dBm)').format(t.limits.rx_min, t.limits.rx_max) ],
				[ _('Sent light'), line.fmtDbm(t.optics.tx_nw) ],
				[ _('Temperature'), t.optics.temp_c != null ? '%.1f °C'.format(t.optics.temp_c) : '-' ],
				[ _('Supply voltage'), t.optics.voltage_v != null ? '%.2f V'.format(t.optics.voltage_v) : '-' ],
				[ _('Laser bias'), t.optics.bias_ma != null ? '%.1f mA'.format(t.optics.bias_ma) : '-' ],
				[ _('Alarms'), t.optics.alarms ? hex(t.optics.alarms) : _('none') ],
				[ _('Optics chip'), t.optics.model || '-' ]
			])),

			section(_('T-CONTs and GEM ports'), E([], [
				table((det.tconts || []).map(function(x) {
					return [ hex(x.me), String(x.alloc), [ _('none'), _('strict priority'), 'WRR' ][x.policy] || String(x.policy) ];
				}), [ _('T-CONT ME'), _('Alloc-ID'), _('Policy') ]),
				table((det.gems || []).map(function(x) {
					return [ String(x.me), String(x.port), hex(x.tcont_me), x.alloc != null ? String(x.alloc) : '-', x.dir || '-', hex(x.pq_me) ];
				}), [ _('GEM ME'), _('GEM port'), _('T-CONT ME'), _('Alloc-ID'), _('Direction'), _('Queue ME') ])
			]), _('Only the T-CONTs the OLT gave an Alloc-ID are listed.')),

			section(_('Bridge and VLAN rules'), E([], [
				table((det.bridge_ports || []).map(function(x) {
					var f = (det.vlan_filters || []).filter(function(v) { return v.me == x.me; })[0];
					return [ String(x.me), String(x.bridge), x.tp == 'lan' ? line.portName('lan' + (x.tp_me - 256)) : '%s %s'.format(x.tp, x.tp_me),
						f ? f.vids.join(', ') + ' (op %d)'.format(f.op) : '-' ];
				}), [ _('Bridge port ME'), _('Bridge'), _('Connects'), _('VLAN filter (ME 84)') ]),
				table((det.vlan_tagging || []).map(function(x) {
					return [ line.portName(x.port), String(x.vid), String(x.up_mode), String(x.down_mode) ];
				}), [ _('Port (ME 78)'), _('Upstream VLAN'), _('Upstream mode'), _('Downstream mode') ]),
				(det.ext_vlan || []).length ? table(det.ext_vlan.map(function(x) {
					return [ String(x.me), String(x.assoc_type), x.rules ? String(x.rules.length) : _('not decoded yet') ];
				}), [ _('Extended VLAN ME (171)'), _('Association'), _('Rules') ]) : ''
			])),

			section(_('OMCI MIB'), table((det.classes || []).map(function(x) {
				return [ String(x.class), x.name, String(x.count), x.origin ];
			}), [ _('Class'), _('Managed entity'), _('Instances'), _('Created by') ]),
				det.mib ? _('%d objects, MIB data sync %d.').format(det.mib.objects, det.mib.sync) : ''),

			section(_('Counters since boot'), table(Object.keys(c).map(function(k) { return [ k, String(c[k]) ]; }))),

			section(_('Events'), ln.events.length
				? E('pre', { 'style': 'white-space:pre-wrap' }, ln.events.slice(-50).reverse().join('\n'))
				: E('p', {}, _('Nothing logged yet.')))
		);
	},

	export: function() {
		if (!this.last)
			return;
		var a = E('a', {
			'href': URL.createObjectURL(new Blob([ JSON.stringify(Object.assign({ generated: new Date().toISOString() }, this.last), null, '\t') + '\n' ],
				{ type: 'application/json' })),
			'download': 'alphawrt-fibre-topology.json'
		});
		document.body.appendChild(a);
		a.click();
		a.remove();
	},

	render: function() {
		var self = this, node = E('div', {}, E('p', {}, _('Loading…')));
		var refresh = function() {
			return self.fetch().then(function(d) { self.update(node, d); });
		};
		refresh();
		poll.add(refresh, 10);

		return E([], [
			E('h2', {}, _('Fibre topology')),
			E('div', { 'class': 'right' }, E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': function() { self.export(); }
			}, _('Export'))),
			node
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
