/*
 * Pi-hole: today's numbers from FTL (alphawrt-pihole stats) and the ad
 * blocking settings. Works in bridge mode too, once the box has a gateway
 * and the main router hands it out as DNS (issues/0008).
 */
import { h, icon, badge, rows, card, field, toggle, choice, toast, redraw, fmtTime } from '../lib/ui.js';
import { call, maybe } from '../lib/rpc.js';

export default {
	title: 'Pi-hole',

	async render(main) {
		const [ st, pi, piPresets, stats ] = await Promise.all([
			maybe('alphawrt-homelab', 'status', {}, { mode: 'bridge' }),
			maybe('alphawrt-pihole', 'status', {}, null),
			maybe('alphawrt-pihole', 'presets', {}, { presets: [] }),
			maybe('alphawrt-pihole', 'stats', {}, null)
		]);
		main.append(h('div', { class: 'flex flex-wrap items-center justify-between gap-3' },
			h('h1', { class: 'text-2xl font-bold' }, 'Pi-hole'),
			pi?.web_installed && h('a', { href: `${location.protocol}//${location.hostname}:${pi.admin_port || 8080}${pi.admin_path || '/admin/'}`,
				target: '_blank', rel: 'noopener', class: 'btn btn-sm btn-primary' }, 'Open Pi-hole admin', icon('external', 'size-4'))));
		if (!pi) return main.append(h('p', { class: 'text-sm opacity-70' }, 'Pi-hole isn’t in this build.'));
		main.append(h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' },
			pi.enabled && pi.running ? this.today(stats) : null,
			this.settings(pi, piPresets?.presets || [], st.mode == 'bridge')));
	},

	today(s) {
		if (!s || s.error) return card('globe', 'Last 24 hours', null, h('p', { class: 'text-sm opacity-70' }, 'No numbers yet.'));
		const list = (title, items, key) => items?.length ? h('div', {},
			h('div', { class: 'text-sm font-medium mb-1' }, title),
			h('ul', { class: 'text-sm divide-y divide-base-300' }, items.slice(0, 5).map(i => h('li', { class: 'flex gap-3 py-1' },
				h('span', { class: 'flex-1 min-w-0 truncate' }, key(i)), h('span', { class: 'opacity-60 tabular-nums' }, Number(i.count).toLocaleString()))))) : null;
		return card('globe', 'Last 24 hours', null, h('div', { class: 'space-y-4' },
			rows([
				[ 'Queries', Number(s.queries || 0).toLocaleString() ],
				[ 'Blocked', `${Number(s.blocked || 0).toLocaleString()} (${(s.percent || 0).toFixed(1)}%)` ],
				[ 'Devices asking', String(s.active_clients || 0) ]
			]),
			list('Most blocked', s.top_blocked, i => i.domain),
			list('Busiest devices', s.top_clients, i => i.name || i.ip)));
	},

	settings(pi, presets, bridge) {
		if (!pi.available)
			return card('block', 'Ad blocking', badge('off', 'Not installed'), h('p', { class: 'text-sm opacity-70' }, 'Pi-hole isn’t in this build.'));

		const badgeEl = pi.updating ? badge('warn', 'Updating lists…')
			: !pi.enabled ? badge('off', 'Off')
			: pi.blocking == 'disabled' ? badge('warn', pi.timer ? `Paused (${fmtTime(pi.timer)})` : 'Paused')
			: pi.blocking == 'enabled' ? badge('ok', 'Blocking')
			: badge('bad', 'Not running');

		const presetOptions = presets.map(p => [ p.id, `${p.name} (${Number(p.domains).toLocaleString()} domains)` ]);
		const presetSel = choice('Block list preset', presetOptions, pi.preset || 'multi');
		const tifTog = toggle('Threat intelligence', pi.tif, 'Block known malware and phishing domains (Hagezi TIF)');
		const enTog = toggle('Enable ad blocking', pi.enabled, 'Filter ads and trackers for all devices on your network');

		const pwField = !pi.password_set
			? field('Pi-hole admin password', { password: true, placeholder: 'at least 8 characters', hint: 'Required before enabling Pi-hole for the first time.' })
			: field('Pi-hole admin password', { password: true, placeholder: 'Unchanged', hint: 'Leave blank to keep existing password.' });

		let pauseCtl = null;
		if (pi.enabled && pi.running) {
			if (pi.blocking == 'enabled') {
				pauseCtl = h('div', { class: 'space-y-1.5' },
					h('div', { class: 'text-xs font-medium opacity-70' }, 'Temporarily pause blocking:'),
					h('div', { class: 'flex flex-wrap gap-2' },
						[ [ 5, '5 min' ], [ 15, '15 min' ], [ 60, '1 hour' ] ].map(([ m, lbl ]) =>
							h('button', {
								type: 'button',
								class: 'btn btn-xs btn-outline',
								onclick: async () => {
									const r = await call('alphawrt-pihole', 'pause', { minutes: m }).catch(e => ({ error: e.message }));
									if (r.error) return toast('bad', r.error);
									toast('ok', `Ad blocking paused for ${lbl}.`);
									redraw();
								}
							}, lbl))));
			} else if (pi.blocking == 'disabled') {
				pauseCtl = h('div', { class: 'flex items-center justify-between gap-3 p-3 bg-warning/10 rounded-box border border-warning/20' },
					h('div', { class: 'text-sm' },
						h('div', { class: 'font-semibold' }, 'Blocking is paused'),
						pi.timer > 0 && h('div', { class: 'text-xs opacity-70' }, `${fmtTime(pi.timer)} remaining`)),
					h('button', {
						type: 'button',
						class: 'btn btn-sm btn-primary',
						onclick: async () => {
							const r = await call('alphawrt-pihole', 'pause', { minutes: 0 }).catch(e => ({ error: e.message }));
							if (r.error) return toast('bad', r.error);
							toast('ok', 'Ad blocking resumed.');
							redraw();
						}
					}, 'Resume blocking'));
			}
		}

		const statsRows = pi.enabled ? rows([
			pi.domains ? [ 'Domains blocked', Number(pi.domains).toLocaleString() ] : null,
			pi.last_update ? [ 'Last updated', new Date(pi.last_update * 1000).toLocaleString() ] : null,
			pi.timer > 0 ? [ 'Pause timer', fmtTime(pi.timer) ] : null
		]) : null;

		const saveBtn = h('button', {
			type: 'button',
			class: 'btn btn-sm btn-primary',
			onclick: async () => {
				saveBtn.disabled = true;
				const enabled = enTog.input.checked;
				const preset = presetSel.input.value;
				const tif = tifTog.input.checked;
				const pw = pwField?.input?.value?.trim() || null;
				if (enabled && !pi.password_set && !pw) {
					saveBtn.disabled = false;
					return toast('warn', 'Set a Pi-hole admin password (at least 8 characters) first.');
				}
				if (pw && pw.length < 8) {
					saveBtn.disabled = false;
					return toast('warn', 'The admin password needs at least 8 characters.');
				}
				const r = await call('alphawrt-pihole', 'set', { enabled, preset, tif, password: pw }).catch(e => ({ error: e.message }));
				saveBtn.disabled = false;
				if (r.error) {
					const msgs = {
						password_required: 'Set a Pi-hole admin password first.',
						password_too_short: 'The password needs at least 8 characters.',
						bad_preset: 'Unknown preset.'
					};
					return toast('bad', msgs[r.error] || r.error);
				}
				toast('ok', 'Ad blocking settings saved. DNS restarts for a few seconds.');
				redraw();
			}
		}, 'Save');

		const updateBtn = h('button', {
			type: 'button',
			class: 'btn btn-sm btn-ghost',
			disabled: !pi.enabled || pi.updating,
			onclick: async () => {
				updateBtn.disabled = true;
				const r = await call('alphawrt-pihole', 'update').catch(e => ({ error: e.message }));
				if (r.error) {
					updateBtn.disabled = false;
					return toast('bad', r.error);
				}
				toast('ok', 'Updating block lists in the background.');
				redraw();
			}
		}, 'Update lists now');

		return card('block', 'Ad blocking', badgeEl, h('div', { class: 'space-y-3' },
			h('div', { class: 'text-sm opacity-80' }, 'Network-wide ad and tracker blocking powered by Pi-hole and Hagezi lists.'),
			bridge && !pi.enabled && h('div', { class: 'text-sm opacity-70' }, 'Bridge mode: your main router has to hand out this box as DNS, and this box needs a gateway to reach the internet.'),
			statsRows,
			pauseCtl,
			h('div', { class: 'space-y-2 pt-2 border-t border-base-300' },
				enTog,
				presetSel,
				tifTog,
				pwField),
			h('div', { class: 'flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-base-300' },
				updateBtn,
				saveBtn)));
	},

};
