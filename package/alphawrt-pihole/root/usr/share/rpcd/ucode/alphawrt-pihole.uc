// rpcd backend for Pi-hole on AlphaWRT (Simple UI and LuCI).
//   status      on/off, available (not in bridge mode), blocking, preset,
//               domains on the lists, last update, admin page port
//   set         {enabled, preset, tif, password}: switch Pi-hole on/off etc.
//   update      rebuild gravity now (in the background)
//   pause       {minutes}: stop blocking for that long; 0 = block again
//   stats       {top}: last 24 h totals, top blocked domains, top clients
//   lists       exact allow/deny domains and the devices that bypass Pi-hole
//   set_lists   {allow, deny, bypass}: replace those lists
//   presets     the Hagezi presets for a picker
// FTL's API is used from localhost: without a login while no admin password
// is set, else with FTL's CLI password; list edits go to gravity.db directly.

'use strict';

import { popen, access, readfile } from 'fs';
import { cursor } from 'uci';

const DB = '/tmp/pihole/gravity.db';
const FTL = '/usr/bin/pihole-FTL';
const PIHOLE = '/usr/local/bin/pihole';
const BYPASS = 'AlphaWRT bypass';

const PRESETS = [
	{ id: 'light', name: 'Light', domains: 72000, about: 'Basic: ads, tracking, metrics. Almost never breaks a site.' },
	{ id: 'multi', name: 'Normal', domains: 171000, about: 'All-round: ads, tracking, metrics, telemetry, phishing, malware, scams. Recommended.' },
	{ id: 'pro', name: 'Pro', domains: 210000, about: 'Extended: blocks more, rarely breaks a site; best with someone who can allow it.' },
	{ id: 'pro.plus', name: 'Pro++', domains: 224000, about: 'Aggressive: may break some sites.' },
	{ id: 'ultimate', name: 'Ultimate', domains: 248000, about: 'Strictest: expect broken sites.' }
];

const DOMAIN = regexp('^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$');
const MAC = regexp('^([0-9a-f]{2}:){5}[0-9a-f]{2}$');

function q(s) {
	return `'${replace(s, "'", "'\\''")}'`;
}

function sh(cmd) {
	const p = popen(cmd);
	if (!p)
		return '';
	const out = p.read('all');
	p.close();
	return trim(out ?? '');
}

// values reaching SQL are checked against DOMAIN/MAC/numbers first
function sql(stmt) {
	return sh(`${FTL} sqlite3 -ni ${DB} ${q(stmt)} 2>/dev/null`);
}

function rows(stmt) {
	return filter(split(sql(stmt), '\n'), l => l != '');
}

function fetch(path, body) {
	const post = body ? `--post-data=${q(sprintf('%J', body))} ` : '';
	try {
		return json(sh(`uclient-fetch -q -T 5 -O - ${post}${q('http://127.0.0.1:8080/api/' + path)} 2>/dev/null`));
	}
	catch (e) {
		return null;
	}
}

// with an admin password set FTL wants a session: log in with the CLI
// password FTL writes at start, keep the sid while rpcd runs, log in again
// when FTL restarts (new cli_pw, old sid unauthorized). Limit: one FTL
// session per rpcd run, within FTL's max_sessions
let sid = null;

function api(path, body) {
	const enc = s => replace(replace(replace(s, '+', '%2B'), '/', '%2F'), '=', '%3D');
	const url = () => sid ? `${path}${index(path, '?') < 0 ? '?' : '&'}sid=${enc(sid)}` : path;
	let r = fetch(url(), body);
	// uclient-fetch prints nothing on a 401
	if (r == null || r?.error?.key == 'unauthorized') {
		sid = fetch('auth', { password: trim(readfile('/etc/pihole/cli_pw') ?? '') })?.session?.sid;
		r = sid ? fetch(url(), body) : r;
	}
	return r;
}

function info(property) {
	return +(sql(`SELECT value FROM info WHERE property = '${property}';`) || 0);
}

// same test as luci-app-alphawrt's line.js: a bridge (not br-iptv) that
// joins a LAN port to a pon0 VLAN
function bridge_mode(uci) {
	let found = false;
	uci.foreach('network', 'device', d => {
		const ports = type(d.ports) == 'array' ? d.ports : split(d.ports ?? '', ' ');
		if (d.type == 'bridge' && d.name != 'br-iptv' &&
		    length(filter(ports, p => match(p, /^lan[0-9]/))) &&
		    length(filter(ports, p => match(p, /^pon0\./))))
			found = true;
	});
	return found;
}

function reload() {
	sh(`${PIHOLE} reloadlists; ${PIHOLE} save`);
}

function check(list, re) {
	const bad = filter(list, v => type(v) != 'string' || !match(v, re));
	return length(bad) ? bad : null;
}

function in_list(list) {
	return join(',', map(list, v => `'${v}'`));
}

const methods = {
	status: {
		call: function() {
			const uci = cursor();
			const enabled = uci.get('pihole', 'main', 'enabled') == '1';
			const running = sh('pidof pihole-FTL') != '';
			const b = running ? api('dns/blocking') : null;
			return {
				available: true,
				reason: '',
				enabled,
				running,
				blocking: b?.blocking ?? (enabled ? 'failure' : 'disabled'),
				timer: b?.timer ?? 0,
				preset: uci.get('pihole', 'main', 'preset') ?? 'multi',
				tif: uci.get('pihole', 'main', 'tif') == '1',
				domains: access(DB) ? info('gravity_count') : 0,
				last_update: access(DB) ? info('updated') : 0,
				updating: access(DB + '.new') == true,
				password_set: sh(`${FTL} --config webserver.api.pwhash 2>/dev/null`) != '',
				admin_port: 8080,
				admin_path: '/admin/',
				web_installed: access('/usr/share/pihole/www/admin/index.html') == true
			};
		}
	},

	set: {
		args: { enabled: true, preset: 'multi', tif: true, password: 'password' },
		call: function(req) {
			const a = req.args;
			if (a.preset != null && !length(filter(PRESETS, p => p.id == a.preset)))
				return { error: 'bad_preset' };
			if (a.password != null && (type(a.password) != 'string' || length(a.password) < 8))
				return { error: 'password_too_short' };
			if (a.enabled && a.password == null && sh(`${FTL} --config webserver.api.pwhash 2>/dev/null`) == '')
				return { error: 'password_required' };

			if (a.password != null)
				sh(`${FTL} --config webserver.api.password ${q(a.password)} >/dev/null 2>&1`);

			const uci = cursor();
			if (a.enabled != null)
				uci.set('pihole', 'main', 'enabled', a.enabled ? '1' : '0');
			if (a.preset != null)
				uci.set('pihole', 'main', 'preset', a.preset);
			if (a.tif != null)
				uci.set('pihole', 'main', 'tif', a.tif ? '1' : '0');
			uci.commit('pihole');

			// moves dnsmasq, restarts FTL, then updates gravity in the background
			sh(`(${PIHOLE} apply >/tmp/pihole-apply.log 2>&1 &)`);
			return { ok: true };
		}
	},

	update: {
		call: function() {
			sh(`(${PIHOLE} -g >/dev/null 2>&1 &)`);
			return { ok: true };
		}
	},

	pause: {
		args: { minutes: 5 },
		call: function(req) {
			const m = +req.args.minutes;
			if (m != m || m < 0 || m > 1440)
				return { error: 'bad_minutes' };
			const r = api('dns/blocking', m > 0 ? { blocking: false, timer: m * 60 } : { blocking: true, timer: null });
			return r ? { blocking: r.blocking, timer: r.timer ?? 0 } : { error: 'not_running' };
		}
	},

	stats: {
		args: { top: 10 },
		call: function(req) {
			const n = +req.args.top || 10;
			const s = api('stats/summary');
			if (!s)
				return { error: 'not_running' };
			const top_blocked = api(`stats/top_domains?blocked=true&count=${n}`);
			const top_clients = api(`stats/top_clients?count=${n}`);
			const blocked_clients = api(`stats/top_clients?blocked=true&count=${n}`);
			return {
				period: '24h',
				queries: s.queries?.total ?? 0,
				blocked: s.queries?.blocked ?? 0,
				percent: s.queries?.percent_blocked ?? 0,
				active_clients: s.clients?.active ?? 0,
				domains: s.gravity?.domains_being_blocked ?? 0,
				top_blocked: map(top_blocked?.domains ?? [], d => ({ domain: d.domain, count: d.count })),
				top_clients: map(top_clients?.clients ?? [], c => ({ ip: c.ip, name: c.name, count: c.count })),
				blocked_clients: map(blocked_clients?.clients ?? [], c => ({ ip: c.ip, name: c.name, count: c.count }))
			};
		}
	},

	lists: {
		call: function() {
			if (!access(DB))
				return { allow: [], deny: [], bypass: [] };
			return {
				allow: rows('SELECT domain FROM domainlist WHERE type = 0 AND enabled = 1 ORDER BY domain;'),
				deny: rows('SELECT domain FROM domainlist WHERE type = 1 AND enabled = 1 ORDER BY domain;'),
				bypass: map(rows(`SELECT c.ip, coalesce(c.comment, '') FROM client c
					JOIN client_by_group cg ON cg.client_id = c.id
					JOIN "group" g ON g.id = cg.group_id WHERE g.name = '${BYPASS}' ORDER BY c.ip;`),
					r => { const f = split(r, '|', 2); return { mac: f[0], name: f[1] }; })
			};
		}
	},

	set_lists: {
		args: { allow: [], deny: [], bypass: [] },
		call: function(req) {
			if (!access(DB))
				return { error: 'not_enabled' };
			const a = req.args;
			const bad = [];
			for (let k in ['allow', 'deny']) {
				if (a[k] != null) {
					a[k] = map(a[k], v => lc(trim(v ?? '')));
					push(bad, ...(check(a[k], DOMAIN) ?? []));
				}
			}
			if (a.bypass != null) {
				a.bypass = map(a.bypass, v => lc(trim(v ?? '')));
				push(bad, ...(check(a.bypass, MAC) ?? []));
			}
			if (length(bad))
				return { error: 'bad_entries', bad };

			let s = '';
			for (let k in ['allow', 'deny']) {
				if (a[k] == null)
					continue;
				const t = k == 'allow' ? 0 : 1;
				s += `DELETE FROM domainlist WHERE type = ${t} AND domain NOT IN (${in_list(a[k])});`;
				for (let d in a[k])
					s += `INSERT OR IGNORE INTO domainlist (type, domain, comment) VALUES (${t}, '${d}', 'AlphaWRT');`;
			}
			if (a.bypass != null) {
				// a group with no adlists and no domains: its clients are never blocked
				const g = `(SELECT id FROM "group" WHERE name = '${BYPASS}')`;
				s += `INSERT OR IGNORE INTO "group" (name, description) VALUES ('${BYPASS}', 'Devices AlphaWRT does not filter');`;
				s += `DELETE FROM client WHERE id IN (SELECT client_id FROM client_by_group WHERE group_id = ${g})
					AND ip NOT IN (${in_list(a.bypass)});`;
				for (let m in a.bypass) {
					const c = `(SELECT id FROM client WHERE ip = '${m}')`;
					s += `INSERT OR IGNORE INTO client (ip, comment) VALUES ('${m}', 'AlphaWRT bypass');`;
					s += `DELETE FROM client_by_group WHERE client_id = ${c};`;
					s += `INSERT INTO client_by_group (client_id, group_id) VALUES (${c}, ${g});`;
				}
			}
			sql(`BEGIN; ${s} COMMIT;`);
			reload();
			return { ok: true };
		}
	},

	presets: {
		call: function() {
			return { presets: PRESETS };
		}
	}
};

return { 'alphawrt-pihole': methods };
