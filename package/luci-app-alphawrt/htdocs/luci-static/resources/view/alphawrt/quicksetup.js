'use strict';
'require view';
'require uci';
'require rpc';
'require ui';
'require alphawrt.line as line';

/*
 * First-boot wizard, one step per page:
 *   password -> Basic or Advanced -> ISP -> mode (combo / router / bridge)
 *   -> settings for that mode, prefilled from the ISP preset
 *   -> fibre (combo/bridge): save the identity, then plug in the fibre and
 *      watch it register; the Internet VLAN the OLT provisions wins over
 *      the preset -> finish.
 * The password and the GPON identity are applied when their step is done;
 * network, Wi-Fi and time zone are staged as UCI changes and applied at the
 * end with LuCI's rollback, so a mode that cuts the user off reverts.
 */

var callPresets = rpc.declare({ object: 'alphawrt', method: 'presets' });
var callStockIdentity = rpc.declare({ object: 'alphawrt', method: 'stock_identity' });
var callPonInfo = rpc.declare({ object: 'alphawrt', method: 'pon_info' });
var callOmciStatus = rpc.declare({
	object: 'omci.agent', method: 'status', params: [ 'device' ], expect: { status: {} }
});
var callSetIdentity = rpc.declare({
	object: 'alphawrt', method: 'set_identity',
	params: [ 'serial', 'password', 'equipment_id', 'hardware_version', 'software_version_0',
		'software_version_1', 'omcc_version', 'traffic_management_option', 'olt_profile' ]
});
var callSetPassword = rpc.declare({
	object: 'luci', method: 'setPassword', params: [ 'username', 'password' ], expect: { result: false }
});

var IDENTITY = [ 'serial', 'password', 'equipment_id', 'hardware_version',
	'software_version_0', 'software_version_1', 'omcc_version', 'traffic_management_option' ];

/* identity fields an ONT-model preset fills; serial and PLOAM password are
 * per unit and always come from the user. The vendor ID is always the
 * serial's first four characters (set_identity derives it). */
var ONT_FIELDS = [ 'equipment_id', 'hardware_version',
	'software_version_0', 'software_version_1', 'traffic_management_option' ];

var LAN_PORTS = [ 'lan1', 'lan2', 'lan3', 'lan4' ];

/* combo mode can give this port to the ISP's IPTV box, bridged to the IPTV
 * VLAN (br-iptv), as the stock firmware does for Unifi */
var IPTV_PORT = 'lan4';

/* eye icon for the show/hide password button */
function EYE() {
	var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), p, c;
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', '18');
	svg.setAttribute('height', '18');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('aria-hidden', 'true');
	p = document.createElementNS(ns, 'path');
	p.setAttribute('d', 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z');
	c = document.createElementNS(ns, 'circle');
	c.setAttribute('cx', '12');
	c.setAttribute('cy', '12');
	c.setAttribute('r', '3');
	svg.appendChild(p);
	svg.appendChild(c);
	return svg;
}

/* "48575443xxxxxxxx" (vendor as hex, as some ISPs print it) -> "HWTCxxxxxxxx" */
function normalizeSerial(v) {
	v = (v || '').trim();
	if (/^[0-9A-Fa-f]{16}$/.test(v)) {
		var vendor = v.substr(0, 8).match(/../g).map(function(h) {
			return String.fromCharCode(parseInt(h, 16));
		}).join('');
		if (/^[A-Z0-9]{4}$/.test(vendor))
			return vendor + v.substr(8).toUpperCase();
	}
	return /^[A-Za-z0-9]{4}[0-9A-Fa-f]{8}$/.test(v) ? v.substr(0, 4).toUpperCase() + v.substr(4).toUpperCase() : v;
}

function byId(list, id) {
	return (list || []).filter(function(p) { return p.id == id; })[0];
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callPresets(), {}),
			uci.load([ 'alphawrt', 'firewall', 'network', 'omci', 'system', 'wireless' ])
		]);
	},

	render: function(data) {
		var d = this.d = {}, wan = uci.get('network', 'wan', 'device') || '', m;

		this.presets = data[0].presets || [];
		this.onts = data[0].onts || [];
		this.first = uci.get('alphawrt', 'setup', 'done') != '1';

		IDENTITY.forEach(function(k) { d[k] = uci.get('omci', 'main', k) || ''; });
		m = /^(pon0|lan\d)(?:\.(\d+))?$/.exec(wan);
		d.isp = uci.get('alphawrt', 'setup', 'isp') || '';
		d.ui = uci.get('alphawrt', 'setup', 'ui') || 'basic';
		d.mode = line.mode()[0];
		d.port = line.mode()[1] || 'lan1';
		d.proto = uci.get('network', 'wan', 'proto') || 'pppoe';
		/* the VLAN is on the WAN device (combo/router) or on the bridge's
		 * pon0 port (bridge); a fresh box falls back to the ISP preset */
		d.vlan = m && m[2] ? m[2] : '';
		uci.sections('network', 'device').forEach(function(s) {
			L.toArray(s.ports).forEach(function(p) {
				var v = /^pon0\.(\d+)$/.exec(p);
				if (v && s.name == 'br-iptv') {
					d.iptv = true;
					d.iptv_vlan = v[1];
				}
				else if (v && !d.vlan)
					d.vlan = v[1];
			});
		});
		if (!d.vlan && (byId(this.presets, d.isp) || {}).vlan)
			d.vlan = String(byId(this.presets, d.isp).vlan);
		if (!d.iptv_vlan && (byId(this.presets, d.isp) || {}).iptv_vlan)
			d.iptv_vlan = String(byId(this.presets, d.isp).iptv_vlan);
		d.username = uci.get('network', 'wan', 'username') || '';
		d.ppp_password = uci.get('network', 'wan', 'password') || '';
		d.wifi_keep = false;
		/* trunk: an existing bridge on pon0 itself, else the ISP's default */
		d.trunk = uci.sections('network', 'device').some(function(s) {
			return s.type == 'bridge' && L.toArray(s.ports).indexOf('pon0') >= 0;
		}) || !!(byId(this.presets, d.isp) || {}).bridge_trunk;
		[ '0', '1' ].forEach(function(r) {
			d['ssid' + r] = uci.get('wireless', 'default_radio' + r, 'ssid') || '';
			d['key' + r] = uci.get('wireless', 'default_radio' + r, 'key') || '';
		});
		d.tz = true;
		d.pw1 = d.pw2 = '';

		this.step = 0;
		this.node = E('div', { 'class': 'alphawrt-wizard' });
		this.draw();
		return E([], [ E('h2', {}, _('Quick Setup')), this.node ]);
	},

	steps: function() {
		return [ 'password', 'ui', 'isp', 'mode', 'settings' ]
			.concat(this.d.mode == 'router' ? [] : [ 'fibre' ], [ 'finish' ]);
	},

	preset: function() {
		return byId(this.presets, this.d.isp);
	},

	/* ---- small form helpers bound to this.d ---- */

	field: function(label, key, guide, opts) {
		var self = this, o = opts || {}, input;

		if (o.choices) {
			input = E('select', { 'class': 'cbi-input-select', 'change': function(ev) {
				self.d[key] = ev.target.value;
				if (o.onchange)
					o.onchange(ev.target.value);
			} }, o.choices.map(function(c) {
				return E('option', { 'value': c[0], 'selected': (String(self.d[key]) == c[0]) ? '' : null }, c[1]);
			}));
		}
		else {
			input = E('input', {
				'class': 'cbi-input-text',
				'type': o.password ? 'password' : 'text',
				'value': self.d[key] != null ? self.d[key] : '',
				'placeholder': o.placeholder || '',
				'autocomplete': o.password ? 'new-password' : 'off',
				'input': function(ev) { self.d[key] = ev.target.value; }
			});
		}

		/* show/hide what was typed */
		if (o.password)
			input = E('div', { 'style': 'display:flex;gap:.5em;align-items:center' }, [
				input,
				E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'type': 'button',
					'title': _('Show / hide password'),
					'aria-label': _('Show / hide password'),
					'click': function(ev) {
						var i = ev.currentTarget.previousElementSibling;
						i.type = (i.type == 'password') ? 'text' : 'password';
						ev.currentTarget.setAttribute('aria-pressed', i.type == 'text');
					}
				}, E('span', { 'style': 'display:inline-flex' }, EYE()))
			]);

		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, label),
			E('div', { 'class': 'cbi-value-field' }, [
				input, guide ? E('div', { 'class': 'cbi-value-description' }, guide) : ''
			])
		]);
	},

	choice: function(key, options, onpick) {
		var self = this;
		return E('div', {}, options.map(function(o) {
			return E('label', { 'class': 'cbi-value', 'style': 'display:flex;gap:.75em;align-items:flex-start;cursor:pointer' }, [
				E('input', { 'type': 'radio', 'name': key, 'value': o[0], 'checked': self.d[key] == o[0] ? '' : null,
					'change': function() { self.d[key] = o[0]; if (onpick) onpick(o[0]); } }),
				E('span', {}, [ E('strong', {}, o[1]), o[2] ? E('br') : '', o[2] ? E('small', {}, o[2]) : '' ])
			]);
		}));
	},

	/* ---- steps: each returns { title, body, check } ---- */

	step_password: function() {
		return {
			title: _('Admin password'),
			body: E([], [
				E('p', {}, this.first
					? _('Choose the password for this web interface and SSH (user "root"). The box has none yet, so anyone on your network could change it.')
					: _('Leave both empty to keep the current password.')),
				this.field(_('New password'), 'pw1', _('At least 8 characters.'), { password: true }),
				this.field(_('Confirm password'), 'pw2', null, { password: true })
			]),
			check: L.bind(function() {
				var d = this.d;
				if (!d.pw1 && !this.first)
					return null;
				if ((d.pw1 || '').length < 8)
					return _('The password needs at least 8 characters.');
				if (d.pw1 != d.pw2)
					return _('The passwords do not match.');
				return callSetPassword('root', d.pw1).then(function(ok) {
					if (!ok)
						return _('Setting the password failed.');
					d.pw1 = d.pw2 = '';
				});
			}, this)
		};
	},

	step_ui: function() {
		return {
			title: _('Basic or advanced?'),
			body: this.choice('ui', [
				[ 'basic', _('Basic'), _('Simple pages like the ISP\'s own router: Internet, fibre, Wi-Fi, devices. Recommended.') ],
				[ 'advanced', _('Advanced'), _('The full OpenWrt interface with every setting. You can switch any time from the top bar.') ]
			])
		};
	},

	step_isp: function() {
		var self = this;
		return {
			title: _('Your Internet provider'),
			body: E([], [
				E('p', {}, _('The listed choices only preselect a connection type. VLAN and ONT identity values are left for you to enter from your own ISP equipment or verified line settings.')),
				this.choice('isp', this.presets.map(function(p) { return [ p.id, p.name, '' ]; }), function(id) {
					var p = byId(self.presets, id);
					if (!p)
						return;
					self.d.proto = p.proto;
					self.d.vlan = p.vlan ? String(p.vlan) : '';
					self.d.omcc_version = p.omcc_version || self.d.omcc_version;
					self.d.olt_profile = p.olt_profile || '';
					self.d.trunk = !!p.bridge_trunk;
					self.d.iptv_vlan = p.iptv_vlan ? String(p.iptv_vlan) : '';
					if (!p.iptv_vlan)
						self.d.iptv = false;
				})
			]),
			check: L.bind(function() { return this.d.isp ? null : _('Pick your provider (or Other).'); }, this)
		};
	},

	step_mode: function() {
		return {
			title: _('How will you use this box?'),
			body: this.choice('mode', [
				[ 'combo', _('Combo: fibre and router'), _('The fibre goes into this box and it does everything: Internet login, Wi-Fi, home network. It replaces the ISP\'s box.') ],
				[ 'bridge', _('Bridge: fibre only'), _('This box only converts the fibre. Your own router, on one LAN port, does the Internet login and Wi-Fi.') ],
				[ 'router', _('Router: behind the ISP\'s fibre box'), _('Keep the ISP\'s fibre box; connect it to one LAN port of this box, which then works as your router.') ]
			])
		};
	},

	identity: function() {
		var self = this, p = this.preset(), ispNames = {}, list;

		this.presets.forEach(function(x) { ispNames[x.id] = x.short; });
		list = this.onts.filter(function(t) { return !p || !t.isps || t.isps.indexOf(p.id) >= 0 || p.id == 'other'; });

		return E([], [
			E('h4', {}, _('Fibre identity')),
			E('p', {}, [ E('strong', {}, _('Copy these from the fibre box your ISP installed.')), ' ',
				_('Use the identity of the ONT registered on your line. Do not guess these values; ask your ISP if they are not shown on its label or status page.') ]),
			p && p.note ? E('p', {}, E('small', {}, p.note)) : '',
			this.onts.length ? this.field(_('ISP fibre box model'), 'ont', _('Choose a model only when its identity values have been independently verified.'), {
				choices: [ [ '', _('-- choose --') ] ].concat(list.map(function(t) { return [ t.id, t.name ]; })),
				onchange: function(id) {
					var t = byId(self.onts, id);
					if (t)
						ONT_FIELDS.forEach(function(k) { self.d[k] = t[k] || ''; });
					self.draw();
				}
			}) : E('p', {}, _('No ONT identity presets are included yet. Enter model details below only when you can verify them from the ISP-provided unit.')),
			this.field(_('GPON serial number'), 'serial',
				_('On the label of your ISP fibre box ("GPON SN" or "ONT SN"), or on its status page. Use the format accepted by your ISP.'),
				{ placeholder: _('Enter the ISP-registered serial') }),
			this.field(_('PLOAM password'), 'password',
				_('Also called the ONT password or registration ID. Leave empty if your ISP does not use one.'), { password: true }),
			(p && p.stock_identity) ? E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, ' '),
				E('div', { 'class': 'cbi-value-field' }, [
					E('button', { 'class': 'btn cbi-button', 'click': function(ev) {
						ev.preventDefault();
						callStockIdentity().then(function(r) {
							if (!r || r.error)
								return ui.addNotification(null, E('p', {}, (r && r.error) || _('Could not read the stock configuration')), 'warning');
							IDENTITY.forEach(function(k) { if (r[k]) self.d[k] = r[k]; });
							self.draw();
						});
					} }, _('Use the identity saved by the stock firmware')),
					E('div', { 'class': 'cbi-value-description' }, _('Only if your ISP supplied this GN630V itself.'))
				])
			]) : '',
			E('details', {}, [
				E('summary', {}, _('Model details (filled in by the model above)')),
				this.field(_('Equipment ID'), 'equipment_id'),
				this.field(_('Hardware version'), 'hardware_version'),
				this.field(_('Software version (image 0)'), 'software_version_0'),
				this.field(_('Software version (image 1)'), 'software_version_1'),
				this.field(_('OMCC version'), 'omcc_version', _('Enter this only if your ISP or a verified stock configuration provides it.'))
			])
		]);
	},

	internet: function(router) {
		var p = this.preset();
		return E([], [
			E('h4', {}, _('Internet login')),
			this.field(_('Connection type'), 'proto', null, {
				choices: [ [ 'pppoe', _('PPPoE (username and password)') ], [ 'dhcp', _('Automatic (DHCP)') ] ],
				onchange: L.bind(this.draw, this)
			}),
			this.d.proto == 'pppoe' ? E([], [
				this.field(_('PPPoE username'), 'username', _('From your ISP\'s welcome email or their self-care portal.')),
				this.field(_('PPPoE password'), 'ppp_password', null, { password: true })
			]) : '',
			this.field(_('VLAN ID'), 'vlan', router
				? _('Usually empty: the ISP\'s fibre box sends the Internet untagged. Only set it if your ISP says so.')
				: _('Filled in from the provider (%s). Once the fibre is registered, the VLAN your ISP\'s equipment sends replaces it.').format(p && p.vlan ? p.vlan : _('untagged')))
		]);
	},

	wifi: function() {
		return E([], [
			E('h4', {}, _('Wi-Fi')),
			this.field(_('Network name (2.4 GHz)'), 'ssid0'),
			this.field(_('Password (2.4 GHz)'), 'key0', _('At least 8 characters.'), { password: true }),
			this.field(_('Network name (5 GHz)'), 'ssid1'),
			this.field(_('Password (5 GHz)'), 'key1', null, { password: true })
		]);
	},

	portField: function(guide) {
		return this.field(_('LAN port'), 'port', guide, {
			choices: LAN_PORTS.map(function(p) { return [ p, line.portName(p) ]; })
		});
	},

	step_settings: function() {
		var self = this, d = this.d, body;

		if (d.mode == 'combo')
			body = [ this.identity(), this.internet(false),
				d.iptv_vlan ? E([], [
					E('h4', {}, _('IPTV')),
					E('label', { 'class': 'cbi-value', 'style': 'display:flex;gap:.75em' }, [
						E('input', { 'type': 'checkbox', 'checked': d.iptv ? '' : null,
							'change': function(ev) { d.iptv = ev.target.checked; } }),
						E('span', {}, [ _('IPTV box on %s (VLAN %s)').format(line.portName(IPTV_PORT), d.iptv_vlan), E('br'),
							E('small', {}, _('%s then passes the ISP\'s IPTV VLAN straight to the IPTV box, as the ISP\'s own fibre box does; the other LAN ports and Wi-Fi stay on the Internet. Leave off if you have no IPTV box: %s stays a normal LAN port.').format(line.portName(IPTV_PORT), line.portName(IPTV_PORT))) ])
					])
				]) : '',
				this.wifi() ];
		else if (d.mode == 'router')
			body = [
				E('h4', {}, _('Connection to the ISP box')),
				this.portField(_('Plug the ISP\'s fibre box into this port. Do not pick the port your computer is on.')),
				this.internet(true), this.wifi()
			];
		else
			body = [
				this.identity(),
				E('h4', {}, _('Your router')),
				this.portField(_('Plug your own router\'s WAN/Internet port into this port. Do not pick the port your computer is on; the other ports keep this page at 192.168.1.1, and your router can reach it at 192.168.100.1.')),
				E('label', { 'class': 'cbi-value', 'style': 'display:flex;gap:.75em' }, [
					E('input', { 'type': 'checkbox', 'checked': d.trunk ? '' : null,
						'change': function(ev) { d.trunk = ev.target.checked; self.draw(); } }),
					E('span', {}, [ _('Pass every ISP VLAN, tagged (trunk)'), E('br'),
						E('small', {}, _('Your router then handles the Internet, IPTV and voice VLANs itself, as with TM\'s own bridge mode (Unifi: Internet 500, IPTV 600, voice 400). Leave off to give your router only the Internet, untagged.')) ])
				]),
				d.trunk ? '' : this.field(_('VLAN ID'), 'vlan', _('Filled in from the provider. Once the fibre is registered, the VLAN your ISP\'s equipment sends replaces it.')),
				E('h4', {}, _('Wi-Fi')),
				E('label', { 'class': 'cbi-value', 'style': 'display:flex;gap:.75em' }, [
					E('input', { 'type': 'checkbox', 'checked': d.wifi_keep ? '' : null,
						'change': function(ev) { d.wifi_keep = ev.target.checked; self.draw(); } }),
					E('span', {}, _('Keep this box\'s Wi-Fi on (normally your own router provides Wi-Fi in bridge mode)'))
				]),
				d.wifi_keep ? this.wifi() : ''
			];

		return {
			title: { combo: _('Combo settings'), router: _('Router settings'), bridge: _('Bridge settings') }[d.mode],
			body: E([], body),
			check: function() {
				var vlan = +d.vlan || 0;
				if (d.mode != 'router') {
					d.serial = normalizeSerial(d.serial);
					if (!/^[A-Z0-9]{4}[0-9A-F]{8}$/.test(d.serial))
						return _('The serial number should be 4 letters and 8 hex digits (HWTC12345678), or 16 hex digits.');
					if (d.password && !(d.password.length <= 10 || /^[0-9A-Fa-f]{20}$/.test(d.password)))
						return _('The PLOAM password is up to 10 characters, or 20 hex digits.');
				}
				if (d.vlan && !(vlan >= 1 && vlan <= 4094))
					return _('The VLAN ID is a number from 1 to 4094, or empty.');
				if (d.mode != 'bridge' && d.proto == 'pppoe' && !d.username)
					return _('Enter the PPPoE username.');
				if ((d.mode != 'bridge' || d.wifi_keep) && [ d.key0, d.key1 ].some(function(k) { return k && k.length < 8; }))
					return _('Wi-Fi passwords need at least 8 characters.');
				return null;
			}
		};
	},

	step_fibre: function() {
		var self = this, d = this.d, status = E('div', {}), saved = this.identitySaved,
		    stages = [ _('No light'), _('Light OK'), _('Registering'), _('Registered') ];

		var show = function(stage, light, extra) {
			status.replaceChildren(
				E('ol', {}, stages.map(function(s, i) {
					return E('li', { 'style': i == stage ? 'font-weight:bold' : (i < stage ? 'opacity:.6' : '') },
						i == 1 && light ? '%s (%s)'.format(s, light) : s);
				})),
				extra || '');
		};

		var poll = function() {
			Promise.all([ L.resolveDefault(callOmciStatus(0), {}), L.resolveDefault(callPonInfo(), {}) ]).then(function(r) {
				var st = r[0] || {}, pon = r[1] || {}, rx = line.dbm(st.bosa_rx_power_nw), stage, extra = '';

				stage = st.state == 5 ? 3 : (rx != null && rx > -32) ? (st.state >= 2 && st.state <= 4 ? 2 : 1) : 0;
				if (stage >= 1 && !self.lightSince)
					self.lightSince = Date.now();

				if (st.state == 5) {
					if (pon.vlan && String(pon.vlan) != String(d.vlan)) {
						extra = E('p', {}, _('Your ISP\'s equipment uses VLAN %d for the Internet (the preset said %s): Quick Setup will use %d.')
							.format(pon.vlan, d.vlan || _('untagged'), pon.vlan));
						d.vlan = String(pon.vlan);
					}
					else
						extra = E('p', {}, pon.vlan ? _('Registered. Internet VLAN from your ISP: %d.').format(pon.vlan) : _('Registered.'));
					extra = E('div', { 'class': 'alert-message success' }, extra);
				}
				else if (st.state == 7)
					extra = E('div', { 'class': 'alert-message danger' }, _('The ISP\'s equipment has stopped this box (serial number blocked or not registered). Unplug the fibre now and check the serial number.'));
				else if (self.lightSince && Date.now() - self.lightSince > 180000)
					extra = E('div', { 'class': 'alert-message danger' }, [
						E('strong', {}, _('Not registered after 3 minutes: unplug the fibre now.')), ' ',
						rx != null && rx < line.RX_MIN
							? _('The light is too weak (%.1f dBm); clean the connector and check for bends.').format(rx)
							: _('The light is fine, so the serial number or PLOAM password is probably wrong. Go back, check them, and plug the fibre in again.')
					]);

				show(stage, rx != null ? '%.1f dBm'.format(rx) : null, extra);
			});
		};

		var start = function() {
			show(0);
			self.timer = window.setInterval(poll, 2000);
			poll();
		};

		var body = E('div', {}, [
			E('p', {}, _('First the box saves the fibre identity, then you plug in the fibre and watch it register. Saving it before the fibre goes in avoids alarms at the ISP, which can get the serial number blocked.')),
			saved ? E('p', {}, E('strong', {}, _('Identity saved. Now plug the fibre into the PON port.')))
			: E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': function(ev) {
				ev.target.disabled = true;
				var args = IDENTITY.map(function(k) { return d[k] || ''; });
				args.push(d.olt_profile || (self.preset() || {}).olt_profile || '');
				callSetIdentity.apply(null, args).then(function() {
					self.identitySaved = true;
					self.draw();
				}, function(e) {
					ev.target.disabled = false;
					ui.addNotification(null, E('p', {}, e.message || e), 'danger');
				});
			} }, _('Save the identity')),
			status,
			E('p', {}, E('small', {}, _('You can also finish now and plug the fibre in later; Home shows the fibre state.')))
		]);

		if (saved)
			start();

		return { title: _('Plug in the fibre'), body: body };
	},

	step_finish: function() {
		var d = this.d, p = this.preset(), rows = [
			[ _('Interface'), d.ui == 'advanced' ? _('Advanced') : _('Basic') ],
			[ _('Provider'), p ? p.name : '-' ],
			[ _('Mode'), line.MODES[d.mode] ],
			d.mode != 'router' ? [ _('GPON serial'), d.serial ] : null,
			d.mode != 'combo' ? [ _('LAN port'), line.portName(d.port) ] : null,
			d.mode == 'combo' && d.iptv ? [ _('IPTV'), _('%s on VLAN %s').format(line.portName(IPTV_PORT), d.iptv_vlan) ] : null,
			d.mode != 'bridge' ? [ _('Internet'), d.proto == 'pppoe' ? _('PPPoE as %s').format(d.username) : _('Automatic (DHCP)') ] : null,
			[ _('VLAN'), d.vlan || _('untagged') ],
			[ _('Wi-Fi'), (d.mode == 'bridge' && !d.wifi_keep) ? _('Off') : '%s / %s'.format(d.ssid0, d.ssid1) ]
		].filter(function(r) { return r; });

		return {
			title: _('Finish'),
			body: E([], [
				E('table', { 'class': 'table' }, rows.map(function(r) {
					return E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left', 'width': '40%' }, r[0]), E('td', { 'class': 'td left' }, r[1]) ]);
				})),
				E('label', { 'class': 'cbi-value', 'style': 'display:flex;gap:.75em' }, [
					E('input', { 'type': 'checkbox', 'checked': d.tz ? '' : null, 'change': function(ev) { d.tz = ev.target.checked; } }),
					E('span', {}, _('Malaysian time zone (UTC+8)'))
				]),
				E('p', {}, _('Finish applies the settings with a safety check: if this page cannot reach the box afterwards, the change is undone by itself. Home then shows whether the Internet is up.')),
				E('p', {}, E('small', {}, _('The stock firmware stays in the other flash slot; System > Firmware banks switches back to it.')))
			])
		};
	},

	/* ---- navigation ---- */

	draw: function() {
		var self = this, steps = this.steps(), id = steps[this.step], s;

		if (this.timer) {
			window.clearInterval(this.timer);
			this.timer = null;
		}
		s = this['step_' + id]();
		this.current = s;

		this.node.replaceChildren(
			E('p', {}, E('small', {}, _('Step %d of %d').format(this.step + 1, steps.length))),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, s.title), s.body ]),
			E('div', { 'class': 'cbi-page-actions' }, [
				this.step > 0 ? E('button', { 'class': 'btn cbi-button', 'click': function() { self.step--; self.draw(); } }, _('Back')) : '',
				' ',
				this.step == 0 ? E('button', { 'class': 'btn cbi-button', 'click': L.bind(this.skip, this) }, _('Skip setup')) : '',
				' ',
				E('button', { 'class': 'btn cbi-button cbi-button-apply', 'click': L.bind(this.next, this) },
					id == 'finish' ? _('Finish') : _('Next'))
			])
		);
	},

	next: function(ev) {
		var self = this, steps = this.steps();

		ev.target.disabled = true;
		return Promise.resolve(this.current.check ? this.current.check() : null).then(function(err) {
			ev.target.disabled = false;
			if (err)
				return ui.addNotification(null, E('p', {}, err), 'warning');
			if (steps[self.step] == 'finish')
				return self.finish();
			self.step = Math.min(self.step + 1, self.steps().length - 1);
			self.draw();
			window.scrollTo(0, 0);
		}, function(e) {
			ev.target.disabled = false;
			ui.addNotification(null, E('p', {}, e.message || e), 'danger');
		});
	},

	skip: function() {
		uci.set('alphawrt', 'setup', 'done', '1');
		return uci.save().then(function() { ui.changes.apply(true); });
	},

	/* ---- writing the configuration ---- */

	writeNetwork: function() {
		var d = this.d, vlan = +d.vlan || 0, iptv = d.mode == 'combo' && d.iptv && +d.iptv_vlan,
		    lanBr, ports, br, brIfs, tv;

		/* an earlier bridge mode: the pon0 bridge and the interfaces on it
		 * (ontbridge, and gnmgmt for the management address). Reused in
		 * bridge mode (removing and re-adding the same names in one save is
		 * not safe), removed otherwise. */
		br = uci.sections('network', 'device').filter(function(s) {
			return s.type == 'bridge' && s.name != 'br-iptv' && L.toArray(s.ports).some(function(p) { return /^pon\d/.test(p); });
		})[0];
		brIfs = br ? uci.sections('network', 'interface').filter(function(i) { return i.device == br.name; }) : [];
		if (d.mode != 'bridge') {
			brIfs.forEach(function(i) { uci.remove('network', i['.name']); });
			if (br)
				uci.remove('network', br['.name']);
			uci.sections('firewall', 'zone').forEach(function(z) {
				if (z.name == 'gnmgmt')
					uci.remove('firewall', z['.name']);
			});
		}

		/* combo mode's IPTV port: IPTV_PORT bridged to the IPTV VLAN, with
		 * no address on the box (an interface only so netifd brings it up).
		 * Reused when kept, for the same reason as the bridge above. */
		tv = uci.sections('network', 'device').filter(function(s) { return s.name == 'br-iptv'; })[0];
		if (iptv) {
			tv = tv ? tv['.name'] : uci.add('network', 'device', 'br_iptv');
			uci.set('network', tv, 'type', 'bridge');
			uci.set('network', tv, 'name', 'br-iptv');
			uci.set('network', tv, 'ports', [ IPTV_PORT, 'pon0.' + iptv ]);
			/* no IPv6 link-local either: the box stays unreachable from the IPTV side */
			uci.set('network', tv, 'ipv6', '0');
			if (!uci.get('network', 'iptv'))
				uci.add('network', 'interface', 'iptv');
			uci.set('network', 'iptv', 'proto', 'none');
			uci.set('network', 'iptv', 'device', 'br-iptv');
		}
		else {
			if (uci.get('network', 'iptv'))
				uci.remove('network', 'iptv');
			if (tv)
				uci.remove('network', tv['.name']);
		}

		/* LAN bridge: every port except the one this mode takes */
		lanBr = uci.sections('network', 'device').filter(function(s) { return s.name == 'br-lan'; })[0];
		ports = LAN_PORTS.filter(function(p) { return d.mode == 'combo' ? !(iptv && p == IPTV_PORT) : p != d.port; });
		if (lanBr)
			uci.set('network', lanBr['.name'], 'ports', ports);

		if (!uci.get('network', 'wan'))
			uci.add('network', 'interface', 'wan');

		if (d.mode == 'bridge') {
			var bsid = br ? br['.name'] : uci.add('network', 'device', 'br_wan'),
			    isid = uci.get('network', 'ontbridge') ? 'ontbridge' : uci.add('network', 'interface', 'ontbridge'),
			    msid = uci.get('network', 'gnmgmt') ? 'gnmgmt' : uci.add('network', 'interface', 'gnmgmt'),
			    zone = uci.sections('firewall', 'zone').filter(function(z) { return z.name == 'gnmgmt'; })[0];
			uci.set('network', bsid, 'type', 'bridge');
			uci.set('network', bsid, 'name', 'br-wan');
			/* trunk: pon0 itself passes every ISP VLAN tagged, as TM's own
			 * bridge mode does; otherwise only the Internet VLAN, untagged */
			uci.set('network', bsid, 'ports', [ d.port, (vlan && !d.trunk) ? 'pon0.' + vlan : 'pon0' ]);
			uci.set('network', isid, 'proto', 'none');
			uci.set('network', isid, 'device', 'br-wan');
			/* the box stays reachable from the router's side, like an ISP
			 * ONT: 192.168.100.1 (frames from the fibre side are dropped) */
			uci.set('network', msid, 'proto', 'static');
			uci.set('network', msid, 'device', 'br-wan');
			uci.set('network', msid, 'ipaddr', '192.168.100.1');
			uci.set('network', msid, 'netmask', '255.255.255.0');
			if (!zone)
				zone = { '.name': uci.add('firewall', 'zone') };
			uci.set('firewall', zone['.name'], 'name', 'gnmgmt');
			uci.set('firewall', zone['.name'], 'network', [ 'gnmgmt' ]);
			uci.set('firewall', zone['.name'], 'input', 'ACCEPT');
			uci.set('firewall', zone['.name'], 'output', 'ACCEPT');
			uci.set('firewall', zone['.name'], 'forward', 'REJECT');
			uci.set('network', 'wan', 'device', 'pon0');
			uci.set('network', 'wan', 'disabled', '1');
			if (uci.get('network', 'wan6'))
				uci.set('network', 'wan6', 'disabled', '1');
			return;
		}

		uci.unset('network', 'wan', 'disabled');
		uci.set('network', 'wan', 'device',
			(d.mode == 'router' ? d.port : 'pon0') + (vlan ? '.' + vlan : ''));
		uci.set('network', 'wan', 'proto', d.proto || 'dhcp');
		if (d.proto == 'pppoe') {
			uci.set('network', 'wan', 'username', d.username);
			uci.set('network', 'wan', 'password', d.ppp_password);
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
			uci.unset('network', 'wan6', 'disabled');
			uci.set('network', 'wan6', 'proto', 'dhcpv6');
			uci.set('network', 'wan6', 'device', '@wan');
		}
	},

	finish: function() {
		var self = this, d = this.d;

		/* once registered, the VLAN the OLT provisioned beats the preset */
		return (d.mode == 'router' ? Promise.resolve({}) : L.resolveDefault(callPonInfo(), {})).then(function(pon) {
			if (pon.state == 5 && pon.vlan)
				d.vlan = String(pon.vlan);
			return self.apply();
		});
	},

	apply: function() {
		var d = this.d, sys;

		this.writeNetwork();

		[ '0', '1' ].forEach(function(r) {
			var sid = 'default_radio' + r;
			if (!uci.get('wireless', sid))
				return;
			if (d.mode == 'bridge' && !d.wifi_keep) {
				uci.set('wireless', sid, 'disabled', '1');
				return;
			}
			if (d['ssid' + r])
				uci.set('wireless', sid, 'ssid', d['ssid' + r]);
			if (d['key' + r]) {
				uci.set('wireless', sid, 'key', d['key' + r]);
				uci.set('wireless', sid, 'encryption', 'sae-mixed');
			}
			uci.set('wireless', sid, 'disabled', '0');
			/* the radio too: a fresh config can leave radio0 itself off */
			uci.unset('wireless', uci.get('wireless', sid, 'device'), 'disabled');
		});

		if (d.tz) {
			sys = uci.sections('system', 'system')[0];
			if (sys) {
				uci.set('system', sys['.name'], 'zonename', 'Asia/Kuala Lumpur');
				uci.set('system', sys['.name'], 'timezone', '<+08>-8');
			}
		}

		[ 'isp', 'mode', 'port', 'ui' ].forEach(function(k) {
			uci.set('alphawrt', 'setup', k, d[k] || '');
		});
		uci.set('alphawrt', 'setup', 'done', '1');

		/* land on the chosen interface after the apply reloads the page */
		try { sessionStorage.removeItem('alphawrt-landing'); } catch (e) {}

		return uci.save().then(function() { ui.changes.apply(true); });
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
