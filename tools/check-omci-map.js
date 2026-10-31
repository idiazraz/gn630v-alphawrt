#!/usr/bin/env node
/*
 * Checks the provisioning map's decoder (luci-app-alphawrt, alphawrt/omcime.js):
 * the graph it builds from a small MIB, and, given the kernel's me.c, that its
 * attribute offsets, sizes and access match the kernel's table.
 *
 *   node tools/check-omci-map.js [net/xpon/omci/me.c]
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

global._ = s => s;
String.prototype.format = function(...a) {
	return this.replace(/%[ds]/g, () => a.shift());
};

const file = path.join(__dirname, '../package/luci-app-alphawrt/htdocs/luci-static/resources/alphawrt/omcime.js');
const me = new Function('baseclass', fs.readFileSync(file, 'utf8'))({ extend: o => o });

/* kernel table name -> class */
const TABLES = { software_image: 7, cardholder: 5, circuit_pack: 6, pptp_ethernet_uni: 11, bridge_port: 47, vlan_filter: 84,
	vlan_tagging_op: 78, '8021p_mapper': 130, extended_vlan: 171, tcont: 262, uni_g: 264, gem_iwtp: 266, gem_port_ctp: 268, veip: 329 };
const ACCESS = { OMCI_R: 'R', OMCI_RW: 'RW', OMCI_RW_SC: 'RWS' };

function checkKernel(src) {
	for (const [ table, cls ] of Object.entries(TABLES)) {
		const body = src.match(new RegExp(`omci_${table}_attrs\\[\\] = \\{([^}]+)\\}`));
		assert(body, `no table ${table} in me.c`);
		const attrs = [ ...body[1].matchAll(/OMCI_ATTR\((\d+), (\d+), (\w+), (\w+)\)/g) ];
		const ours = me.CLASSES[cls][1];
		assert.equal(attrs.length, ours.length, `class ${cls}: attribute count`);
		let off = 0;
		attrs.forEach((a, i) => {
			const len = a[3] == 'OMCI_SOFTWARE_VERSION_LEN' ? 14 : +a[3];
			assert.equal(+a[1], 15 - i, `class ${cls} attribute ${i + 1}: not in mask order`);
			assert.equal(+a[2], off, `class ${cls} attribute ${i + 1}: offset`);
			assert.equal(len, ours[i][1], `class ${cls} attribute ${i + 1}: size`);
			assert.equal(ACCESS[a[4]], ours[i][3], `class ${cls} attribute ${i + 1}: access`);
			off += len;
		});
	}
}

const h = (...v) => v.map(([ n, w ]) => n.toString(16).padStart(w * 2, '0')).join('');
const obj = (cls, id, data, extra) => ({ class: cls, id, name: 'x', origin: 2, mask: 0xffff, data, ...extra });

/* one service: T-CONT -> GEM -> mapper -> bridge port -> bridge -> bridge port -> VEIP, plus faults */
const mib = [
	obj(262, 0x8000, h([ 264, 2 ], [ 0, 1 ], [ 2, 1 ])),
	obj(262, 0x8001, h([ 0xffff, 2 ], [ 0, 1 ], [ 2, 1 ])),
	obj(277, 0x8000, h([ 0, 8 ], [ 0, 1 ], [ 0x8000, 2 ], [ 7, 2 ])),
	obj(268, 0x108, h([ 264, 2 ], [ 0x8000, 2 ], [ 3, 1 ], [ 0x8000, 2 ])),
	obj(268, 0x1ff, h([ 4095, 2 ], [ 0, 2 ], [ 2, 1 ])),
	obj(266, 0x108, h([ 0x108, 2 ], [ 5, 1 ])),
	obj(281, 1, h([ 4095, 2 ], [ 0, 2 ])),
	obj(130, 0xe102, h([ 0, 2 ], ...Array(8).fill([ 0x108, 2 ]))),
	obj(45, 0x102, ''),
	obj(47, 0xe102, h([ 0x102, 2 ], [ 1, 1 ], [ 3, 1 ], [ 0xe102, 2 ])),
	obj(47, 0xe01, h([ 0x102, 2 ], [ 2, 1 ], [ 11, 1 ], [ 0xe01, 2 ])),
	obj(47, 0x101, h([ 0x102, 2 ], [ 3, 1 ], [ 1, 1 ], [ 0x101, 2 ])),
	obj(84, 0xe102, h([ 500, 2 ]).padEnd(48, '0') + h([ 4, 1 ], [ 1, 1 ])),
	obj(171, 0xe01, h([ 10, 1 ]).padEnd(48, '0') + h([ 0xe01, 2 ]), { extended_vlan: { rules: [
		{ filter_outer_pbit: 15, filter_inner_pbit: 15, filter_outer_vid: 4096, filter_inner_vid: 4096, filter_ethertype: 0,
			tags_to_remove: 0, treat_outer_pbit: 15, treat_outer_vid: 0, treat_inner_pbit: 0, treat_inner_vid: 500 },
		{ filter_outer_pbit: 15, filter_inner_pbit: 8, filter_outer_vid: 4096, filter_inner_vid: 600, filter_ethertype: 0,
			tags_to_remove: 3, treat_outer_pbit: 15, treat_outer_vid: 0, treat_inner_pbit: 15, treat_inner_vid: 0 } ] } }),
	obj(329, 0xe01, h([ 0, 1 ], [ 0, 1 ])),
	obj(256, 0, null),
	obj(6, 1, h([ 0, 2 ]) + 'x'.repeat(16))
];

const g = me.graph(mib), links = g.links.map(l => `${l.a}>${l.b}`);

for (const l of [ 'fibre>262:32768', '262:32768>268:264', 'fibre>268:511', '268:264>130:57602', '130:57602>47:57602',
	'47:57602>45:258', '45:258>47:3585', '47:3585>329:3585' ])
	assert(links.includes(l), `missing link ${l}: ${links}`);

assert.equal(g.nodes['262:32768'].pill, '1 queues · in use: 1');
assert.equal(g.nodes['262:unused'].title, '1 unused');
assert.equal(g.nodes['268:511'].pill, 'multicast IW 0x0001', 'raw 281 joined by GEM Port-ID');
assert.equal(g.nodes['47:57602'].pill, 'VLAN filter: 500');
assert.equal(g.nodes['329:3585'].pill, 'VLAN rules: 2');
assert.deepEqual(g.nodes['329:3585'].attached, [ '171:3585' ]);

/* the bridge port on the Ethernet port points at nothing */
assert(g.nodes['11:257'].missing, 'dangling bridge port pointer gets a dashed box');
assert(g.links.some(l => l.b == '11:257' && l.bad));

const r = me.rules(mib[13]);
assert.equal(me.ruleMatch(r[0]) + ' > ' + me.ruleAction(r[0]), 'untagged > add VLAN 500 p-bit 0');
assert.equal(me.ruleMatch(r[1]) + ' > ' + me.ruleAction(r[1]), 'VLAN 600 > drop');

const a = me.attributes(mib[3]);
assert.equal(a[0].value, '264');
assert.equal(a[2].value, 'both ways');
assert.equal(a[1].target, 262);
assert.equal(me.attributes(mib[6]), null, 'a class the kernel keeps raw stays raw');
assert.equal(me.attributes(mib[15]), null, 'a hidden object has no attributes');
assert.equal(me.attributes(mib[16])[2].value, 'hidden', 'masked bytes never decode');

if (process.argv[2])
	checkKernel(fs.readFileSync(process.argv[2], 'utf8'));
console.log('omci map: ok' + (process.argv[2] ? ', kernel table matches' : ''));
