// Self-check for the line.js port: node ui/check-line.mjs (run from the package dir)
import assert from 'node:assert/strict';
import line from '../root/www/alphawrt/lib/line.js';

const nw = dbm => Math.pow(10, dbm / 10) * 1e6;
const ln = { counters: {}, thr: { sf: 5, sd: 9, rxMin: -28, rxMax: -8 }, history: [], events: [] };

let v = line.verdict({ state: 5, bosa_rx_power_nw: nw(-19.4) }, ln, 'combo', true);
assert.equal(v.level, 'ok');
assert.equal(v.text, 'Light -19.4 dBm, no line errors in the last 15 minutes.');

assert.equal(line.verdict({ state: 1, bosa_rx_power_nw: 0 }, ln, 'combo', false).title, 'No light from the fibre');
assert.equal(line.verdict({ state: 5, bosa_rx_power_nw: nw(-29) }, ln, 'combo', true).title, 'Light too weak');

const said = { ...ln, events: [ '2026-10-27 21:14:07 ISP says: Authentication failed' ] };
v = line.verdict({ state: 5, bosa_rx_power_nw: nw(-19.4) }, said, 'combo', false);
assert.equal(v.title, 'Fibre OK, the ISP refused the login');
assert.match(v.text, /at 2026-10-27 21:14:07, saying: "Authentication failed"/);

assert.equal(line.verdict({ state: 5, bosa_rx_power_nw: nw(-19.4), bosa_temperature_mc: 90000 }, ln, 'combo', true).text,
	'The optics are at 90 °C. Give the box more air.');
console.log('line.js port: ok');

/* "now" is the box's latest sample, not the browser clock (a bridge-mode box is often a day behind) */
const t0 = Date.now() / 1000 - 30 * 3600;
const hist = { ...ln, history: [ [ t0, 5, nw(-19), null, null, null, 0, 0, 0, 0, 0, 0 ], [ t0 + 600, 5, nw(-19), null, null, null, 0, 0, 3, 0, 0, 0 ] ],
	counters: { hec_uncorrectable: 5, hec_corrected_1bit: 0, hec_corrected_2bit: 0, rx_crc_errors: 0, bip_errors: 0, lof: 0 } };
assert.equal(line.now(hist), t0 + 600);
assert.equal(line.errors(hist, 900).hecu, 5, 'counts errors on the box clock even when the browser is 30 h ahead');
console.log('line.js box clock: ok');
