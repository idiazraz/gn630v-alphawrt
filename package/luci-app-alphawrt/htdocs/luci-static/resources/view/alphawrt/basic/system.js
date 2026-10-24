'use strict';
'require view';
'require form';
'require rpc';
'require ui';

/*
 * Basic > System: admin password, restart, firmware version. Firmware
 * upgrade and factory reset link to their Advanced pages, which already
 * do it safely (image check, keep-settings choice, confirmation).
 */

var callSetPassword = rpc.declare({
	object: 'luci',
	method: 'setPassword',
	params: [ 'username', 'password' ],
	expect: { result: false }
});

var callReboot = rpc.declare({
	object: 'system',
	method: 'reboot',
	expect: { result: 0 }
});

var callBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

var callInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

function uptime(s) {
	var d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
	return d ? _('%d days, %d hours').format(d, h) : _('%d hours, %d minutes').format(h, m);
}

return view.extend({
	load: function() {
		return Promise.all([ L.resolveDefault(callBoard(), {}), L.resolveDefault(callInfo(), {}) ]);
	},

	render: function(data) {
		var board = data[0], info = data[1], m, s, o;

		m = new form.JSONMap({ pw: { pw1: '', pw2: '' } }, _('System'));

		s = m.section(form.NamedSection, 'pw', 'pw', _('Admin password'),
			_('The password for this page. Use one you do not use anywhere else.'));
		o = s.option(form.Value, 'pw1', _('New password'));
		o.password = true;
		o = s.option(form.Value, 'pw2', _('Confirm password'));
		o.password = true;
		o.validate = function(sid, v) {
			return ((this.section.formvalue(sid, 'pw1') || '') == (v || '')) ? true : _('The passwords do not match');
		};
		o = s.option(form.Button, '_setpw', ' ');
		o.inputtitle = _('Change password');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return m.save().then(function() {
				var pw = m.data.get('json', 'pw', 'pw1');
				if (!pw)
					return ui.addNotification(null, E('p', {}, _('Enter a new password first.')), 'warning');
				return callSetPassword('root', pw).then(function(ok) {
					ui.addNotification(null, E('p', {}, ok ? _('Password changed.') : _('Changing the password failed.')), ok ? 'info' : 'danger');
				});
			});
		};

		s = m.section(form.NamedSection, 'pw', 'pw', _('Firmware'));
		o = s.option(form.DummyValue, '_ver', _('Version'));
		o.cfgvalue = function() { return (board.release && board.release.description) || '-'; };
		o = s.option(form.DummyValue, '_up', _('Running for'));
		o.cfgvalue = function() { return info.uptime ? uptime(info.uptime) : '-'; };
		o = s.option(form.DummyValue, '_links', ' ');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<a href="%s">%s</a> · <a href="%s">%s</a>'.format(
				L.url('admin/system/flash'), _('Upgrade firmware or reset to defaults'),
				L.url('admin/system/admin'), _('Remote access (SSH)'));
		};

		s = m.section(form.NamedSection, 'pw', 'pw', _('Restart'));
		o = s.option(form.Button, '_reboot', _('Restart the router'),
			_('Wi-Fi and Internet go away for about a minute.'));
		o.inputtitle = _('Restart');
		o.inputstyle = 'reset';
		o.onclick = function() {
			return ui.showModal(_('Restart the router?'), [
				E('p', {}, _('Wi-Fi and Internet go away for about a minute.')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
					E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
						callReboot().then(function() { ui.awaitReconnect(); });
					} }, _('Restart'))
				])
			]);
		};

		return m.render();
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
