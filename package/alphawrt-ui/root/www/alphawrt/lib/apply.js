/*
 * Saving uci changes. ops: [ 'set', config, section, values ] |
 * [ 'unset', config, section, option ] | [ 'add', config, type, values, name? ] |
 * [ 'remove', config, section ].
 *
 * With rollback (the default) the box undoes the change by itself if this
 * page can't confirm it within 30 s, as LuCI's Save & Apply does: nothing
 * can lock you out. Wi-Fi saves pass rollback: false, because a browser on
 * the Wi-Fi it just changed can never confirm, and the user has the new
 * name and password on screen.
 */
import { call, AuthError } from './rpc.js';
import { busy } from './ui.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function save(ops, { rollback = true, timeout = 30, what = 'Saving your settings' } = {}) {
	const b = busy(what, rollback ? `If this page can’t reach the box afterwards, the old settings come back by themselves within ${timeout} seconds.` : 'Devices on Wi-Fi reconnect in a few seconds.');
	try {
		for (const [ op, config, section, arg, name ] of ops) {
			if (op == 'set') {
				try {
					await call('uci', 'set', { config, section, values: arg });
				} catch (e) {
					if (name && String(e.message || '').includes('Not found')) {
						await call('uci', 'add', { config, type: name, name: section, values: arg });
					} else {
						throw e;
					}
				}
			}
			else if (op == 'unset') await call('uci', 'delete', { config, section, option: arg }).catch(() => {});
			else if (op == 'add') await call('uci', 'add', { config, type: section, values: arg, ...(name ? { name } : {}) });
			else if (op == 'remove') await call('uci', 'delete', { config, section });
		}
		await call('uci', 'apply', rollback ? { rollback: true, timeout } : { rollback: false });
		if (!rollback)
			return true;
		/* services restart first; then confirm, or the box rolls back */
		for (let i = 0; i < timeout / 2 - 2; i++) {
			await sleep(2000);
			try { await call('uci', 'confirm'); return true; }
			catch (e) { if (e instanceof AuthError) throw e; }
		}
		return false;
	}
	catch (e) {
		/* drop what we staged, so the next save starts clean */
		for (const c of new Set(ops.map(o => o[1]))) await call('uci', 'revert', { config: c }).catch(() => {});
		throw e;
	}
	finally { b.close(); }
}

/* after a restart or firmware update: wait for the box, then reload */
export async function awaitReconnect(b, first = 30000) {
	await sleep(first);
	for (;;) {
		try {
			const r = await fetch(`/alphawrt/favicon.svg?${Date.now()}`, { cache: 'no-store' });
			if (r.ok) return location.reload();
		} catch (e) {}
		b?.text('Still waiting for the box to come back…');
		await sleep(5000);
	}
}
