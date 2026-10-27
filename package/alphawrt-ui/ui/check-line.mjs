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
