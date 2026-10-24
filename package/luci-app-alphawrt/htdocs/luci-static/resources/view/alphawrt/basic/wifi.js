'use strict';
'require view';
'require form';
'require uci';

/*
 * Basic > Wi-Fi: on/off, network name and password for each band. The rest
 * of the radio settings stay in Advanced > Network > Wireless.
 */

var BANDS = [ [ 'default_radio0', _('2.4 GHz') ], [ 'default_radio1', _('5 GHz') ] ];

return view.extend({
	load: function() {
		return uci.load('wireless');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('wireless', _('Wi-Fi'),
			_('Change the network name and password, or switch a band off. Devices need to reconnect with the new password.'));

		BANDS.forEach(function(b) {
			if (!uci.get('wireless', b[0]))
				return;

			s = m.section(form.NamedSection, b[0], 'wifi-iface', b[1]);
			s.addremove = false;

			/* the band is on only if both the network and its radio are:
			 * Advanced can switch off either one */
			o = s.option(form.Flag, 'disabled', _('Wi-Fi on'));
			o.enabled = '0';
			o.disabled = '1';
			o.default = '0';
			o.rmempty = false;
			o.cfgvalue = function(sid) {
				var radio = uci.get('wireless', sid, 'device');
				return (uci.get('wireless', sid, 'disabled') == '1' ||
					uci.get('wireless', radio, 'disabled') == '1') ? '1' : '0';
			};
			o.write = function(sid, value) {
				uci.set('wireless', sid, 'disabled', value);
				if (value == '0')
					uci.unset('wireless', uci.get('wireless', sid, 'device'), 'disabled');
			};

			o = s.option(form.Value, 'ssid', _('Network name'));
			o.datatype = 'maxlength(32)';
			o.rmempty = false;

			o = s.option(form.Value, 'key', _('Password'), _('8 to 63 characters.'));
			o.password = true;
			o.datatype = 'wpakey';
			o.rmempty = false;
			/* a password always means WPA2/WPA3, never an open network */
			o.write = function(sid, value) {
				uci.set('wireless', sid, 'key', value);
				uci.set('wireless', sid, 'encryption', 'sae-mixed');
			};

			o = s.option(form.Flag, 'hidden', _('Hide network name'));
			o.default = '0';
		});

		if (!m.children.length)
			return E('p', {}, _('No Wi-Fi radios found.'));

		return m.render();
	}
});
