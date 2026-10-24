'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

/*
 * One page that gets the box online: ISP preset, GPON identity, Internet
 * (VLAN on pon0, PPPoE or DHCP), Wi-Fi and the admin password. Everything
 * except the password is staged as UCI changes and applied with rollback.
 * The OMCI agent picks up a committed "omci" change by itself.
 */

var callPresets = rpc.declare({
	object: 'alphawrt',
	method: 'presets'
});

var callStockIdentity = rpc.declare({
	object: 'alphawrt',
	method: 'stock_identity'
});

var callSetPassword = rpc.declare({
	object: 'luci',
	method: 'setPassword',
	params: [ 'username', 'password' ],
	expect: { result: false }
});

var IDENTITY = [ 'serial', 'password', 'equipment_id',
	'hardware_version', 'software_version_0', 'software_version_1',
	'omcc_version', 'traffic_management_option' ];

/* identity fields an ONT-model preset fills; serial and PLOAM password are
 * per unit and always come from the user. The vendor ID is not among them:
 * it is always the serial's first four characters (setting it separately
 * rewrites them, and the OLT would see a serial it never registered). */
var ONT_FIELDS = [ 'equipment_id', 'hardware_version',
	'software_version_0', 'software_version_1', 'traffic_management_option' ];

function wanVlan(device) {
	var m = /^pon0\.(\d+)$/.exec(device || '');
	return m ? m[1] : '0';
}

function presetById(presets, id) {
	return presets.filter(function(p) { return p.id == id; })[0];
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callPresets(), {}),
			uci.load([ 'alphawrt', 'network', 'omci', 'system', 'wireless' ])
		]);
	},

	setField: function(section, option, value) {
		var opt = this.map.lookupOption(option, section);
		if (opt && opt[0].getUIElement(section))
			opt[0].getUIElement(section).setValue(value);
	},

	render: function(data) {
		var self = this, presets = data[0].presets || [], onts = data[0].onts || [], m, s, o;
		var note = E('em', {}, '');
		var d = {
			isp: { isp: uci.get('alphawrt', 'setup', 'isp') || '' },
			pon: {},
			wan: {
				proto: uci.get('network', 'wan', 'proto') || 'dhcp',
				vlan: wanVlan(uci.get('network', 'wan', 'device')),
				username: uci.get('network', 'wan', 'username') || '',
				password: uci.get('network', 'wan', 'password') || ''
			},
			wifi: {},
			admin: { tz: '1' }
		};

		IDENTITY.forEach(function(k) {
			d.pon[k] = uci.get('omci', 'main', k) || '';
		});
		[ '0', '1' ].forEach(function(r) {
			d.wifi['ssid' + r] = uci.get('wireless', 'default_radio' + r, 'ssid') || '';
			d.wifi['key' + r] = uci.get('wireless', 'default_radio' + r, 'key') || '';
		});

		this.presets = presets;

		var ispNames = {};
		presets.forEach(function(p) { ispNames[p.id] = p.short; });
		m = this.map = new form.JSONMap(d, _('Quick Setup'),
			_('Get the box online in one page. Changes are applied with a connectivity check, like any other LuCI change, and can be changed again later from Quick Setup in the top bar.'));

		s = m.section(form.NamedSection, 'isp', 'isp', _('Internet provider'));
		o = s.option(form.ListValue, 'isp', _('Provider'),
			_('Fills in the VLAN, connection type and OMCC version. The values come from Malaysian community reports; check them against what your ISP tells you.'));
		o.value('', _('-- choose --'));
		presets.forEach(function(p) { o.value(p.id, p.name); });
		o.onchange = function(ev, sid, value) {
			var p = presetById(self.presets, value);
			note.textContent = p ? (p.note || '') : '';
			if (!p)
				return;
			self.setField('wan', 'proto', p.proto);
			self.setField('wan', 'vlan', String(p.vlan));
			self.setField('pon', 'omcc_version', p.omcc_version || '');
			/* setValue() fires no change event: show the PPPoE fields */
			self.map.checkDepends();
		};
		o = s.option(form.DummyValue, '_note', ' ');
		o.render = function() {
			var p = presetById(self.presets, d.isp.isp);
			note.textContent = p ? (p.note || '') : '';
			return E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-field' }, note)
			]);
		};

		s = m.section(form.NamedSection, 'pon', 'pon', _('Fibre (GPON) identity'),
			_('The ISP\'s OLT only accepts the ONT it has on record: the one your ISP installed. Pick its model, then copy the serial number and PLOAM password from its label and status page. Only if your ISP supplied this unit itself, use the identity saved by the stock firmware.'));

		o = s.option(form.ListValue, '_ont', _('ISP ONT model'),
			_('The ONT your ISP gave you. Fills in everything below except the serial number and PLOAM password, which are printed on that ONT.'));
		o.value('', _('-- keep the values below --'));
		onts.forEach(function(t) {
			var who = (t.isps || []).map(function(i) { return ispNames[i]; })
				.filter(function(n, i, a) { return n && a.indexOf(n) == i; });
			o.value(t.id, who.length ? '%s (%s)'.format(t.name, who.join(', ')) : t.name);
		});
		o.onchange = function(ev, sid, value) {
			var t = presetById(onts, value);
			if (t)
				ONT_FIELDS.forEach(function(k) { self.setField('pon', k, t[k] || ''); });
		};

		o = s.option(form.Button, '_stock', _('Stock identity'));
		o.inputtitle = _('Use the identity saved by the stock firmware');
		o.inputstyle = 'action';
		o.onclick = function() {
			var p = presetById(self.presets, self.map.lookupOption('isp', 'isp')[0].formvalue('isp'));
			if (p && p.stock_identity === false)
				return ui.addNotification(null, E('p', {},
					_('%s does not supply this unit, so its own identity is not registered there. Pick the ONT model your ISP gave you and copy its serial number and PLOAM password.').format(p.name)), 'warning');
			return callStockIdentity().then(function(r) {
				if (!r || r.error)
					return ui.addNotification(null, E('p', {}, (r && r.error) || _('Could not read the stock configuration')), 'warning');
				IDENTITY.forEach(function(k) {
					if (r[k] != null && r[k] !== '')
						self.setField('pon', k, r[k]);
				});
			});
		};

		o = s.option(form.Value, 'serial', _('GPON serial number'),
			_('4 vendor letters + 8 hex digits, as printed on the ONT, e.g. ZTEG1234ABCD.'));
		o.validate = function(sid, v) {
			return (!v || /^[A-Za-z0-9]{4}[0-9A-Fa-f]{8}$/.test(v)) ? true : _('Expected 4 characters + 8 hex digits');
		};

		o = s.option(form.Value, 'password', _('PLOAM password'),
			_('Up to 10 characters, or 20 hex digits. Leave empty if your ISP does not use one.'));
		o.password = true;
		o.validate = function(sid, v) {
			return (!v || v.length <= 10 || /^[0-9A-Fa-f]{20}$/.test(v)) ? true : _('Expected up to 10 characters or 20 hex digits');
		};

		o = s.option(form.Value, 'equipment_id', _('Equipment ID'), _('The ONT model as the OLT sees it.'));
		o.datatype = 'maxlength(20)';

		o = s.option(form.Value, 'hardware_version', _('Hardware version'));
		o.datatype = 'maxlength(14)';

		o = s.option(form.Value, 'software_version_0', _('Software version (image 0)'));
		o.datatype = 'maxlength(14)';

		o = s.option(form.Value, 'software_version_1', _('Software version (image 1)'));
		o.datatype = 'maxlength(14)';

		o = s.option(form.Value, 'omcc_version', _('OMCC version'),
			_('Decimal: 128 (0x80) for TM and TIME, 160 (0xA0) for Allo.'));
		o.datatype = 'range(0,255)';

		o = s.option(form.ListValue, 'traffic_management_option', _('Traffic management option'));
		o.value('', _('driver default'));
		o.value('0', _('0: priority controlled'));
		o.value('1', _('1: rate controlled'));
		o.value('2', _('2: priority and rate controlled'));

		s = m.section(form.NamedSection, 'wan', 'wan', _('Internet'));

		o = s.option(form.ListValue, 'proto', _('Connection type'));
		o.value('pppoe', _('PPPoE (username and password)'));
		o.value('dhcp', _('DHCP (automatic)'));

		o = s.option(form.Value, 'vlan', _('VLAN ID'), _('0 = untagged.'));
		o.datatype = 'range(0,4094)';

		o = s.option(form.Value, 'username', _('PPPoE username'));
		o.depends('proto', 'pppoe');

		o = s.option(form.Value, 'password', _('PPPoE password'));
		o.password = true;
		o.depends('proto', 'pppoe');

		s = m.section(form.NamedSection, 'wifi', 'wifi', _('Wi-Fi'),
			_('WPA2/WPA3 on both bands.'));
		[ [ '0', _('2.4 GHz') ], [ '1', _('5 GHz') ] ].forEach(function(b) {
			o = s.option(form.Value, 'ssid' + b[0], _('Network name (%s)').format(b[1]));
			o.datatype = 'maxlength(32)';
			o = s.option(form.Value, 'key' + b[0], _('Password (%s)').format(b[1]));
			o.password = true;
			o.datatype = 'wpakey';
		});

		s = m.section(form.NamedSection, 'admin', 'admin', _('Router'));
		o = s.option(form.Value, 'pw1', _('New admin password'), _('Leave empty to keep the current one.'));
		o.password = true;
		o = s.option(form.Value, 'pw2', _('Confirm admin password'));
		o.password = true;
		o.validate = function(sid, v) {
			var pw1 = this.section.formvalue(sid, 'pw1') || '';
			return (pw1 == (v || '')) ? true : _('The passwords do not match');
		};
		o = s.option(form.Flag, 'tz', _('Malaysian time zone'), _('Asia/Kuala Lumpur (UTC+8).'));

		return m.render().then(function(node) {
			return E([], [
				E('div', { 'class': 'alert-message warning' }, [
					E('strong', {}, _('Set the identity before you plug in the fibre.')), ' ',
					_('An ONT with the wrong identity raises alarms on the ISP\'s OLT, and repeated alarms can get the serial number blocked or the account suspended.')
				]),
				node
			]);
		});
	},

	write: function() {
		var d = this.map.data, presets = this.presets, g, p, vlan, sys, pw;

		g = function(s, o) { return String(d.get('json', s, o) || '').trim(); };
		p = presetById(presets, g('isp', 'isp'));

		IDENTITY.forEach(function(k) {
			uci.set('omci', 'main', k, g('pon', k));
		});
		/* the vendor ID is the serial's own first four characters */
		uci.set('omci', 'main', 'vendor_id', g('pon', 'serial').substr(0, 4));
		uci.set('omci', 'main', 'enabled', '1');
		if (p && p.olt_profile)
			uci.set('omci', 'main', 'olt_profile', p.olt_profile);

		vlan = +g('wan', 'vlan') || 0;
		if (!uci.get('network', 'wan'))
			uci.add('network', 'interface', 'wan');
		uci.set('network', 'wan', 'device', vlan ? 'pon0.' + vlan : 'pon0');
		uci.set('network', 'wan', 'proto', g('wan', 'proto') || 'dhcp');
		if (g('wan', 'proto') == 'pppoe') {
			uci.set('network', 'wan', 'username', g('wan', 'username'));
			uci.set('network', 'wan', 'password', g('wan', 'password'));
			uci.set('network', 'wan', 'ipv6', 'auto');
			if (uci.get('network', 'wan6'))
				uci.remove('network', 'wan6');
		}
		else {
			uci.unset('network', 'wan', 'username');
			uci.unset('network', 'wan', 'password');
			uci.unset('network', 'wan', 'ipv6');
			if (!uci.get('network', 'wan6'))
				uci.add('network', 'interface', 'wan6');
			uci.set('network', 'wan6', 'proto', 'dhcpv6');
			uci.set('network', 'wan6', 'device', '@wan');
		}

		[ '0', '1' ].forEach(function(r) {
			var sid = 'default_radio' + r;
			if (!uci.get('wireless', sid))
				return;
			if (g('wifi', 'ssid' + r))
				uci.set('wireless', sid, 'ssid', g('wifi', 'ssid' + r));
			if (g('wifi', 'key' + r)) {
				uci.set('wireless', sid, 'key', g('wifi', 'key' + r));
				uci.set('wireless', sid, 'encryption', 'sae-mixed');
				uci.set('wireless', sid, 'disabled', '0');
			}
		});

		if (g('admin', 'tz') == '1') {
			sys = uci.sections('system', 'system')[0];
			if (sys) {
				uci.set('system', sys['.name'], 'zonename', 'Asia/Kuala Lumpur');
				uci.set('system', sys['.name'], 'timezone', '<+08>-8');
			}
		}

		uci.set('alphawrt', 'setup', 'isp', g('isp', 'isp'));
		uci.set('alphawrt', 'setup', 'done', '1');

		pw = g('admin', 'pw1');
		return (pw ? callSetPassword('root', pw).then(function(ok) {
			if (!ok)
				throw new Error(_('Setting the admin password failed'));
		}) : Promise.resolve()).then(function() {
			return uci.save();
		});
	},

	handleSave: function(ev) {
		var self = this;
		return this.map.save().then(function() {
			return self.write();
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, e.message || e), 'danger');
			throw e;
		});
	},

	handleSaveApply: function(ev, mode) {
		return this.handleSave(ev).then(function() {
			ui.changes.apply(mode == '0');
		});
	},

	handleReset: null
});
