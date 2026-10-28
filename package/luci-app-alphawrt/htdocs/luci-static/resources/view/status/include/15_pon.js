'use strict';
'require baseclass';
'require rpc';
'require uci';

var callOmciStatus = rpc.declare({
	object: 'omci.agent',
	method: 'status',
	params: [ 'device' ],
	expect: { status: {} }
});

/* ITU-T G.984.3 activation states */
var STATES = [ null, _('O1 Initial'), _('O2 Standby'), _('O3 Serial number'),
	_('O4 Ranging'), _('O5 Operation'), _('O6 Intermittent loss of signal'),
	_('O7 Emergency stop') ];

function dbm(nw) {
	return (nw > 0) ? '%.2f dBm'.format(10 * Math.log10(nw / 1e6)) : '-';
}

return baseclass.extend({
	title: _('Fibre (PON)'),

	load: function() {
		return Promise.all([
			L.resolveDefault(callOmciStatus(0), {}),
			uci.load('alphawrt')
		]);
	},

	/* the agent leaves the optics fields out of some replies (a partial
	 * telemetry_valid mask): keep showing the last full reading */
	optics: {},

	render: function(data) {
		var st = data[0] || {}, o = this.optics, table, fields, nodes = [];

		[ 'bosa_rx_power_nw', 'bosa_tx_power_nw', 'bosa_temperature_mc', 'bosa_bias_ua' ].forEach(function(k) {
			if (st[k] != null)
				o[k] = st[k];
		});

		/* Quick Setup lives in the Simple UI, which offers it at login */
		if (uci.get('alphawrt', 'setup', 'done') == '0') {
			nodes.push(E('div', { 'class': 'alert-message notice' }, [
				_('This box is not set up for your ISP yet.'), ' ',
				E('a', { 'href': '/#/setup' }, _('Open Quick Setup'))
			]));
		}

		if (st.state == null)
			return E([], nodes.concat(E('p', {}, _('No PON status available.'))));

		fields = [
			_('State'), STATES[st.state] || String(st.state),
			_('ONU ID'), (st.onu_id == 65535) ? _('not assigned') : String(st.onu_id),
			_('RX power (1490 nm)'), dbm(o.bosa_rx_power_nw),
			_('TX power (1310 nm)'), dbm(o.bosa_tx_power_nw),
			_('Optics temperature'), (o.bosa_temperature_mc != null) ? '%.1f °C'.format(o.bosa_temperature_mc / 1000) : '-',
			_('Laser bias'), (o.bosa_bias_ua != null) ? '%.1f mA'.format(o.bosa_bias_ua / 1000) : '-',
			_('OMCI'), st.agent_operational ? _('in service') : _('waiting for the OLT')
		];

		table = E('table', { 'class': 'table' });
		for (var i = 0; i < fields.length; i += 2)
			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, [ fields[i] ]),
				E('td', { 'class': 'td left' }, [ fields[i + 1] ])
			]));

		nodes.push(table);
		return E([], nodes);
	}
});
