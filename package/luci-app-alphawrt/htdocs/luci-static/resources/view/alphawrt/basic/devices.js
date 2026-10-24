'use strict';
'require view';
'require poll';
'require rpc';
'require network';
'require uci';

/*
 * Basic > Devices: every device with a DHCP lease, and how it is connected
 * (cable, or Wi-Fi band and signal). Refreshed every 5 seconds.
 */

var callLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { dhcp_leases: [] }
});

return view.extend({
	load: function() {
		return uci.load('wireless');
	},

	fetch: function() {
		return Promise.all([
			L.resolveDefault(callLeases(), []),
			network.getWifiNetworks()
		]).then(function(r) {
			return Promise.all(r[1].map(function(n) {
				return L.resolveDefault(n.getAssocList(), []).then(function(list) {
					var band = (uci.get('wireless', n.get('device'), 'band') == '5g') ? _('5 GHz') : _('2.4 GHz');
					return list.map(function(a) { return { mac: a.mac.toUpperCase(), band: band, signal: a.signal }; });
				});
			})).then(function(assoc) {
				var wifi = {};
				[].concat.apply([], assoc).forEach(function(a) { wifi[a.mac] = a; });
				return [ r[0], wifi ];
			});
		});
	},

	update: function(table, data) {
		var leases = data[0], wifi = data[1], rows;

		rows = leases.map(function(l) {
			var mac = (l.macaddr || '').toUpperCase(), w = wifi[mac];
			return [
				l.hostname || _('(no name)'),
				l.ipaddr || '-',
				mac,
				w ? _('Wi-Fi %s (%d dBm)').format(w.band, w.signal) : _('Cable or other')
			];
		});

		table.replaceChildren(E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Name')),
			E('th', { 'class': 'th' }, _('Address')),
			E('th', { 'class': 'th' }, _('MAC')),
			E('th', { 'class': 'th' }, _('Connection'))
		]));

		if (!rows.length)
			table.appendChild(E('tr', { 'class': 'tr placeholder' },
				E('td', { 'class': 'td', 'colspan': 4 }, _('No devices connected.'))));

		rows.forEach(function(r) {
			table.appendChild(E('tr', { 'class': 'tr' }, r.map(function(c) {
				return E('td', { 'class': 'td' }, c);
			})));
		});
	},

	render: function() {
		var self = this, table = E('table', { 'class': 'table' });
		var refresh = function() {
			return self.fetch().then(function(d) { self.update(table, d); });
		};

		refresh();
		poll.add(refresh, 5);

		return E([], [
			E('h2', {}, _('Devices')),
			E('div', { 'class': 'cbi-section' }, table)
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
