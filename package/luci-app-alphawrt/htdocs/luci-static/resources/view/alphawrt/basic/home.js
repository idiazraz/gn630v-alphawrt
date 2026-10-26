'use strict';
'require view';
'require poll';
'require rpc';
'require uci';
'require network';
'require alphawrt.line as line';

/*
 * Basic > Home: what the stock firmware's status page shows, at a glance.
 * Internet (per operating mode), fibre with a line verdict, Wi-Fi, the
 * number of connected devices and the box's own addresses; refreshed every
 * 5 seconds.
 */

var callOmciStatus = rpc.declare({
	object: 'omci.agent',
	method: 'status',
	params: [ 'device' ],
	expect: { status: {} }
});

var callPresets = rpc.declare({
	object: 'alphawrt',
	method: 'presets'
});

var callBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

var callLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { dhcp_leases: [] }
});

var PON_STATES = [ null, _('Initial'), _('Standby'), _('Serial number'),
	_('Ranging'), _('Registered'), _('Signal lost'), _('Stopped by the ISP') ];

var LEVEL = { ok: 'label success', warn: 'label warning', bad: 'label important' };

function card(title, rows, link, linkText) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
		E('table', { 'class': 'table' }, rows.map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '40%' }, r[0]),
				E('td', { 'class': 'td left' }, r[1])
			]);
		})),
		link ? E('div', { 'class': 'right' }, E('a', { 'class': 'btn cbi-button', 'href': L.url(link) }, linkText)) : ''
	]);
}

/* dnsmasq forwarding to dnsproxy means encrypted DNS: name its upstreams */
function dnsServers(wan) {
	var port = uci.get('dnsproxy', 'global', 'listen_port');

	if (uci.get('dnsproxy', 'global', 'enabled') == '1' &&
	    L.toArray(uci.get('dhcp', '@dnsmasq[0]', 'server')).indexOf('127.0.0.1#' + port) > -1)
		return _('Encrypted via %s').format(L.toArray(uci.get('dnsproxy', 'servers', 'upstream')).map(function(u) {
			return u.replace(/^\w+:\/\/|\/.*$/g, '');
		}).join(', '));

	return (wan && wan.getDNSAddrs().join(', ')) || '-';
}

function badge(ok, yes, no) {
	return E('span', { 'class': ok ? 'label success' : 'label warning' }, ok ? yes : no);
}

return view.extend({
	rx: null,

	load: function() {
		return Promise.all([
			L.resolveDefault(callPresets(), {}),
			uci.load([ 'alphawrt', 'wireless', 'network' ]),
			L.resolveDefault(callBoard(), {}),
			/* may be missing: keep them apart so the page still loads */
			L.resolveDefault(uci.load('dhcp'), null),
			L.resolveDefault(uci.load('dnsproxy'), null)
		]);
	},

	fetch: function() {
		return Promise.all([
			network.getWANNetworks(),
			network.getWifiNetworks(),
			L.resolveDefault(callOmciStatus(0), {}),
			L.resolveDefault(callLeases(), []),
			L.resolveDefault(network.getDevice(line.mode()[1] || 'lan1'), null),
			line.load(),
			L.resolveDefault(network.getNetwork('lan'), null)
		]).then(function(r) {
			return Promise.all(r[1].map(function(n) {
				return L.resolveDefault(n.getAssocList(), []);
			})).then(function(assoc) {
				r.push(assoc);
				return r;
			});
		});
	},

	update: function(node, data) {
		var wan = data[0][0], wifi = data[1], st = data[2] || {},
		    leases = data[3] || [], port = data[4], ln = data[5], lan = data[6], assoc = data[7],
		    mode = line.mode(), wanUp = !!(wan && wan.isUp()), isp, pon, v, cards, internet, box,
		    lanIP = (lan && lan.getIPAddr()) || String(uci.get('network', 'lan', 'ipaddr') || '-').split('/')[0];

		isp = (this.presets || []).filter(function(p) {
			return p.id == uci.get('alphawrt', 'setup', 'isp');
		})[0];

		/* telemetry can be missing in a single poll: keep the last reading */
		if (st.bosa_rx_power_nw != null)
			this.rx = st.bosa_rx_power_nw;
		st.bosa_rx_power_nw = this.rx;
		pon = (st.state == 5);
		v = line.verdict(st, ln, mode[0], wanUp);

		/* in bridge mode the router on the bridged port dials the Internet */
		if (mode[0] == 'bridge')
			internet = [
				[ _('Mode'), line.MODES.bridge ],
				[ _('Status'), !pon ? badge(false, '', _('Waiting for the fibre'))
					: badge(port && port.getCarrier(), _('Passing through to %s').format(line.portName(mode[1])),
						_('No router on %s').format(line.portName(mode[1]))) ],
				[ _('Provider'), isp ? isp.name : _('not set up') ],
				[ _('Internet address'), _('Shown on your own router') ]
			];
		else {
			var said = !wanUp && line.ispMessage(ln);
			internet = [
				[ _('Mode'), line.MODES[mode[0]] || mode[0] ],
				[ _('Status'), E('span', {}, [ badge(wanUp, _('Connected'), _('Not connected')),
					/* why the login failed, as netifd reports it (e.g. authentication) */
					(!wanUp && wan && wan.getErrors()) ? ' ' + wan.getErrors().join(' ') : '' ]) ]
			].concat(said ? [
				/* the ISP server's own words, e.g. "You are already logged in" */
				[ _('Your ISP says'), E('span', {}, [ E('strong', {}, '“%s”'.format(said[1])), ' ',
					E('small', {}, _('(%s)').format(said[0])) ]) ]
			] : [], [
				[ _('Provider'), isp ? isp.name : _('not set up') ],
				[ _('Internet address'), (wan && wan.getIPAddr()) || '-' ],
				[ _('Gateway'), (wan && wan.getGatewayAddr()) || '-' ],
				[ _('DNS'), dnsServers(wan) ]
			]);
		}

		/* in bridge mode the box answers only the bridged router, on the management address */
		box = [ [ _('Firmware'), (this.board.release && this.board.release.description) || '-' ] ].concat(
			mode[0] == 'bridge' ? [
				[ _('Management address'), _('%s (from the router on %s)').format(
					uci.get('network', 'gnmgmt', 'ipaddr') || '192.168.100.1', line.portName(mode[1])) ],
				[ _('Address on the other ports and Wi-Fi'), lanIP ]
			] : [
				[ _('Address on LAN ports and Wi-Fi'), lanIP ]
			]);

		cards = [
			card(_('Internet'), internet, 'basic/quicksetup', _('Change setup')),

			card(_('Fibre'), mode[0] == 'router' ? [
				[ _('Status'), _('Not used in router mode') ]
			] : [
				[ _('Status'), badge(pon, _('Registered'), PON_STATES[st.state] || _('No fibre')) ],
				[ _('Signal received'), line.fmtDbm(this.rx) ],
				[ _('Line quality'), E('span', {}, [ E('span', { 'class': LEVEL[v.level] }, v.title), ' ', v.text ]) ]
			], 'basic/fibre', _('Fibre details')),

			card(_('Wi-Fi'), wifi.map(function(n, i) {
				var band = (uci.get('wireless', n.get('device'), 'band') == '5g') ? _('5 GHz') : _('2.4 GHz');
				return [ '%s: %s'.format(band, n.getSSID() || '?'),
					n.isDisabled() ? badge(false, '', _('Off'))
						: E('span', {}, [ badge(true, _('On'), ''), ' ', _('%d connected').format(assoc[i].length) ]) ];
			}), 'basic/wifi', _('Change Wi-Fi')),

			card(_('Devices'), [
				[ _('Connected devices'), String(leases.length) ]
			], 'basic/devices', _('Show devices')),

			card(_('This box'), box, 'basic/system', _('System'))
		];

		node.replaceChildren.apply(node, cards);
	},

	render: function(data) {
		var self = this, node = E('div', { 'class': 'alphawrt-basic' }, E('p', {}, _('Loading…')));

		this.presets = (data[0] && data[0].presets) || [];
		this.board = data[2] || {};

		/*
		 * First login, as on the stock firmware: start in Quick Setup. Once
		 * set up, an advanced user lands in the full interface instead (once
		 * per session, so the Basic link in the top bar still works).
		 */
		try {
			if (!sessionStorage.getItem('alphawrt-landing')) {
				sessionStorage.setItem('alphawrt-landing', '1');
				if (uci.get('alphawrt', 'setup', 'done') == '0')
					location.href = L.url('basic/quicksetup');
				else if (uci.get('alphawrt', 'setup', 'ui') == 'advanced')
					location.href = L.url('admin/status/overview');
			}
		} catch (e) {}

		var refresh = function() {
			return self.fetch().then(function(d) { self.update(node, d); });
		};
		refresh();
		poll.add(refresh, 5);

		return E([], [ E('h2', {}, _('Home')), node ]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
