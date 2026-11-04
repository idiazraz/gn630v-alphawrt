// rpcd backend for the phone line (Simple UI Phone page).
//   status   ports (TEL ports the FXS driver exposes), driver (fxs baresip
//            module present), running, registered (null when unknown)
//   ring     ring the phone for a few seconds (bench check of the port)
// Registration comes from baresip's ctrl_tcp (netstring JSON on 127.0.0.1:4444).
// Limit: the reginfo text is matched for "OK"; not yet checked against a live line.

'use strict';

import { glob, access, popen } from 'fs';

function sh(cmd) {
	const p = popen(cmd);
	if (!p) return null;
	const out = p.read('all');
	p.close();
	return out;
}

function reginfo() {
	let socket;
	try { socket = require('socket'); } catch (e) { return null; }
	const s = socket.connect('127.0.0.1', '4444', null, 1000);
	if (!s) return null;
	const msg = sprintf('%J', { command: 'reginfo', token: 'ui' });
	s.send(`${length(msg)}:${msg},`);
	const r = s.recv(4096);
	s.close();
	if (!r) return null;
	const m = match(r, /^[0-9]+:(.*),$/s);
	const j = m ? json(m[1]) : null;
	return j?.data ?? null;
}

const methods = {
	status: {
		call: function() {
			const ports = length(glob('/dev/en75xx-fxs*') ?? []);
			const running = sh('pidof baresip') ? true : false;
			const info = running ? reginfo() : null;
			return {
				ports,
				driver: access('/usr/lib/baresip/modules/fxs.so') ? true : false,
				running,
				registered: info == null ? null : (match(info, /\bOK\b/) ? true : false),
				reginfo: info
			};
		}
	},
	ring: {
		call: function() {
			if (!access('/dev/en75xx-fxs0')) return { error: 'The TEL port driver isn’t loaded.' };
			if (!access('/usr/bin/en75xx-test')) return { error: 'The ring test tool isn’t in this build.' };
			sh('/usr/bin/en75xx-test /dev/en75xx-fxs0 ring 3 >/dev/null 2>&1 &');
			return { ok: true };
		}
	}
};

return { 'alphawrt-voice': methods };
