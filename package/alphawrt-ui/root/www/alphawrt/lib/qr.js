/*
 * Minimal QR code encoder for Wi-Fi and VPN join codes: byte mode, error
 * correction L, versions 1-10 (up to 271 bytes), drawn as SVG in the
 * browser so keys never leave the page. Follows the structure of Nayuki's
 * QR generator. Checked 2026-10-28: versions 1-10, Wi-Fi strings with every
 * escaped character, an open network and Unicode all decode with Chrome's
 * BarcodeDetector.
 * Limit: one fixed mask (0); any mask decodes, the penalty-based choice
 * only makes some codes slightly easier to scan.
 */

/* ECC level L, by version: data codewords, EC codewords per block, blocks */
const DATA = [ 0, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274 ];
const ECB = [ 0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18 ];
const BLOCKS = [ 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4 ];
const ALIGN = [ [], [], [ 6, 18 ], [ 6, 22 ], [ 6, 26 ], [ 6, 30 ], [ 6, 34 ], [ 6, 22, 38 ], [ 6, 24, 42 ], [ 6, 26, 46 ], [ 6, 28, 50 ] ];

/* GF(256) with the QR polynomial 0x11D */
function mul(x, y) {
	let z = 0;
	for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
	return z;
}

function rsRemainder(data, degree) {
	const gen = new Array(degree).fill(0);
	gen[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) { gen[j] = mul(gen[j], root); if (j + 1 < degree) gen[j] ^= gen[j + 1]; }
		root = mul(root, 2);
	}
	const res = new Array(degree).fill(0);
	for (const b of data) {
		const f = b ^ res.shift();
		res.push(0);
		gen.forEach((g, i) => { res[i] ^= mul(g, f); });
	}
	return res;
}

export function qrMatrix(text) {
	const bytes = [ ...new TextEncoder().encode(text) ];
	let v = 1;
	while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > DATA[v] * 8) v++;
	if (v > 10) throw new Error('Too long for a QR code');

	/* bit stream: byte mode, count, data, terminator, padding */
	const bits = [];
	const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
	put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
	put(0, Math.min(4, DATA[v] * 8 - bits.length));
	put(0, (8 - bits.length % 8) % 8);
	const data = [];
	for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
	for (let p = 0xEC; data.length < DATA[v]; p ^= 0xEC ^ 0x11) data.push(p);

	/* split into blocks, add EC, interleave */
	const nb = BLOCKS[v], short = Math.floor(DATA[v] / nb), longFrom = nb - DATA[v] % nb, blocks = [];
	for (let i = 0, k = 0; i < nb; i++) { const n = short + (i >= longFrom ? 1 : 0); blocks.push(data.slice(k, k + n)); k += n; }
	const ecs = blocks.map(b => rsRemainder(b, ECB[v]));
	const out = [];
	for (let i = 0; i <= short; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
	for (let i = 0; i < ECB[v]; i++) for (const e of ecs) out.push(e[i]);

	/* function patterns */
	const size = 17 + 4 * v, m = [ ...Array(size) ].map(() => Array(size).fill(false)), fn = m.map(r => r.map(() => false));
	const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
	for (let i = 0; i < size; i++) { set(6, i, i % 2 == 0); set(i, 6, i % 2 == 0); }
	for (const [ cx, cy ] of [ [ 3, 3 ], [ size - 4, 3 ], [ 3, size - 4 ] ])
		for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
			const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
			if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d != 2 && d != 4);
		}
	const al = ALIGN[v], last = al.length - 1;
	al.forEach((cx, i) => al.forEach((cy, j) => {
		if ((i == 0 && j == 0) || (i == 0 && j == last) || (i == last && j == 0)) return;
		for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
	}));
	/* format bits: ECC L (01), mask 0 */
	let rem = 1 << 3;
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	const fmt = ((1 << 3) << 10 | rem) ^ 0x5412, fb = i => ((fmt >>> i) & 1) == 1;
	for (let i = 0; i <= 5; i++) set(8, i, fb(i));
	set(8, 7, fb(6)); set(8, 8, fb(7)); set(7, 8, fb(8));
	for (let i = 9; i < 15; i++) set(14 - i, 8, fb(i));
	for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fb(i));
	for (let i = 8; i < 15; i++) set(8, size - 15 + i, fb(i));
	set(8, size - 8, true);
	if (v >= 7) {
		let r = v;
		for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
		const vb = v << 12 | r;
		for (let i = 0; i < 18; i++) {
			const bit = ((vb >>> i) & 1) == 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
			set(a, b, bit); set(b, a, bit);
		}
	}

	/* data in the zigzag, then mask 0 ((x + y) even) */
	let i = 0;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right == 6) right = 5;
		for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
			const x = right - j, y = ((right + 1) & 2) == 0 ? size - 1 - vert : vert;
			if (!fn[y][x] && i < out.length * 8) { m[y][x] = ((out[i >>> 3] >>> (7 - (i & 7))) & 1) == 1; i++; }
			if (!fn[y][x] && (x + y) % 2 == 0) m[y][x] = !m[y][x];
		}
	}
	return m;
}

/* the matrix as an SVG element: always dark on white, with the 4-module quiet zone */
export function qrSvg(text, cls = 'w-56 h-56') {
	const m = qrMatrix(text), n = m.length + 8;
	let d = '';
	m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
	const t = document.createElement('template');
	t.innerHTML = `<svg viewBox="0 0 ${n} ${n}" class="${cls}" role="img" aria-label="QR code" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
	return t.content.firstElementChild;
}

/* WIFI:T:WPA;S:<ssid>;P:<key>;; with \ ; , : " escaped (WS3 contract) */
export const wifiQr = (ssid, key, open) => {
	const e = s => String(s).replace(/([\\;,:"])/g, '\\$1');
	return open ? `WIFI:T:nopass;S:${e(ssid)};;` : `WIFI:T:WPA;S:${e(ssid)};P:${e(key)};;`;
};
