// rpcd backend for the Simple UI Speed test page.
//   servers  nearby Speedtest.net (Ookla) servers, from their public list
//   start    run alphawrt-speedtest in the background, on {host} or the
//            closest of the nearby ones
//   status   progress and result of the current or last run
//   stop     end a run
// The list is cached in /tmp for an hour, since it only changes with location.

'use strict';

import { readfile, writefile, stat, unlink, popen } from 'fs';

const OUT = '/tmp/alphawrt-speedtest.json', LIST = '/tmp/alphawrt-speedtest-servers.json';
const URL = 'https://www.speedtest.net/api/js/servers?engine=js&limit=10';
const HOST = /^[A-Za-z0-9.-]+:[0-9]{1,5}$/;

function sh(cmd) {
	const p = popen(cmd);
	if (!p) return null;
	const out = p.read('all');
	p.close();
	return out;
}

const running = () => !!sh('pidof alphawrt-speedtest');

function servers() {
	const st = stat(LIST);
	if (!st || time() - st.mtime > 3600) {
		const raw = sh(`uclient-fetch -q -T 10 -O - '${URL}' 2>/dev/null`);
		const list = raw ? json(raw) : null;
		if (type(list) != 'array' || !length(list)) return null;
		writefile(LIST, sprintf('%J', map(filter(list, s => match(s.host, HOST)), s => ({
			id: s.id, host: s.host, sponsor: s.sponsor, name: s.name, country: s.country, distance: s.distance
		}))));
	}
	return json(readfile(LIST) ?? '[]');
}

const methods = {
	servers: {
		call: function() {
			const list = servers();
			return list ? { servers: list } : { error: 'Couldn’t reach Speedtest.net. Check that the internet is connected.' };
		}
	},
	start: {
		args: { host: '' },
		call: function(req) {
			if (running()) return { error: 'A speed test is already running.' };
			const list = servers();
			if (!list) return { error: 'Couldn’t reach Speedtest.net. Check that the internet is connected.' };
			const host = req.args?.host;
			const hosts = host ? [ host ] : map(slice(list, 0, 5), s => s.host);
			for (let h in hosts)
				if (!match(h, HOST)) return { error: 'That isn’t a test server.' };
			unlink(OUT);
			sh(`alphawrt-speedtest -o ${OUT} ${join(' ', hosts)} >/dev/null 2>&1 &`);
			return { ok: true };
		}
	},
	status: {
		call: function() {
			const st = json(readfile(OUT) ?? 'null');
			if (!st) return { state: running() ? 'select' : 'idle' };
			const on = running();
			if (!on && index([ 'done', 'error' ], st.state) < 0) { st.state = 'error'; st.error = 'The test stopped.'; }
			const s = filter(json(readfile(LIST) ?? '[]'), s => s.host == st.server)[0];
			if (s) { st.sponsor = s.sponsor; st.name = s.name; }
			st.running = on;
			st.time = stat(OUT)?.mtime;
			return st;
		}
	},
	stop: {
		call: function() {
			sh('killall alphawrt-speedtest 2>/dev/null');
			return { ok: true };
		}
	}
};

return { 'alphawrt-speedtest': methods };
