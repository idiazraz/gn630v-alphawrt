'use strict';
'require baseclass';

/*
 * OMCI managed entities for the provisioning map: what the attribute bytes
 * of each class mean (G.988) and how the entities join up, from the fibre to
 * the box's ports. No DOM here: tools/check-omci-map.js runs this file.
 *
 * Only classes the kernel stores by attribute are in CLASSES, at the kernel's
 * offsets (omci_me_descs in net/xpon/omci/me.c and the priority queue and
 * scheduler layouts in agent.c); the check compares them. Any other class is
 * kept as the OLT sent it, and a Set lands at offset 0 whatever attribute it
 * carries, so its bytes can't be read by attribute and stay raw.
 */

var STATE = { 0: _('unlocked'), 1: _('locked') },
    OPER = { 0: _('enabled'), 1: _('disabled') },
    DIRECTION = { 1: _('upstream only'), 2: _('downstream only'), 3: _('both ways') },
    POLICY = { 0: _('none'), 1: _('strict priority'), 2: 'WRR' },
    IW_OPTION = { 0: _('circuit emulated'), 1: _('MAC bridged'), 5: _('802.1p mapper'), 6: _('downstream broadcast') },
    TP_TYPE = { 1: _('Ethernet port'), 3: _('802.1p mapper'), 4: _('IP host'), 5: _('GEM interworking'),
	6: _('multicast GEM interworking'), 11: _('virtual port (VEIP)') },
    ASSOCIATION = { 0: _('MAC bridge port'), 1: _('802.1p mapper'), 2: _('Ethernet port'), 3: _('IP host'),
	5: _('GEM interworking'), 6: _('multicast GEM interworking'), 10: _('virtual port (VEIP)') },
    /* G.988 Table 9.3.11-1, the commonly seen codes; the raw code is always shown beside these */
    FORWARD = { 0: _('all frames pass'), 1: _('tagged frames are dropped'), 2: _('untagged frames are dropped'),
	3: _('only listed VLANs pass; untagged frames pass'), 4: _('only listed VLANs pass; untagged frames are dropped'),
	5: _('listed VLANs are dropped; untagged frames pass'), 6: _('listed VLANs are dropped; untagged frames are dropped') },
    US_MODE = { 0: _('leave frames as they are') },
    DS_MODE = { 0: _('leave frames as they are') };

/* class -> [ short name, [ attribute name, bytes, type, access ]... ], attributes in G.988 order */
var CLASSES = {
	5: [ _('Cardholder'), [ [ _('Actual plug-in type'), 1, 'u', 'R' ], [ _('Expected plug-in type'), 1, 'u', 'RW' ],
		[ _('Expected port count'), 1, 'u', 'RW' ], [ _('Expected equipment ID'), 20, 's', 'RW' ],
		[ _('Actual equipment ID'), 20, 's', 'RW' ], [ _('Protection profile pointer'), 2, 'u', 'R' ] ] ],
	6: [ _('Circuit pack'), [ [ _('Type'), 1, 'u', 'R' ], [ _('Number of ports'), 1, 'u', 'R' ], [ _('Serial number'), 8, 'x', 'R' ],
		[ _('Version'), 14, 's', 'R' ], [ _('Vendor ID'), 4, 's', 'R' ], [ _('Administrative state'), 1, STATE, 'RW' ],
		[ _('Operational state'), 1, OPER, 'R' ], [ _('Bridged or IP'), 1, 'u', 'RW' ], [ _('Equipment ID'), 20, 's', 'R' ],
		[ _('Card configuration'), 1, 'u', 'RW' ], [ _('T-CONT buffers'), 1, 'u', 'R' ], [ _('Priority queues'), 1, 'u', 'R' ],
		[ _('Traffic schedulers'), 1, 'u', 'R' ], [ _('Power shed override'), 4, 'x', 'RW' ] ] ],
	7: [ _('Software image'), [ [ _('Version'), 14, 's', 'R' ], [ _('Committed'), 1, 'u', 'R' ], [ _('Active'), 1, 'u', 'R' ], [ _('Valid'), 1, 'u', 'R' ] ] ],
	11: [ _('Ethernet port'), [ [ _('Expected type'), 1, 'u', 'R' ], [ _('Sensed type'), 1, 'u', 'R' ], [ _('Auto detection'), 1, 'u', 'RW' ],
		[ _('Ethernet loopback'), 1, 'u', 'RW' ], [ _('Administrative state'), 1, STATE, 'RW' ], [ _('Operational state'), 1, OPER, 'R' ],
		[ _('Configuration'), 1, 'u', 'R' ], [ _('Max frame size'), 2, 'u', 'RW' ], [ _('DTE or DCE'), 1, 'u', 'RW' ], [ _('Pause time'), 2, 'u', 'RW' ],
		[ _('Bridged or IP'), 1, 'u', 'RW' ], [ _('ARC'), 1, 'u', 'RW' ], [ _('ARC interval'), 1, 'u', 'RW' ], [ _('PPPoE filter'), 1, 'u', 'RW' ],
		[ _('Power control'), 1, 'u', 'RW' ] ] ],
	47: [ _('Bridge port'), [ [ _('MAC bridge'), 2, 'p45', 'RWS' ], [ _('Port number'), 1, 'u', 'RWS' ], [ _('Connects to'), 1, TP_TYPE, 'RWS' ],
		[ _('Connection pointer'), 2, 'tp', 'RWS' ], [ _('Port priority'), 2, 'u', 'RWS' ], [ _('Path cost'), 2, 'u', 'RWS' ],
		[ _('Spanning tree'), 1, 'u', 'RWS' ], [ _('Encapsulation (deprecated)'), 1, 'u', 'RWS' ], [ _('LAN FCS'), 1, 'u', 'RWS' ],
		[ _('Port MAC address'), 6, 'x', 'R' ], [ _('Outbound traffic descriptor'), 2, 'x', 'RW' ], [ _('Inbound traffic descriptor'), 2, 'x', 'RW' ],
		[ _('MAC learning depth'), 1, 'u', 'RWS' ] ] ],
	78: [ _('VLAN tagging'), [ [ _('Upstream mode'), 1, US_MODE, 'RWS' ], [ _('Upstream TCI'), 2, 'tci', 'RWS' ], [ _('Downstream mode'), 1, DS_MODE, 'RWS' ],
		[ _('Association type'), 1, 'u', 'RWS' ], [ _('Associated entity'), 2, 'x', 'RWS' ] ] ],
	84: [ _('VLAN filter'), [ [ _('VLAN list'), 24, 'vlans', 'RWS' ], [ _('Forward operation'), 1, FORWARD, 'RWS' ], [ _('Number of entries'), 1, 'u', 'RWS' ] ] ],
	130: [ _('802.1p mapper'), [ [ _('Connection pointer'), 2, 'x', 'RWS' ], [ _('P-bit 0'), 2, 'p266', 'RWS' ], [ _('P-bit 1'), 2, 'p266', 'RWS' ],
		[ _('P-bit 2'), 2, 'p266', 'RWS' ], [ _('P-bit 3'), 2, 'p266', 'RWS' ], [ _('P-bit 4'), 2, 'p266', 'RWS' ], [ _('P-bit 5'), 2, 'p266', 'RWS' ],
		[ _('P-bit 6'), 2, 'p266', 'RWS' ], [ _('P-bit 7'), 2, 'p266', 'RWS' ], [ _('Unmarked frames'), 1, 'u', 'RWS' ],
		[ _('DSCP to p-bit map'), 24, 'x', 'RW' ], [ _('Default p-bit'), 1, 'u', 'RWS' ], [ _('Connection type'), 1, 'u', 'RWS' ] ] ],
	171: [ _('VLAN rules'), [ [ _('Association type'), 1, ASSOCIATION, 'RWS' ], [ _('Rule table size'), 2, 'u', 'R' ], [ _('Input TPID'), 2, 'x', 'RW' ],
		[ _('Output TPID'), 2, 'x', 'RW' ], [ _('Downstream mode'), 1, 'u', 'RW' ], [ _('Last rule received'), 16, 'x', 'RW' ],
		[ _('Associated entity'), 2, 'x', 'RWS' ], [ _('DSCP to p-bit map'), 24, 'x', 'RW' ] ] ],
	262: [ _('T-CONT'), [ [ _('Alloc-ID'), 2, 'u', 'RW' ], [ _('Deprecated'), 1, 'u', 'R' ], [ _('Scheduling policy'), 1, POLICY, 'RW' ] ] ],
	264: [ _('UNI-G'), [ [ _('Deprecated'), 2, 'u', 'RW' ], [ _('Administrative state'), 1, STATE, 'RW' ], [ _('Management capability'), 1, 'u', 'R' ],
		[ _('Non-OMCI management ID'), 2, 'x', 'RW' ] ] ],
	266: [ _('GEM interworking'), [ [ _('GEM port'), 2, 'p268', 'RWS' ], [ _('Interworking option'), 1, IW_OPTION, 'RWS' ], [ _('Service profile'), 2, 'x', 'RWS' ],
		[ _('Interworking pointer'), 2, 'x', 'RWS' ], [ _('Port counter'), 1, 'u', 'R' ], [ _('Operational state'), 1, OPER, 'R' ],
		[ _('GAL profile'), 2, 'p272', 'RWS' ], [ _('GAL loopback'), 1, 'u', 'RW' ] ] ],
	268: [ _('GEM port'), [ [ _('Port-ID'), 2, 'u', 'RWS' ], [ _('T-CONT'), 2, 'p262', 'RWS' ], [ _('Direction'), 1, DIRECTION, 'RWS' ],
		[ _('Upstream queue'), 2, 'p277', 'RWS' ], [ _('Upstream traffic descriptor'), 2, 'x', 'RWS' ], [ _('Port counter'), 1, 'u', 'R' ],
		[ _('Downstream queue'), 2, 'p277', 'RWS' ], [ _('Encryption state'), 1, 'u', 'R' ], [ _('Downstream traffic descriptor'), 2, 'x', 'RWS' ],
		[ _('Encryption key ring'), 2, 'u', 'RW' ] ] ],
	277: [ _('Priority queue'), [ [ _('Queue configuration'), 1, 'u', 'R' ], [ _('Max queue size'), 2, 'u', 'R' ], [ _('Allocated queue size'), 2, 'u', 'RW' ],
		[ _('Discard counter reset'), 2, 'u', 'RW' ], [ _('Discard threshold'), 2, 'u', 'RW' ], [ _('Related port'), 4, 'x', 'RW' ],
		[ _('Traffic scheduler'), 2, 'p278', 'RW' ], [ _('Weight'), 1, 'u', 'RW' ], [ _('Back pressure operation'), 2, 'u', 'RW' ],
		[ _('Back pressure time'), 4, 'u', 'RW' ], [ _('Back pressure occur level'), 2, 'u', 'RW' ], [ _('Back pressure clear level'), 2, 'u', 'RW' ] ] ],
	278: [ _('Traffic scheduler'), [ [ _('T-CONT'), 2, 'p262', 'R' ], [ _('Parent scheduler'), 2, 'p278', 'R' ], [ _('Policy'), 1, POLICY, 'RW' ], [ _('Priority or weight'), 1, 'u', 'RW' ] ] ],
	329: [ _('Virtual port (VEIP)'), [ [ _('Administrative state'), 1, STATE, 'RW' ], [ _('Operational state'), 1, OPER, 'R' ], [ _('Interdomain name'), 25, 's', 'RW' ],
		[ _('TCP/UDP pointer'), 2, 'x', 'RW' ], [ _('IANA assigned port'), 2, 'u', 'R' ] ] ]
};

/* short names of classes that stay raw */
var NAMES = { 2: _('ONU data'), 45: _('MAC bridge'), 256: 'ONU-G', 257: 'ONU2-G', 263: 'ANI-G', 272: _('GAL profile'), 281: _('Multicast interworking'),
	310: _('Multicast subscriber'), 309: _('Multicast profile') };

var ORIGINS = [ 'default', 'local', 'olt', 'hardware' ];

function hex(n, w) { return n == null ? '-' : '0x' + Number(n).toString(16).padStart(w || 4, '0'); }
function nullPtr(n) { return n == 0 || n == 0xffff; }
function noAlloc(a) { return a == null || a == 0xff || a == 0xffff; }

/* len bytes at off as hex, zero padded, or null when the bytes are masked */
function bytes(o, off, len) {
	var s = (o.data || '').substr(off * 2, len * 2).padEnd(len * 2, '0');
	return s.indexOf('x') < 0 ? s : null;
}

function uint(o, off, len) {
	var s = bytes(o, off, len);
	return s == null ? null : parseInt(s, 16);
}

function text(s) {
	return s.replace(/(..)/g, function(b) { var c = parseInt(b, 16); return c >= 32 && c < 127 ? String.fromCharCode(c) : c ? '.' : ''; });
}

function vlans(o) {
	var n = Math.min(uint(o, 25, 1) || 0, 12), out = [], i;
	for (i = 0; i < n; i++)
		out.push(uint(o, i * 2, 2) & 0xfff);
	return out;
}

function forward(op) {
	return FORWARD[op] != null ? FORWARD[op] : _('forward operation %d').format(op);
}

/* the VLAN filter in a line */
function filterText(o) {
	var v = vlans(o), op = uint(o, 24, 1);
	return (v.length ? 'VLAN ' + v.join(', ') + ': ' : '') + forward(op);
}

/* what a rule of the extended VLAN table matches and does, G.988 9.3.13 */
function ruleMatch(r) {
	var two = r.filter_outer_pbit != 15, one = r.filter_inner_pbit != 15, out = [],
	    pbit = two ? r.filter_outer_pbit : r.filter_inner_pbit, vid = two ? r.filter_outer_vid : r.filter_inner_vid;

	if (!two && !one)
		out.push(_('untagged'));
	else {
		out.push(pbit == 14 ? _('any other tagged') : two ? _('double tagged') : vid < 4095 ? 'VLAN ' + vid : _('any tagged'));
		if (two && vid < 4095)
			out.push('VLAN ' + vid);
		if (pbit < 8)
			out.push(_('p-bit %d').format(pbit));
	}
	if ({ 1: 1, 2: 1, 3: 1, 4: 1 }[r.filter_ethertype])
		out.push([ '', 'IPoE', 'PPPoE', 'ARP', 'IPv6' ][r.filter_ethertype]);
	return out.join(' ');
}

function ruleTag(pbit, vid) {
	if (pbit == 15)
		return null;
	return (vid == 4096 ? _('inner VLAN') : vid == 4097 ? _('outer VLAN') : 'VLAN ' + vid) +
		(pbit < 8 ? ' ' + _('p-bit %d').format(pbit) : pbit == 10 ? ' ' + _('p-bit from DSCP') : '');
}

function ruleAction(r) {
	var add = [ ruleTag(r.treat_outer_pbit, r.treat_outer_vid), ruleTag(r.treat_inner_pbit, r.treat_inner_vid) ].filter(Boolean), out = [];

	if (r.tags_to_remove == 3)
		return _('drop');
	if (r.tags_to_remove)
		out.push(_('remove %d tag(s)').format(r.tags_to_remove));
	if (add.length)
		out.push(_('add %s').format(add.join(' + ')));
	return out.join(', ') || _('pass unchanged');
}

function rules(o) {
	return ((o.extended_vlan || {}).rules || []).filter(function(r) { return !r.delete; });
}

function shortName(c, name) {
	return (CLASSES[c] || [])[0] || NAMES[c] || name || _('Class %d').format(c);
}

/* attributes with their offset, value and raw bytes, or null for a raw class */
function attributes(o) {
	var c = CLASSES[o.class], off = 0;

	return !c || o.data == null ? null : c[1].map(function(a, i) {
		var raw = bytes(o, off, a[1]), t = a[2], at = off, n, v;

		off += a[1];
		n = raw != null && a[1] <= 4 ? parseInt(raw, 16) : null;
		if (raw == null)
			v = _('hidden');
		else if (t == 's')
			v = text(raw);
		else if (t == 'tci')
			v = 'VLAN %d, p-bit %d'.format(n & 0xfff, n >> 13);
		else if (t == 'vlans')
			v = vlans(o).join(', ') || _('none');
		else if (typeof t == 'object')
			v = t[n] != null ? t[n] : String(n);
		else if (t == 'u')
			v = a[1] <= 4 ? String(n) : raw;
		else
			v = a[1] <= 4 ? hex(n, a[1] * 2) : raw;

		return { index: i + 1, name: a[0], len: a[1], offset: at, access: a[3], value: v, raw: raw, num: n,
			set: !!(o.mask & (0x8000 >> i)), target: t == 'tp' ? TP_CLASS[uint(o, 3, 1)] : /^p\d+$/.test(t) ? +t.substr(1) : null };
	});
}

/* the class a bridge port's connection pointer lands on */
var TP_CLASS = { 1: 11, 3: 130, 5: 266, 6: 281, 11: 329 };
/* the class an extended VLAN table hangs on, by association type */
var ASSOC_CLASS = { 0: 47, 1: 130, 2: 11, 5: 266, 6: 281, 10: 329 };

/* one line for the list of entities */
function summary(o) {
	if (o.data == null)
		return _('hidden: identity, address or login');
	switch (o.class) {
	case 84: return filterText(o);
	case 171: return _('%d rule(s), %s').format(rules(o).length, ASSOCIATION[uint(o, 0, 1)] || '-');
	case 262: return noAlloc(uint(o, 0, 2)) ? _('no Alloc-ID from the ISP') : 'Alloc-ID ' + uint(o, 0, 2);
	case 268: return 'GEM %d, %s'.format(uint(o, 0, 2), DIRECTION[uint(o, 4, 1)] || '-');
	case 47: return '%s %s'.format(TP_TYPE[uint(o, 3, 1)] || _('type %d').format(uint(o, 3, 1)), hex(uint(o, 4, 2)));
	case 11: case 329: return STATE[uint(o, o.class == 11 ? 4 : 0, 1)] || '-';
	case 277: return _('port %s').format(bytes(o, 9, 4));
	case 278: return _('T-CONT %s').format(hex(uint(o, 0, 2)));
	case 266: return _('GEM %s, %s').format(hex(uint(o, 0, 2)), IW_OPTION[uint(o, 2, 1)] || '-');
	case 7: return text(bytes(o, 0, 14));
	}
	return CLASSES[o.class] ? '' : _('kept as sent, not decoded');
}

/*
 * The set-up as boxes in columns, fibre on the left, ports on the right. A
 * pointer to an entity that doesn't exist gets a dashed box, so a fault in
 * the provisioning shows instead of a line that stops.
 */
function graph(objects) {
	var by = {}, all = {}, nodes = {}, links = [], rails = {}, unused = [], usedQueue = {}, g;
	var key = function(c, e) { return c + ':' + e; };
	var list = function(c) { return by[c] || []; };

	objects.forEach(function(o) {
		(by[o.class] = by[o.class] || []).push(o);
		all[key(o.class, o.id)] = o;
	});

	function node(col, o, title, sub, pill) {
		var k = key(o.class, o.id);
		nodes[k] = nodes[k] || { key: k, col: col, title: title, sub: sub, pill: pill, origin: o.origin, attached: [] };
		return nodes[k];
	}

	function missing(col, c, id, title) {
		var k = key(c, id);
		nodes[k] = nodes[k] || { key: k, col: col, title: title, sub: _('not in the MIB: %s').format(hex(id)), missing: true, attached: [] };
		return nodes[k];
	}

	function link(a, b, bad) {
		if (a && b)
			links.push({ a: a.key || a, b: b.key || b, bad: !!bad });
	}

	/* extended VLAN tables and VLAN tagging, keyed by what they hang on */
	var vlanOn = {};
	list(171).forEach(function(o) {
		var k = key(ASSOC_CLASS[uint(o, 0, 1)], uint(o, 24, 2));
		(vlanOn[k] = vlanOn[k] || []).push(o);
	});
	list(78).forEach(function(o) {
		(vlanOn[key(11, o.id)] = vlanOn[key(11, o.id)] || []).push(o);
	});
	function vlanPill(k) {
		var v = vlanOn[k], o = v && v[0];
		if (!o)
			return null;
		return o.class == 171 ? _('VLAN rules: %d').format(rules(o).length)
			: uint(o, 0, 1) ? _('adds VLAN %d').format(uint(o, 1, 2) & 0xfff) : _('VLAN as is');
	}
	function attach(n, k) {
		(vlanOn[k] || []).forEach(function(o) { n.attached.push(key(o.class, o.id)); });
	}

	list(268).forEach(function(o) {
		usedQueue[uint(o, 5, 2)] = 1;
	});

	/* T-CONTs the OLT gave an Alloc-ID */
	list(262).forEach(function(o) {
		var alloc = uint(o, 0, 2);
		if (noAlloc(alloc))
			return unused.push(o);
		var q = list(277).filter(function(p) { return uint(p, 9, 2) == o.id; }),
		    used = q.filter(function(p) { return usedQueue[p.id]; }).length;
		link('fibre', node(0, o, 'Alloc-ID ' + alloc, '%s · %s'.format(hex(o.id), POLICY[uint(o, 3, 1)] || '-'),
			q.length ? _('%d queues · in use: %d').format(q.length, used) : null));
	});

	/* interworking points on a GEM port: 266 by pointer, 281 is raw, see below */
	var iwOf = {}, mcGem = {};
	list(266).forEach(function(o) {
		var c = key(268, uint(o, 0, 2));
		(iwOf[c] = iwOf[c] || []).push(o);
	});
	list(281).forEach(function(o) {
		/*
		 * A Set of its address table overwrites the pointer with that
		 * table's GEM Port-ID, and the two are told apart by which exists.
		 */
		var p = uint(o, 0, 2), g = all[key(268, p)] || list(268).filter(function(x) { return uint(x, 0, 2) == p; })[0];
		if (g) {
			(iwOf[key(268, g.id)] = iwOf[key(268, g.id)] || []).push(o);
			mcGem[o.id] = g.id;
		}
	});

	list(268).forEach(function(o) {
		var dir = uint(o, 4, 1), t = uint(o, 2, 2), iw = iwOf[key(268, o.id)] || [], tk = key(262, t),
		    n = node(1, o, 'GEM ' + uint(o, 0, 2), '%s · %s'.format(hex(o.id), DIRECTION[dir] || '-'), iw.length
			? (iw[0].class == 281 ? _('multicast IW %s') : _('IW %s')).format(hex(iw[0].id)) +
				(iw[0].class == 266 ? ' · ' + (IW_OPTION[uint(iw[0], 2, 1)] || '') : '') : _('no interworking point'));

		if (dir == 2 || (nullPtr(t) && !nodes[tk]))
			link('fibre', n);
		else if (nodes[tk])
			link(tk, n);
		else if (all[tk])
			link(key(262, 'unused'), n, true);
		else
			link(missing(0, 262, t, 'T-CONT'), n, true);
	});

	/* the GEM port behind an interworking point; { n, bad }, or null when a raw 281 can't tell */
	function source(c, id) {
		var o = all[key(c, id)], k;

		if (!o)
			return { n: missing(1, c, id, _('GEM interworking')), bad: true };
		if (c == 281)
			return mcGem[id] != null ? { n: nodes[key(268, mcGem[id])] } : null;
		k = key(268, uint(o, 0, 2));
		return nodes[k] ? { n: nodes[k] } : { n: missing(1, 268, uint(o, 0, 2), _('GEM port')), bad: true };
	}

	list(130).forEach(function(o) {
		var seen = {}, gems = [], i, p;
		for (i = 0; i < 8; i++) {
			p = uint(o, 2 + i * 2, 2);
			if (nullPtr(p) && !all[key(266, p)])
				continue;
			seen[p] = (seen[p] || []).concat(i);
		}
		for (p in seen)
			gems.push(+p);
		var n = node(2, o, hex(o.id), Object.keys(seen).map(function(p) {
			return 'p-bit ' + seen[p].join(',');
		}).join(' · ').replace(/^p-bit 0,1,2,3,4,5,6,7$/, _('all p-bits')) || _('no GEM mapped'), _('%d GEM port(s)').format(gems.length));
		gems.forEach(function(p) {
			var f = source(266, p);
			link(f.n, n, f.bad);
		});
		attach(n, key(130, o.id));
	});

	list(45).forEach(function(o) {
		rails[key(45, o.id)] = { key: key(45, o.id), id: o.id, ports: [] };
	});

	list(47).forEach(function(o) {
		var type = uint(o, 3, 1), tp = uint(o, 4, 2), b = key(45, uint(o, 0, 2)), c = TP_CLASS[type], ani = type == 3 || type == 5 || type == 6,
		    f = all[key(84, o.id)], sub = all[key(310, o.id)], tk = key(c, tp), pill,
		    n;

		rails[b] = rails[b] || { key: b, id: uint(o, 0, 2), ports: [], missing: !all[b] };
		pill = f ? (vlans(f).length ? _('VLAN filter: %s').format(vlans(f).join(', ')) : _('VLAN filter: none')) : sub ? _('Multicast subscriber') : null;
		n = node(ani ? 3 : 5, o, hex(o.id), '→ %s %s'.format(TP_TYPE[type] || _('type %d').format(type), hex(tp)), pill);
		n.rail = b;
		rails[b].ports.push(n.key);
		[ f, sub ].forEach(function(x) { if (x) n.attached.push(key(x.class, x.id)); });
		attach(n, key(47, o.id));

		if (ani) {
			if (c == 130) {
				if (nodes[tk])
					link(tk, n);
				else
					link(missing(2, 130, tp, _('802.1p mapper')), n, true);
			}
			else {
				var f2 = source(c, tp);
				if (f2)
					link(f2.n, n, f2.bad);
			}
			link(n, b);
		}
		else {
			link(b, n);
			if (c != null) {
				var t = all[tk] ? port(all[tk]) : missing(6, c, tp, TP_TYPE[type]);
				link(n, t, !all[tk]);
			}
		}
	});

	function port(o) {
		var k = key(o.class, o.id), n = nodes[k];

		if (n)
			return n;
		n = node(6, o, shortName(o.class) + ' ' + hex(o.id), STATE[uint(o, o.class == 11 ? 4 : 0, 1)] || '-', vlanPill(k));
		attach(n, k);
		return n;
	}
	list(11).concat(list(329)).forEach(port);

	if (unused.length)
		nodes[key(262, 'unused')] = { key: '262:unused', col: 0, title: _('%d unused').format(unused.length), sub: _('no Alloc-ID from the ISP'),
			origin: unused[0].origin, group: 262, attached: [] };

	return { nodes: nodes, links: links, rails: rails, classes: by, all: all };
}

return baseclass.extend({
	CLASSES: CLASSES,
	ORIGINS: ORIGINS,
	hex: hex,
	attributes: attributes,
	summary: summary,
	shortName: shortName,
	rules: rules,
	ruleMatch: ruleMatch,
	ruleAction: ruleAction,
	graph: graph
});
