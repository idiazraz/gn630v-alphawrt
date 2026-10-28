'use strict';
'require view';
'require rpc';
'require ui';
'require dom';
'require poll';

// Advanced page for Pi-hole: on/off, preset, admin password. Everything
// else (lists, groups, clients, query log) is in Pi-hole's own admin.

var callStatus = rpc.declare({ object: 'alphawrt-pihole', method: 'status' });
var callPresets = rpc.declare({ object: 'alphawrt-pihole', method: 'presets', expect: { presets: [] } });
var callSet = rpc.declare({ object: 'alphawrt-pihole', method: 'set', params: [ 'enabled', 'preset', 'tif', 'password' ] });
var callUpdate = rpc.declare({ object: 'alphawrt-pihole', method: 'update' });

var errors = {
	password_required: _('Set a Pi-hole admin password first.'),
	password_too_short: _('The password needs at least 8 characters.'),
	bad_preset: _('Unknown preset.')
};

function statusText(st) {
	if (!st.available)
		return _('Pi-hole works when AlphaWRT is your router (combo or router mode). This box is in bridge mode.');
	if (!st.enabled)
		return _('Off.');
	if (st.updating)
		return _('Updating the block lists…');
	var when = st.last_update ? new Date(st.last_update * 1000).toLocaleString() : _('never');
	var b = st.blocking == 'enabled' ? _('Blocking') :
		st.blocking == 'disabled' ? _('Paused') : _('Not running');
	return _('%s. %d domains on the lists, updated %s.').format(b, st.domains, when);
}

return view.extend({
	load: function() {
		return Promise.all([ callStatus(), callPresets() ]);
	},

	render: function(data) {
		var st = data[0], presets = data[1];
		var status = E('p', {}, statusText(st));
		var enabled = E('input', { type: 'checkbox', checked: st.enabled ? '' : null });
		var tif = E('input', { type: 'checkbox', checked: st.tif ? '' : null });
		var password = E('input', { type: 'password', class: 'cbi-input-password',
			placeholder: st.password_set ? _('unchanged') : _('at least 8 characters') });
		var preset = E('select', { class: 'cbi-input-select' }, presets.map(function(p) {
			return E('option', { value: p.id, selected: p.id == st.preset ? '' : null },
				'%s (%d, %s)'.format(p.name, p.domains, p.about));
		}));
		var admin = '%s//%s:%d%s'.format(location.protocol, location.hostname, st.admin_port, st.admin_path);

		function row(label, field, hint) {
			return E('div', { class: 'cbi-value' }, [
				E('label', { class: 'cbi-value-title' }, label),
				E('div', { class: 'cbi-value-field' }, [ field, hint ? E('div', { class: 'cbi-value-description' }, hint) : '' ])
			]);
		}

		poll.add(function() {
			return callStatus().then(function(s) { dom.content(status, statusText(s)); });
		}, 5);

		return E([], [
			E('h2', {}, _('Pi-hole')),
			E('div', { class: 'cbi-map-descr' }, _('Network-wide ad blocking with Hagezi\'s block lists. Pi-hole answers DNS for the LAN and passes the rest on to the encrypted DNS AlphaWRT already uses.')),
			status,
			E('div', { class: 'cbi-section' }, [
				row(_('Enable'), enabled),
				row(_('Block list'), preset, _('Normal is right for most homes.')),
				row(_('Threat intelligence'), tif, _('Also block Hagezi\'s list of malware and phishing hosts (about 213,000 more domains).')),
				row(_('Pi-hole admin password'), password, _('For the Pi-hole admin page.'))
			]),
			E('div', { class: 'cbi-page-actions' }, [
				E('a', { class: 'btn cbi-button', href: admin, target: '_blank', rel: 'noopener' }, _('Open Pi-hole admin')),
				' ',
				E('button', { class: 'btn cbi-button', disabled: st.enabled ? null : '', click: ui.createHandlerFn(this, function() {
					return callUpdate().then(function() { ui.addNotification(null, E('p', _('Updating the block lists in the background.')), 'info'); });
				}) }, _('Update lists now')),
				' ',
				E('button', { class: 'btn cbi-button-apply', click: ui.createHandlerFn(this, function() {
					return callSet(enabled.checked, preset.value, tif.checked, password.value || null).then(function(r) {
						if (r && r.error)
							ui.addNotification(null, E('p', errors[r.error] || r.error), 'error');
						else
							ui.addNotification(null, E('p', _('Saved. DNS restarts for a few seconds.')), 'info');
					});
				}) }, _('Save'))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
