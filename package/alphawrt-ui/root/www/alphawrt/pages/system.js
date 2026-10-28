/*
 * System: the box, admin password, firmware update, the two flash banks,
 * backup and restore, restart. The firmware and backup steps are the same
 * cgi-io upload and image check LuCI's Advanced > Flash page uses; installs
 * and restores run only through /usr/libexec/alphawrt-ui/flash, never with
 * --force (issue 0005).
 */
import { h, icon, rows, card, field, toggle, modal, busy, toast, redraw, fmtTime } from '../lib/ui.js';
import { call, maybe, upload, sessionId } from '../lib/rpc.js';
import { awaitReconnect } from '../lib/apply.js';
import { usage } from '../lib/stats.js';

const FW = '/tmp/firmware.bin', BACKUP = '/tmp/backup.tar.gz';
const exec = (command, params) => call('file', 'exec', { command, params });
/* every flash and restore goes through this wrapper: fixed verbs, checks first, never --force (issue 0005) */
const flash = verb => exec('/usr/libexec/alphawrt-ui/flash', [ verb ]);
const mb = n => `${(n / 1048576).toFixed(1)} MB`;

/* what a bank holds, as alphawrt-bootbank reports it ("AlphaWRT-r37113+…" or a stock version) */
function bankLabel(holds) {
	if (!holds || holds == 'no bootable image') return 'Empty (no firmware)';
	return /^AlphaWRT/.test(holds) ? `AlphaWRT ${holds.replace(/^AlphaWRT-?/, '')}` : `Stock firmware ${holds}`;
}

async function restart(title = 'Restart the box?', text = 'Internet and Wi-Fi go away for about a minute.') {
	if (!await modal(title, h('p', {}, text), [ [ 'Cancel', 'btn-ghost', false ], [ 'Restart', 'btn-warning', true ] ]))
		return;
	await call('system', 'reboot').catch(() => {});
	awaitReconnect(busy('Restarting', 'This page comes back by itself when the box is up again.'));
}

/* pick a file with a hidden input; resolves with the File or null */
function pickFile(accept) {
	return new Promise(resolve => {
		const i = h('input', { type: 'file', accept, class: 'hidden' });
		i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
		i.addEventListener('cancel', () => { resolve(null); i.remove(); });
		document.body.append(i);
		i.click();
	});
}

export default {
	title: 'System',

	async render(main) {
		const [ board, banks ] = await Promise.all([ maybe('system', 'board'), maybe('alphawrt', 'banks') ]);
		const u = usage([ [ 'Firmware', board.release?.description?.replace(/ r\d+.*$/, '') || '—' ], [ 'Model', board.model || '—' ] ]);

		main.append(h('h1', { class: 'text-2xl font-bold' }, 'System'),
			h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' },
				card('box', 'This box', null, u.el),
				this.password(),
				this.firmware(banks),
				banks.a != null && this.banks(banks),
				this.backup(),
				card('system', 'Restart', null, h('div', {},
					h('p', { class: 'text-sm opacity-80' }, 'Internet and Wi-Fi go away for about a minute.'),
					h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-warning btn-sm', onclick: () => restart() }, 'Restart'))))));

		const tick = u.tick;
		await tick();
		return tick;
	},

	password() {
		const pw1 = field('New password', { password: true, autocomplete: 'new-password', hint: 'At least 8 characters. Also for Advanced settings and SSH (user “root”).' });
		const pw2 = field('Type it again', { password: true, autocomplete: 'new-password' });
		const go = async () => {
			const a = pw1.input.value;
			if (a.length < 8) return toast('warn', 'The password needs at least 8 characters.');
			if (a != pw2.input.value) return toast('warn', 'The two passwords don’t match.');
			const r = await call('luci', 'setPassword', { username: 'root', password: a }).catch(() => ({}));
			toast(r.result ? 'ok' : 'bad', r.result ? 'Password changed.' : 'Changing the password failed.');
			if (r.result) { pw1.input.value = pw2.input.value = ''; }
		};
		return card('key', 'Admin password', null, h('div', {}, pw1, pw2,
			h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-primary btn-sm', onclick: go }, 'Change password'))));
	},

	firmware(banks) {
		const go = async () => {
			const file = await pickFile('.bin,.itb,.img');
			if (!file) return;
			const b = busy('Checking the firmware', `Uploading ${file.name} (${mb(file.size)})…`);
			let up, valid, test;
			try {
				up = await upload(FW, file);
				b.text('Checking that it fits this box…');
				valid = await call('system', 'validate_firmware_image', { path: FW }).catch(() => ({ valid: false }));
				test = await flash('test').catch(e => ({ code: 1, stderr: e.message }));
			}
			catch (e) { b.close(); return toast('bad', e.message); }
			b.close();

			if (!valid.valid || test.code != 0) {
				await call('file', 'remove', { path: FW }).catch(() => {});
				return modal('This firmware can’t be installed', h('div', { class: 'space-y-2 text-sm' },
					h('p', {}, 'It isn’t a sysupgrade image for the Skyworth GN630V. Use the file named …gn630v…sysupgrade.bin from the AlphaWRT release.'),
					test.stderr && h('pre', { class: 'text-xs whitespace-pre-wrap opacity-70' }, test.stderr)));
			}

			const keep = toggle('Keep my settings', valid.allow_backup !== false, 'Internet login, Wi-Fi, passwords and fibre identity stay as they are.');
			if (valid.allow_backup === false) keep.input.disabled = true;
			const ok = await modal('Install this firmware?', h('div', { class: 'space-y-3 text-sm' },
				rows([ [ 'File', file.name ], [ 'Size', mb(up.size || file.size) ], up.sha256sum && [ 'SHA256', h('span', { class: 'font-mono text-xs break-all' }, up.sha256sum) ] ]),
				h('p', {}, `It replaces the AlphaWRT in bank ${(banks.running || '?').toUpperCase()}. The other bank stays as it is.`),
				keep,
				h('div', { role: 'alert', class: 'alert alert-soft alert-warning' }, icon('warn'), 'Don’t switch the box off while it installs (about 3 minutes).')),
				[ [ 'Cancel', 'btn-ghost', false ], [ 'Install', 'btn-warning', true ] ]);
			if (!ok) return call('file', 'remove', { path: FW }).catch(() => {});

			const w = busy('Installing the firmware', 'Don’t switch the box off. This page comes back by itself when it’s done.');
			/* sysupgrade never answers: the box goes down while it runs */
			flash(keep.input.checked ? 'keep' : 'fresh').catch(() => {});
			awaitReconnect(w, 90000);
		};
		return card('fibre', 'Firmware update', null, h('div', {},
			h('p', { class: 'text-sm opacity-80' }, 'Install a newer AlphaWRT from a sysupgrade file you downloaded. Your settings are kept unless you say otherwise.'),
			h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-primary btn-sm', onclick: go }, 'Choose firmware file…'))));
	},

	banks(banks) {
		const choose = async b => {
			const r = await call('alphawrt', 'set_bank', { bank: b }).catch(e => ({ ok: false, message: e.message }));
			if (!r.ok) return toast('bad', r.message || 'Switching banks failed.');
			toast('ok', `Bank ${b.toUpperCase()} starts next.`);
			const stock = !/^AlphaWRT/.test(banks[b] || '');
			await restart('Restart now?', stock ? 'The box starts the stock firmware. To come back to AlphaWRT, use the stock firmware’s upgrade page or the recovery steps in the AlphaWRT guide.' : `Bank ${b.toUpperCase()} is used from the next start.`);
			redraw();
		};
		return card('system', 'Firmware banks', null, h('div', {},
			h('p', { class: 'text-sm opacity-80 mb-3' }, 'The box has two flash banks. AlphaWRT runs from one; the other usually keeps the stock firmware, so you can always go back.'),
			h('ul', { class: 'space-y-2' }, [ 'a', 'b' ].map(b => h('li', { class: 'flex items-center gap-3 rounded-box border border-base-300 p-3' },
				h('div', { class: 'flex-1 min-w-0' },
					h('div', { class: 'font-medium' }, `Bank ${b.toUpperCase()}`,
						banks.running == b && h('span', { class: 'badge badge-soft badge-success badge-sm ml-2' }, 'running'),
						banks.next == b && banks.running != b && h('span', { class: 'badge badge-soft badge-warning badge-sm ml-2' }, 'starts next')),
					h('div', { class: 'text-sm opacity-70 truncate' }, bankLabel(banks[b]))),
				banks.next != b && banks[b] && banks[b] != 'no bootable image' &&
					h('button', { class: 'btn btn-sm btn-outline', onclick: () => choose(b) }, /^AlphaWRT/.test(banks[b]) ? 'Start next' : 'Switch to stock'))))));
	},

	backup() {
		const download = () => {
			const f = h('form', { method: 'post', action: '/cgi-bin/cgi-backup', class: 'hidden' }, h('input', { type: 'hidden', name: 'sessionid', value: sessionId() }));
			document.body.append(f);
			f.submit();
			f.remove();
		};
		const restore = async () => {
			const file = await pickFile('.tar.gz,.tgz,application/gzip');
			if (!file) return;
			const b = busy('Checking the backup', 'Uploading…');
			let list;
			try {
				await upload(BACKUP, file);
				list = await exec('/bin/tar', [ '-tzf', BACKUP ]);
			}
			catch (e) { b.close(); return toast('bad', e.message); }
			b.close();
			if (list.code != 0) {
				await call('file', 'remove', { path: BACKUP }).catch(() => {});
				return toast('bad', 'That file isn’t a readable backup.');
			}
			const ok = await modal('Restore this backup?', h('div', { class: 'space-y-2 text-sm' },
				h('p', {}, 'The box takes these settings and restarts. If they give it a different address, open that address afterwards.'),
				h('details', {}, h('summary', { class: 'cursor-pointer opacity-70' }, 'Files in the backup'),
					h('pre', { class: 'text-xs max-h-48 overflow-auto' }, list.stdout))),
				[ [ 'Cancel', 'btn-ghost', false ], [ 'Restore and restart', 'btn-warning', true ] ]);
			if (!ok) return call('file', 'remove', { path: BACKUP }).catch(() => {});
			/* restores, then restarts; the call doesn't come back */
			flash('restore').then(r => r.code && toast('bad', `Restoring failed: ${r.stderr || r.code}`)).catch(() => {});
			awaitReconnect(busy('Restarting', 'This page comes back by itself when the box is up again.'));
		};
		return card('box', 'Backup', null, h('div', {},
			h('p', { class: 'text-sm opacity-80' }, 'A backup holds all your settings. Keep one before big changes.'),
			h('div', { class: 'card-actions justify-end mt-3' },
				h('button', { class: 'btn btn-ghost btn-sm', onclick: restore }, 'Restore…'),
				h('button', { class: 'btn btn-primary btn-sm', onclick: download }, 'Download backup'))));
	}
};
