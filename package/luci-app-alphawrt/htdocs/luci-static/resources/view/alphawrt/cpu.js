'use strict';
'require view';
'require poll';
'require rpc';

/*
 * CPU and memory: per-core load from two /proc/stat samples (rpcd
 * "alphawrt cpu", the call the Simple UI's System page uses too) with the
 * last two minutes as a sparkline, and memory, load and uptime from
 * "system info".
 */

var callCpu = rpc.declare({
	object: 'alphawrt',
	method: 'cpu',
	expect: { cpu: [] }
});

var callInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

var SAMPLES = 60;   // every 2 s: two minutes

function svg(tag, attrs) {
	var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (var k in attrs)
		el.setAttribute(k, attrs[k]);
	return el;
}

function mb(bytes) {
	return '%.0f MB'.format(bytes / 1048576);
}

return view.extend({
	load: function() {
		return Promise.all([ callCpu(), callInfo() ]);
	},

	render: function(data) {
		var prev = data[0], rows = [], history = [];

		var cores = E('div', { 'class': 'cpu-cores' });
		prev.forEach(function(_c, i) {
			var line = svg('polyline', { 'fill': 'none', 'stroke': 'var(--accent)', 'stroke-width': 1.5,
				'vector-effect': 'non-scaling-stroke', 'points': '' });
			var spark = svg('svg', { 'viewBox': '0 0 %d 100'.format(SAMPLES - 1), 'preserveAspectRatio': 'none',
				'class': 'cpu-spark', 'aria-hidden': 'true' });
			spark.appendChild(line);

			var row = {
				pct: E('strong', {}, '…'),
				bar: E('div', { 'style': 'width:0%' }),
				line: line
			};
			rows.push(row);
			history.push([]);

			cores.appendChild(E('div', { 'class': 'cpu-core' }, [
				E('div', { 'class': 'cpu-head' }, [ E('span', {}, i ? _('Core %d').format(i - 1) : _('All cores')), row.pct ]),
				E('div', { 'class': 'cbi-progressbar' }, row.bar),
				spark
			]));
		});

		var mem = {
			bar: E('div', { 'class': 'mem-bar' }, [ E('div', { 'class': 'mem-used' }), E('div', { 'class': 'mem-cache' }) ]),
			text: E('div', { 'class': 'mem-legend' })
		};
		var sys = E('p', { 'class': 'cbi-section-descr' });

		var update = function(cpu, info) {
			cpu.forEach(function(c, i) {
				var p = prev[i], dt = c[1] - (p ? p[1] : 0),
				    pct = (p && dt > 0) ? Math.max(0, Math.min(100, (c[0] - p[0]) * 100 / dt)) : 0,
				    h = history[i];

				h.push(pct);
				if (h.length > SAMPLES)
					h.shift();

				rows[i].pct.textContent = '%.0f %%'.format(pct);
				rows[i].bar.style.width = pct + '%';
				rows[i].line.setAttribute('points', h.map(function(v, x) {
					return (x + SAMPLES - h.length) + ',' + (100 - v).toFixed(1);
				}).join(' '));
			});
			prev = cpu;

			var m = info.memory || {}, total = m.total || 1,
			    cache = (m.buffered || 0) + (m.cached || 0),
			    avail = m.available != null ? m.available : (m.free || 0) + cache,
			    used = Math.max(0, total - avail);

			mem.bar.firstChild.style.width = (used * 100 / total) + '%';
			mem.bar.lastChild.style.width = (Math.min(cache, avail) * 100 / total) + '%';
			mem.text.replaceChildren(
				E('span', { 'class': 'mem-key mem-used' }), _('Used %s').format(mb(used)),
				E('span', { 'class': 'mem-key mem-cache' }), _('Cache %s').format(mb(Math.min(cache, avail))),
				E('span', { 'class': 'mem-key' }), _('Available %s of %s').format(mb(avail), mb(total)));

			var load = (info.load || []).map(function(l) { return (l / 65536).toFixed(2); });
			sys.textContent = _('Load average %s · Up %s').format(load.join(' '), '%t'.format(info.uptime || 0));
		};

		update(prev, data[1]);

		poll.add(function() {
			return Promise.all([ callCpu(), callInfo() ]).then(function(r) { update(r[0], r[1]); });
		}, 2);

		return E([], [
			E('style', {}, [
				'.cpu-cores{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}',
				'.cpu-head{display:flex;justify-content:space-between;font-size:14px}',
				'.cpu-core .cbi-progressbar{margin:6px 0 10px}',
				'.cpu-spark{display:block;width:100%;height:56px;background:var(--surface-2);border-radius:var(--r-field)}',
				'.mem-bar{display:flex;height:12px;margin:4px 0 12px;background:var(--fill-strong);border-radius:var(--r-badge);overflow:hidden}',
				'.mem-legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;font-size:14px;color:var(--ink-2)}',
				'.mem-key{width:10px;height:10px;border-radius:3px;margin-left:8px;background:var(--fill-strong)}.mem-key:first-child{margin-left:0}',
				'.mem-used{background:var(--accent)}.mem-cache{background:color-mix(in oklab,var(--accent) 35%,transparent)}'
			].join('')),
			E('h2', {}, _('CPU and memory')),
			sys,
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('CPU')), cores ]),
			E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('Memory')), mem.bar, mem.text ]),
			E('p', {}, E('a', { 'href': L.url('admin/status/realtime') }, _('Real-time graphs (load, traffic, connections)')))
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
