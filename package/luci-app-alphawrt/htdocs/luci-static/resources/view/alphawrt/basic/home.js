'use strict';
'require view';
'require poll';
'require rpc';
'require uci';
'require network';

/*
 * Basic > Home: what the stock firmware's status page shows, at a glance.
 * Internet, fibre, Wi-Fi and the number of connected devices; refreshed
 * every 5 seconds.
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

var callLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { dhcp_leases: [] }
});

var PON_STATES = [ null, _('Initial'), _('Standby'), _('Serial number'),
	_('Ranging'), _('Registered'), _('Signal lost'), _('Stopped by the ISP') ];

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

function badge(ok, yes, no) {
	return E('span', { 'class': ok ? 'label success' : 'label warning' }, ok ? yes : no);
}

return view.extend({
	rx: null,

	load: function() {
		return Promise.all([
			L.resolveDefault(callPresets(), {}),
			uci.load([ 'alphawrt', 'wireless' ])
		]);
	},

	fetch: function() {
		return Promise.all([
			network.getWANNetworks(),
			network.getWifiNetworks(),
			L.resolveDefault(callOmciStatus(0), {}),
			L.resolveDefault(callLeases(), [])
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
		    leases = data[3] || [], assoc = data[4], isp, pon, cards;

		isp = (this.presets || []).filter(function(p) {
			return p.id == uci.get('alphawrt', 'setup', 'isp');
		})[0];

		if (st.bosa_rx_power_nw != null)
			this.rx = st.bosa_rx_power_nw;
		pon = (st.state == 5);

		cards = [
			card(_('Internet'), [
				[ _('Status'), badge(wan && wan.isUp(), _('Connected'), _('Not connected')) ],
				[ _('Provider'), isp ? isp.name : _('not set up') ],
				[ _('Internet address'), (wan && wan.getIPAddr()) || '-' ]
			], 'basic/quicksetup', _('Change provider')),

			card(_('Fibre'), [
				[ _('Status'), badge(pon, _('Registered'), PON_STATES[st.state] || _('No fibre')) ],
				[ _('Signal received'), (this.rx > 0) ? '%.1f dBm'.format(10 * Math.log10(this.rx / 1e6)) : '-' ]
			]),

			card(_('Wi-Fi'), wifi.map(function(n, i) {
				var band = (uci.get('wireless', n.get('device'), 'band') == '5g') ? _('5 GHz') : _('2.4 GHz');
				return [ '%s: %s'.format(band, n.getSSID() || '?'),
					n.isDisabled() ? badge(false, '', _('Off'))
						: E('span', {}, [ badge(true, _('On'), ''), ' ', _('%d connected').format(assoc[i].length) ]) ];
			}), 'basic/wifi', _('Change Wi-Fi')),

			card(_('Devices'), [
				[ _('Connected devices'), String(leases.length) ]
			], 'basic/devices', _('Show devices'))
		];

		node.replaceChildren.apply(node, cards);
	},

	render: function(data) {
		var self = this, node = E('div', { 'class': 'alphawrt-basic' }, E('p', {}, _('Loading…')));

		this.presets = (data[0] && data[0].presets) || [];

		/* first login, as on the stock firmware: start in Quick Setup */
		if (uci.get('alphawrt', 'setup', 'done') == '0') {
			try {
				if (!sessionStorage.getItem('alphawrt-quicksetup')) {
					sessionStorage.setItem('alphawrt-quicksetup', '1');
					location.href = L.url('basic/quicksetup');
				}
			} catch (e) {}
		}

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
