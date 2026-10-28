'use strict';
'require baseclass';
'require rpc';

/* CPU card for Status > Overview, next to the stock Memory card. Load per
 * core between two refreshes, from rpcd "alphawrt cpu" (see alphawrt/cpu.js
 * for the full page with history). */

var callCpu = rpc.declare({
	object: 'alphawrt',
	method: 'cpu',
	expect: { cpu: [] }
});

return baseclass.extend({
	title: _('CPU'),

	prev: null,

	load: function() {
		return L.resolveDefault(callCpu(), []);
	},

	render: function(cpu) {
		var prev = this.prev, table = E('table', { 'class': 'table' });

		this.prev = cpu;

		cpu.forEach(function(c, i) {
			var p = prev && prev[i], dt = p ? c[1] - p[1] : 0,
			    pct = dt > 0 ? Math.max(0, Math.min(100, Math.round((c[0] - p[0]) * 100 / dt))) : null;

			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, i ? _('Core %d').format(i - 1) : _('All cores')),
				E('td', { 'class': 'td left' }, E('div', { 'class': 'cbi-progressbar', 'title': pct == null ? _('Measuring…') : '%d %%'.format(pct) },
					E('div', { 'style': 'width:%d%%'.format(pct || 0) })))
			]));
		});

		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left' }, ''),
			E('td', { 'class': 'td left' }, E('a', { 'href': L.url('admin/status/cpu') }, _('CPU and memory history')))
		]));

		return table;
	}
});
