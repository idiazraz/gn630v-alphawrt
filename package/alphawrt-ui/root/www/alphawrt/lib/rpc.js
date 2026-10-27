/*
 * ubus over uhttpd's /ubus JSON-RPC, the uci reads on top of it, and the
 * login shared with LuCI.
 *
 * Shared login: LuCI's sysauth cookie is a ubus session id, and LuCI accepts
 * any session whose values hold a string "token" (its CSRF token) and a
 * username (dispatcher.uc session_retrieve). So after session.login we set a
 * token in our own session and write the cookie for /cgi-bin/luci/: Advanced
 * then opens without a second login. Checked on the box, 2026-10-27.
 */

const NULL_SID = '00000000000000000000000000000000';
const KEY = 'alphawrt-sid';
let sid = null, seq = 0;

try { sid = localStorage.getItem(KEY); } catch (e) {}

export class AuthError extends Error {}

/* ubus status codes (libubus) */
const UBUS = [ 'OK', 'Invalid command', 'Invalid argument', 'Method not found', 'Not found',
	'No data', 'Permission denied', 'Timeout', 'Not supported', 'Unknown error', 'Connection failed' ];

export async function call(object, method, args = {}, session = sid) {
	const res = await fetch('/ubus', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'call', params: [ session || NULL_SID, object, method, args ] })
	});
	const j = await res.json();
	/* -32002 "Access denied": no session, or it expired */
	if (j.error)
		throw j.error.code == -32002 ? new AuthError(j.error.message) : new Error(`${object}.${method}: ${j.error.message}`);
	const [ code, data ] = j.result;
	if (code == 6 && session == sid)
		throw new AuthError(`${object}.${method}: permission denied`);
	if (code != 0)
		throw new Error(`${object}.${method}: ${UBUS[code] || code}`);
	return data ?? {};
}

/* call(), but a missing object or failed call gives `fallback` (for optional services) */
export const maybe = (object, method, args, fallback = {}) =>
	call(object, method, args).catch(e => { if (e instanceof AuthError) throw e; return fallback; });

export const loggedIn = () => !!sid;

function setCookie(value, maxAge) {
	const name = location.protocol == 'https:' ? 'sysauth_https' : 'sysauth_http';
	document.cookie = `${name}=${value}; path=/cgi-bin/luci/; SameSite=Strict${maxAge != null ? `; Max-Age=${maxAge}` : ''}${location.protocol == 'https:' ? '; Secure' : ''}`;
}

export async function login(password) {
	const r = await call('session', 'login', { username: 'root', password }, NULL_SID).catch(() => null);
	if (!r?.ubus_rpc_session)
		return false;
	sid = r.ubus_rpc_session;
	const token = [ ...crypto.getRandomValues(new Uint8Array(16)) ].map(b => b.toString(16).padStart(2, '0')).join('');
	await call('session', 'set', { values: { token } }).catch(() => {});
	try { localStorage.setItem(KEY, sid); } catch (e) {}
	setCookie(sid);
	return true;
}

export async function logout() {
	await call('session', 'destroy', {}).catch(() => {});
	forget();
}

export function forget() {
	sid = null;
	try { localStorage.removeItem(KEY); } catch (e) {}
	setCookie('', 0);
}

/*
 * uci: load({ network, wireless }) style reads. get('network', 'wan', 'device'),
 * get('dhcp', '@dnsmasq[0]', 'server'), sections('network', 'device').
 */
const store = {};

export const uci = {
	async load(...configs) {
		await Promise.all(configs.map(c => maybe('uci', 'get', { config: c }, { values: {} })
			.then(r => { store[c] = r.values || {}; })));
	},
	sections(config, type) {
		return Object.values(store[config] || {})
			.filter(s => !type || s['.type'] == type)
			.sort((a, b) => a['.index'] - b['.index']);
	},
	get(config, section, option) {
		const m = /^@(.+)\[(-?\d+)\]$/.exec(section);
		const s = m ? this.sections(config, m[1]).at(+m[2]) : store[config]?.[section];
		return option ? s?.[option] : s;
	}
};

export const list = v => v == null ? [] : Array.isArray(v) ? v : String(v).split(/\s+/).filter(Boolean);
