'use strict';
'require view';
'require poll';
'require rpc';
'require alphawrt.omcime as me';

/*
 * Fibre provisioning: what the ISP's OLT set up on this box over OMCI, drawn
 * from the fibre to the ports, then every managed entity with its attributes.
 * Backend: alphawrt.fibre map, which masks serial numbers, MAC addresses and
 * logins. Read only: nothing here writes to the MIB.
 */

var callMap = rpc.declare({ object: 'alphawrt.fibre', method: 'map' });

var COL_W = 180, COL_GAP = 56, RAIL_W = 26, NODE_H = 78, NODE_GAP = 12, HEAD_H = 34, FIBRE_W = 34, PAD = 12;

var HEADS = [ _('T-CONTs'), _('GEM ports'), _('802.1p mappers'), _('Bridge ports'), '', _('Bridge ports'), _('Ports on this box') ];
var ORIGIN = { 'default': [ _('Built into the box'), 'var(--ink-3, #6b7280)' ], local: [ _('Our tools'), '#8b5cf6' ],
	olt: [ _('Your ISP (OLT)'), 'var(--accent, #1f6fe5)' ], hardware: [ _('Hardware'), '#0d9488' ] };

var CSS = '.aw-pv{--pv-line:var(--line-strong,#9ca3af);--pv-bad:var(--err,#d92d20);--pv-box:var(--surface,#fff);--pv-sub:var(--ink-3,#6b7280)}' +
	'.aw-map{position:relative;overflow:auto;max-height:min(72vh,720px);border:1px solid var(--line,#e2e6ed);border-radius:var(--r-panel,8px);background:var(--surface-2,#f3f5f8);cursor:grab;touch-action:pan-x pan-y}' +
	'.aw-map.drag{cursor:grabbing;user-select:none}' +
	'.aw-canvas{position:relative;transform-origin:0 0}' +
	'.aw-canvas svg{position:absolute;inset:0;overflow:visible;pointer-events:none}' +
	'.aw-canvas path{fill:none;stroke:var(--pv-line);stroke-width:1.5}' +
	'.aw-canvas path.bad{stroke:var(--pv-bad);stroke-dasharray:4 4}' +
	'.aw-canvas path.on{stroke:var(--accent,#1f6fe5);stroke-width:2.5}' +
	'.aw-canvas.focus path:not(.on){opacity:.3}' +
	'.aw-canvas.focus .aw-node:not(.on){opacity:.45}' +
	'.aw-head{position:absolute;top:8px;font-size:.75rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--pv-sub);white-space:nowrap}' +
	'.aw-node{position:absolute;display:block;box-sizing:border-box;text-align:left;margin:0;padding:6px 10px 6px 14px;font:inherit;font-size:.8125rem;line-height:1.3;height:auto;min-height:0;color:inherit;background:var(--pv-box);border:1px solid var(--line,#e2e6ed);border-radius:var(--r-field,6px);cursor:pointer;overflow:hidden}' +
	'.aw-node:focus-visible{outline:2px solid var(--accent,#1f6fe5);outline-offset:1px}' +
	'.aw-node.sel{border-color:var(--accent,#1f6fe5);box-shadow:0 0 0 1px var(--accent,#1f6fe5)}' +
	'.aw-node.missing{border:1.5px dashed var(--pv-bad);background:transparent;color:var(--pv-bad)}' +
	'.aw-node i{position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--o)}' +
	'.aw-node b,.aw-node small,.aw-node em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:normal}' +
	'.aw-node small{color:var(--pv-sub);font-size:.75rem}.aw-node.missing small{color:inherit}' +
	'.aw-node em{margin-top:3px;padding:0 6px;font-size:.6875rem;line-height:1.5;border:1px solid var(--line,#e2e6ed);border-radius:var(--r-sm,4px);background:var(--fill,rgba(127,127,127,.08))}' +
	'.aw-rail{position:absolute;box-sizing:border-box;border:1px solid var(--pv-line);border-radius:var(--r-sm,4px);background:var(--pv-box);font-size:.6875rem;color:var(--pv-sub);writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;overflow:hidden;white-space:nowrap;padding:0;cursor:pointer}' +
	'.aw-rail.missing{border:1.5px dashed var(--pv-bad);color:var(--pv-bad)}' +
	'.aw-fibre{position:absolute;box-sizing:border-box;left:%dpx;top:%dpx;width:%dpx;border:1px solid var(--pv-line);border-radius:var(--r-sm,4px);background:var(--pv-box);font-size:.75rem;writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;color:var(--pv-sub)}'.format(PAD, HEAD_H, FIBRE_W - 8) +
	'.aw-legend{display:flex;flex-wrap:wrap;gap:.25rem 1rem;margin:.5rem 0 1rem;font-size:.8125rem;color:var(--pv-sub)}' +
	'.aw-legend span::before{content:"";display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px;border-radius:3px;background:var(--o)}' +
	'.aw-legend span.dash::before{background:none;border:1.5px dashed var(--pv-bad)}' +
	'.aw-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1rem;align-items:start}' +
	'@media (max-width:1000px){.aw-split{grid-template-columns:minmax(0,1fr)}}' +
	'.aw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:.5rem}' +
	'.aw-chip{margin:0;height:auto;min-height:0;padding:2px 10px;font:inherit;font-size:.8125rem;line-height:1.5;color:inherit;background:transparent;border:1px solid var(--line-strong,#9ca3af);border-radius:var(--r-badge,12px);cursor:pointer}' +
	'.aw-chip[aria-pressed=true]{border-color:var(--accent,#1f6fe5);background:var(--accent-tint,rgba(31,111,229,.12))}' +
	'.aw-chip::before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:var(--o,transparent)}' +
	'.aw-list{max-height:560px;overflow:auto;border:1px solid var(--line,#e2e6ed);border-radius:var(--r-field,6px)}' +
	'.aw-list summary{cursor:pointer;padding:6px 10px;font-weight:600;font-size:.875rem}' +
	'.aw-list summary small{font-weight:400;color:var(--pv-sub);margin-left:.5em}' +
	'.aw-row{display:flex;gap:1em;width:100%;box-sizing:border-box;margin:0;height:auto;min-height:0;padding:4px 10px 4px 12px;font:inherit;font-size:.8125rem;line-height:1.5;text-align:left;color:inherit;background:transparent;border:0;border-radius:0;cursor:pointer;align-items:baseline}' +
	'.aw-row:hover{background:var(--fill,rgba(127,127,127,.08))}.aw-row.sel{background:var(--accent-tint,rgba(31,111,229,.12))}' +
	'.aw-row::before{content:"";flex:none;align-self:center;width:8px;height:8px;border-radius:50%;background:var(--o)}' +
	'.aw-row code{flex:none;width:4.5em}.aw-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
	'.aw-detail table{width:100%}.aw-detail td{vertical-align:top}.aw-detail small{color:var(--pv-sub)}.aw-detail h4{margin:.25rem 0}' +
	'.aw-detail .link{padding:0;margin:0;height:auto;min-height:0;border:0;background:none;color:var(--accent-ink,#1f6fe5);font:inherit;cursor:pointer;text-decoration:underline}' +
	'.aw-detail pre{white-space:pre-wrap;word-break:break-all}.aw-off{opacity:.55}';

function originOf(o) {
	return me.ORIGINS[o] || 'default';
}

function originVar(o) {
	return ORIGIN[originOf(o)][1];
}

/*
 * Positions for the columns, in canvas pixels. Boxes follow the box they
 * come from, so lines cross less: one left to right pass over the columns.
 */
function layout(g) {
	var cols = [ [], [], [], [], [], [], [] ], from = {}, y = {}, x = [], px = PAD + FIBRE_W + COL_GAP / 2, bridges = Object.keys(g.rails),
	    tall = 0, order = {};

	Object.keys(g.nodes).forEach(function(k) { cols[g.nodes[k].col].push(g.nodes[k]); });
	g.links.forEach(function(l) { (from[l.b] = from[l.b] || []).push(l.a); });
	bridges.sort();

	function rank(n) {
		var f = (from[n.key] || []).map(function(k) { return order[k]; }).filter(function(v) { return v != null; });
		return f.length ? f.reduce(function(a, b) { return a + b; }, 0) / f.length : 1e6;
	}

	cols.forEach(function(c, i) {
		if (i == 3 || i == 5)
			c.forEach(function(n) { n.rank = bridges.indexOf(n.rail) * 1e4 + (i == 3 ? rank(n) : parseInt(n.key.split(':')[1])); });
		else
			c.forEach(function(n) { n.rank = rank(n); });
		c.sort(function(a, b) { return a.rank - b.rank || (a.key > b.key ? 1 : -1); });
		c.forEach(function(n, j) { order[n.key] = j; });
		tall = Math.max(tall, c.length);
	});

	/* columns with nothing in them are dropped; the rail column is as wide as its bridges */
	cols.forEach(function(c, i) {
		x[i] = px;
		if (i == 4)
			px += bridges.length ? bridges.length * RAIL_W + COL_GAP : 0;
		else if (c.length)
			px += COL_W + COL_GAP;
	});

	var height = tall * (NODE_H + NODE_GAP);
	cols.forEach(function(c, i) {
		var top = HEAD_H + (height - c.length * (NODE_H + NODE_GAP)) / 2;
		c.forEach(function(n, j) {
			n.x = x[i];
			n.y = Math.round(top + j * (NODE_H + NODE_GAP));
			y[n.key] = n.y;
		});
	});

	var rails = bridges.map(function(b, i) {
		var r = g.rails[b], ys = r.ports.map(function(k) { return y[k]; }), lo, hi;
		lo = ys.length ? Math.min.apply(null, ys) : HEAD_H;
		hi = ys.length ? Math.max.apply(null, ys) + NODE_H : HEAD_H + NODE_H;
		/* tall enough to carry its name */
		if (hi - lo < 140) {
			lo = Math.max(HEAD_H, (lo + hi) / 2 - 70);
			hi = lo + 140;
		}
		return { key: r.key, id: r.id, missing: r.missing, x: x[4] + i * RAIL_W, y: lo, h: hi - lo };
	});

	/* room under the boxes for the zoom buttons */
	return { cols: cols, rails: rails, x: x, width: px, height: height + HEAD_H + PAD + 44 };
}

function curve(a, b) {
	var m = (a[0] + b[0]) / 2;
	return 'M%d %dC%d %d %d %d %d %d'.format(a[0], a[1], m, a[1], m, b[1], b[0], b[1]);
}

/* a GEM port straight off the fibre: along the gap between T-CONTs, so no T-CONT seems to feed it */
function bypass(l, x, to) {
	var gaps = l.cols[0].map(function(n) { return n.y - NODE_GAP / 2; }), last = l.cols[0][l.cols[0].length - 1], y = to[1], mid = to[0] - COL_GAP;

	if (last)
		gaps.push(last.y + NODE_H + NODE_GAP / 2);
	gaps.forEach(function(g, i) {
		if (!i || Math.abs(g - to[1]) < Math.abs(y - to[1]))
			y = g;
	});
	return 'M%d %dL%d %d'.format(x, y, mid, y) + curve([ mid, y ], to);
}

return view.extend({
	load: function() {
		return L.resolveDefault(callMap(), null);
	},

	/* the scale the map opens at: everything in view, down to a readable size */
	fit: function() {
		var w = this.mapNode.clientWidth;
		this.zoom(w ? Math.max(0.5, Math.min(1, (w - 2) / this.lay.width)) : 1);
	},

	zoom: function(s) {
		this.scale = Math.max(0.4, Math.min(1.5, s));
		this.canvas.style.transform = 'scale(%f)'.format(this.scale);
		this.sizer.style.width = this.lay.width * this.scale + 'px';
		this.sizer.style.height = this.lay.height * this.scale + 'px';
	},

	/* everything reachable from the selected box, both ways */
	mark: function() {
		var sel = this.sel, g = this.g, on = {}, self = this;

		function walk(k, a, b) {
			g.links.forEach(function(l) {
				if (l[a] == k && !on[l[a] + '>' + l[b] + a]) {
					on[l[a] + '>' + l[b] + a] = true;
					on[l[b]] = true;
					l.on = true;
					walk(l[b], a, b);
				}
			});
		}

		g.links.forEach(function(l) { l.on = false; });
		if (sel && (g.nodes[sel] || g.rails[sel])) {
			on[sel] = true;
			walk(sel, 'a', 'b');
			walk(sel, 'b', 'a');
		}
		this.canvas.classList.toggle('focus', !!(sel && on[sel]));
		this.boxes.forEach(function(b) {
			b.classList.toggle('on', !!on[b.dataset.key]);
			b.classList.toggle('sel', b.dataset.key == sel || (b.dataset.keys || '').split(' ').indexOf(sel) >= 0);
		});
		g.links.forEach(function(l) { if (l.path) l.path.classList.toggle('on', !!l.on); });
		L.dom.content(this.detail, this.renderDetail());
		this.list.querySelectorAll('.aw-row').forEach(function(r) { r.classList.toggle('sel', r.dataset.key == self.sel); });
	},

	select: function(k) {
		this.sel = k;
		this.mark();
	},

	/* arrow keys: up and down within a column, sideways to the nearest box */
	move: function(ev) {
		var n = this.g.nodes[ev.target.dataset.key], d = { ArrowUp: [ 0, -1 ], ArrowDown: [ 0, 1 ], ArrowLeft: [ -1, 0 ], ArrowRight: [ 1, 0 ] }[ev.key], next, best = 1e9;

		if (!d || !n)
			return;
		ev.preventDefault();
		this.boxes.forEach(function(b) {
			var m = this.g.nodes[b.dataset.key], dist;
			if (!m || m == n || (d[1] && (m.col != n.col || (m.y - n.y) * d[1] <= 0)) || (d[0] && (m.col - n.col) * d[0] <= 0))
				return;
			dist = Math.abs(m.y - n.y) + Math.abs(m.col - n.col) * 1000;
			if (dist < best) {
				best = dist;
				next = b;
			}
		}, this);
		if (next) {
			next.focus();
			this.select(next.dataset.key);
		}
	},

	renderMap: function() {
		var self = this, g = this.g, l = this.lay, ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'),
		    pos = {}, canvas = this.canvas;

		this.boxes = [];
		canvas.replaceChildren(svg);
		canvas.style.width = l.width + 'px';
		canvas.style.height = l.height + 'px';
		svg.setAttribute('width', l.width);
		svg.setAttribute('height', l.height);

		HEADS.forEach(function(h, i) {
			if (h && l.cols[i].length)
				canvas.appendChild(E('div', { 'class': 'aw-head', 'style': 'left:%dpx'.format(l.x[i]) }, h));
		});

		canvas.appendChild(E('div', { 'class': 'aw-fibre', 'style': 'height:%dpx'.format(l.height - HEAD_H - PAD - 44) }, _('Fibre')));
		pos.fibre = { r: [ PAD + FIBRE_W - 8, 0 ] };

		l.cols.forEach(function(c) {
			c.forEach(function(n) {
				var b = E('button', {
					'type': 'button', 'class': 'aw-node' + (n.missing ? ' missing' : ''), 'data-key': n.key,
					'data-keys': n.attached.join(' '), 'title': [ n.title, n.sub, n.pill ].filter(Boolean).join('\n'),
					'style': 'left:%dpx;top:%dpx;width:%dpx;height:%dpx%s'.format(n.x, n.y, COL_W, NODE_H, n.origin != null ? ';--o:' + originVar(n.origin) : ''),
					'click': function() { self.select(n.key); }, 'keydown': function(ev) { self.move(ev); }
				}, [ E('i'), E('b', {}, n.title), E('small', {}, n.sub), n.pill ? E('em', {}, n.pill) : '' ]);
				canvas.appendChild(b);
				self.boxes.push(b);
				pos[n.key] = { l: [ n.x, n.y + NODE_H / 2 ], r: [ n.x + COL_W, n.y + NODE_H / 2 ] };
			});
		});

		l.rails.forEach(function(r) {
			var b = E('button', {
				'type': 'button', 'class': 'aw-rail' + (r.missing ? ' missing' : ''), 'data-key': r.key,
				'style': 'left:%dpx;top:%dpx;width:%dpx;height:%dpx'.format(r.x, r.y, RAIL_W - 4, r.h),
				'click': function() { self.select(r.key); }
			}, _('MAC bridge %s').format(me.hex(r.id)));
			canvas.appendChild(b);
			self.boxes.push(b);
			pos[r.key] = { rail: r };
		});

		g.links.forEach(function(k) {
			var a = pos[k.a], b = pos[k.b], p;
			if (!a || !b)
				return;
			/* a line to a rail ends at the rail, level with the box it comes from */
			var from = a.r || [ a.rail.x + RAIL_W - 4, b.l[1] ], to = b.l || [ b.rail.x, a.r[1] ];
			p = document.createElementNS(ns, 'path');
			p.setAttribute('d', curve(from, to));
			if (k.a == 'fibre')
				p.setAttribute('d', g.nodes[k.b].col ? bypass(l, from[0], to) : curve([ from[0], to[1] ], to));
			if (k.bad)
				p.setAttribute('class', 'bad');
			k.path = p;
			svg.appendChild(p);
		});
	},

	renderList: function() {
		var self = this, g = this.g, f = this.filter, objs = this.data.objects, chips = this.chips, list = this.list, seen = {};

		var match = function(o) {
			return !f || (f == 'hidden' ? o.data == null : originOf(o.origin) == f);
		};

		var chip = function(id, label, color, n) {
			return n ? E('button', {
				'type': 'button', 'class': 'aw-chip', 'aria-pressed': f == id ? 'true' : 'false', 'style': color ? '--o:' + color : '',
				'click': function() { self.filter = f == id ? null : id; self.renderList(); }
			}, '%s %d'.format(label, n)) : '';
		};

		objs.forEach(function(o) { seen[originOf(o.origin)] = (seen[originOf(o.origin)] || 0) + 1; });

		L.dom.content(chips, [ 'olt', 'default', 'local', 'hardware' ].map(function(o) {
			return chip(o, ORIGIN[o][0], ORIGIN[o][1], seen[o]);
		}).concat(chip('hidden', _('Hidden'), null, objs.filter(function(o) { return o.data == null; }).length)));

		L.dom.content(list, Object.keys(g.classes).sort(function(a, b) { return a - b; }).map(function(c) {
			var rows = g.classes[c].filter(match);

			return rows.length ? E('details', { 'open': rows.length <= 12 ? 'open' : null }, [
				E('summary', {}, [ '%d %s'.format(c, me.shortName(+c, rows[0].name)), me.shortName(+c, rows[0].name) != rows[0].name ? E('small', {}, rows[0].name) : '', E('small', {}, '×%d'.format(rows.length)) ]),
				E('div', {}, rows.map(function(o) {
					var k = c + ':' + o.id;
					return E('button', {
						'type': 'button', 'class': 'aw-row', 'data-key': k, 'style': '--o:' + originVar(o.origin),
						'click': function() { self.select(k); }
					}, [ E('code', {}, me.hex(o.id)), E('span', {}, me.summary(o)) ]);
				}))
			]) : '';
		}));
	},

	renderDetail: function() {
		var self = this, g = this.g, sel = this.sel, o = g.all[sel], n = g.nodes[sel] || {}, r = g.rails[sel], attrs;

		if (n.missing || (r && r.missing && !o))
			return E('div', { 'class': 'alert-message danger' }, [ E('h4', {}, _('A pointer to nothing')), E('p', {},
				_('Another entity points at %s, class %s, and that entity is not in the MIB. Either the ISP never created it or the box refused it.').format(
					me.hex(+sel.split(':')[1]), sel.split(':')[0])) ]);
		if (n.group)
			return E('p', {}, _('T-CONTs the box offers that the ISP has not given an Alloc-ID. They carry nothing, and they are normal.'));
		if (!o)
			return E('p', { 'class': 'aw-off' }, _('Select a box or a row to see what it holds.'));

		attrs = me.attributes(o);
		var link = function(k, label) {
			return E('button', { 'type': 'button', 'class': 'link', 'click': function() { self.select(k); } }, label);
		};
		var rules = me.rules(o), attached = n.attached || [];

		return E('div', {}, [
			E('h4', {}, [ me.shortName(o.class, o.name), ' ', E('code', {}, '%s · %d'.format(me.hex(o.id), o.id)) ]),
			E('p', {}, [ E('small', {}, 'ME %d · %s'.format(o.class, o.name)), E('br'), E('span', { 'class': 'aw-chip', 'style': 'cursor:default;--o:' + originVar(o.origin) }, ORIGIN[originOf(o.origin)][0]) ]),
			attached.length ? E('p', {}, [ _('Attached: ') ].concat(attached.map(function(k, i) {
				var a = g.all[k];
				return E('span', {}, [ i ? ', ' : '', link(k, '%s %s'.format(me.shortName(a.class, a.name), me.hex(a.id))) ]);
			}))) : '',
			o.data == null ? E('p', {}, _('This entity can hold the box\'s identity, addresses or logins, so its bytes stay on the box.')) : '',
			o.data != null && !attrs ? E('p', {}, _('The box keeps this class as the OLT sent it. A later Set overwrites the start of these bytes whatever attribute it carries, so they cannot be read attribute by attribute.')) : '',
			attrs ? E('table', { 'class': 'table' }, [ E('tr', { 'class': 'tr table-titles' }, [ E('th', { 'class': 'th' }, '#'), E('th', { 'class': 'th' }, _('Attribute')), E('th', { 'class': 'th' }, _('Value')) ]) ].concat(attrs.map(function(a) {
				var tk = a.target != null && a.num != null ? a.target + ':' + a.num : null;
				return E('tr', { 'class': 'tr' + (a.set ? '' : ' aw-off') }, [
					E('td', { 'class': 'td' }, String(a.index)),
					E('td', { 'class': 'td' }, [ a.name, E('br'), E('small', {}, '%d B · %s'.format(a.len, a.access)) ]),
					E('td', { 'class': 'td' }, [ tk && g.all[tk] ? link(tk, a.value) : a.value, ' ', a.len <= 4 && a.raw && String(a.value) != a.raw ? E('small', {}, E('code', {}, a.raw)) : '' ])
				]);
			}))) : '',
			rules.length ? E('h4', {}, _('VLAN rules, upstream')) : '',
			rules.length ? E('table', { 'class': 'table' }, [ E('tr', { 'class': 'tr table-titles' }, [ E('th', { 'class': 'th' }, _('Frames that are')), E('th', { 'class': 'th' }, _('Get')) ]) ].concat(rules.map(function(x) {
				return E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td' }, me.ruleMatch(x)), E('td', { 'class': 'td' }, me.ruleAction(x)) ]);
			}))) : '',
			!attrs && o.data != null ? E('pre', {}, o.data || _('(all zero)')) : ''
		]);
	},

	draw: function(d) {
		this.data = d;
		this.g = me.graph(d.objects);
		this.lay = layout(this.g);
		this.empty.hidden = Object.keys(this.g.classes[268] || {}).length > 0;
		this.renderMap();
		this.renderList();
		this.zoom(this.scale || 1);
		this.mark();
	},

	refresh: function() {
		var self = this;
		return L.resolveDefault(callMap(), null).then(function(d) {
			var s = d && JSON.stringify(d.objects);
			if (d && s != self.shown) {
				self.shown = s;
				self.draw(d);
			}
		});
	},

	/* pan by dragging empty space, Ctrl + wheel zooms */
	wire: function(node) {
		var self = this, drag = null;

		node.addEventListener('pointerdown', function(ev) {
			if (ev.target.closest('button'))
				return;
			drag = [ ev.clientX, ev.clientY, node.scrollLeft, node.scrollTop ];
			node.classList.add('drag');
			node.setPointerCapture(ev.pointerId);
		});
		node.addEventListener('pointermove', function(ev) {
			if (drag) {
				node.scrollLeft = drag[2] - (ev.clientX - drag[0]);
				node.scrollTop = drag[3] - (ev.clientY - drag[1]);
			}
		});
		[ 'pointerup', 'pointercancel' ].forEach(function(t) {
			node.addEventListener(t, function() { drag = null; node.classList.remove('drag'); });
		});
		node.addEventListener('wheel', function(ev) {
			if (ev.ctrlKey) {
				ev.preventDefault();
				self.zoom(self.scale * (ev.deltaY < 0 ? 1.1 : 0.9));
			}
		}, { passive: false });
	},

	render: function(data) {
		var self = this, btn = function(label, title, fn) {
			return E('button', { 'type': 'button', 'class': 'btn cbi-button', 'title': title, 'aria-label': title, 'click': fn }, label);
		};

		if (!data)
			return E([], [ E('h2', {}, _('Fibre provisioning')), E('p', {}, _('The fibre backend (alphawrt.fibre) is not answering.')) ]);

		this.canvas = E('div', { 'class': 'aw-canvas' });
		this.sizer = E('div', {}, this.canvas);
		this.mapNode = E('div', { 'class': 'aw-map', 'aria-label': _('Provisioning map') }, this.sizer);
		this.empty = E('p', { 'class': 'alert-message', 'hidden': 'hidden' }, _('The ISP has not set up any service on this box yet. What is drawn here is what the box offers.'));
		this.chips = E('div', { 'class': 'aw-chips' });
		this.list = E('div', { 'class': 'aw-list' });
		this.detail = E('div', { 'class': 'aw-detail' });
		this.wire(this.mapNode);

		var page = E('div', { 'class': 'aw-pv' }, [
			E('style', {}, CSS),
			E('h2', {}, _('Fibre provisioning')),
			E('p', {}, _('What your ISP set up on this box over OMCI, from the fibre on the left to the box\'s ports on the right. Select a box to follow its path. Read only: nothing here changes the line.')),
			this.empty,
			E('div', { 'style': 'position:relative' }, [
				this.mapNode,
				E('div', { 'style': 'position:absolute;right:12px;bottom:12px;display:flex;gap:4px;z-index:2' }, [
					btn('+', _('Zoom in'), function() { self.zoom(self.scale * 1.2); }),
					btn('−', _('Zoom out'), function() { self.zoom(self.scale / 1.2); }),
					btn('↔', _('Fit to width'), function() { self.fit(); })
				])
			]),
			E('div', { 'class': 'aw-legend' }, Object.keys(ORIGIN).map(function(k) {
				return E('span', { 'style': '--o:' + ORIGIN[k][1] }, ORIGIN[k][0]);
			}).concat(E('span', { 'class': 'dash' }, _('Not in the MIB, or a pointer to nothing')), _('Drag to move, Ctrl + wheel or the buttons to zoom, arrow keys to move between boxes.'))),
			E('div', { 'class': 'aw-split' }, [
				E('div', {}, [ E('h3', {}, _('Every managed entity')), this.chips, this.list ]),
				E('div', {}, [ E('h3', {}, _('Details')), this.detail ])
			])
		]);

		this.shown = JSON.stringify(data.objects);
		this.draw(data);
		/* the page is in the document only after this returns, and only then has a width */
		window.setTimeout(function() { self.fit(); }, 0);
		poll.add(function() { return self.refresh(); }, 30);

		return page;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
