/*
 * Home lab (under More): services, remote syslog, port forwards, local
 * names and SSH keys, on WS4's alphawrt-homelab backend (contract:
 * side-session notes ws4-homelab-contract.md). Services and SSH apply at
 * once through the backend; the rest is plain uci with rollback.
 */
import { h, icon, badge, rows, card, field, toggle, choice, modal, toast, redraw, fmtTime } from '../lib/ui.js';
import { call, maybe, uci } from '../lib/rpc.js';
import { save } from '../lib/apply.js';

const ROUTER_ONLY = () => h('p', { class: 'text-sm opacity-70' }, 'Only in router mode. In bridge mode your own router does this.');
const PROTO = [ [ 'tcp', 'TCP' ], [ 'udp', 'UDP' ], [ 'tcp udp', 'TCP and UDP' ] ];
const ipOk = ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => +n < 256);
const portOk = p => /^\d{1,5}(-\d{1,5})?$/.test(p) && p.split('-').every(n => +n > 0 && +n < 65536);

async function confirmDelete(what) {
	return modal(`Remove ${what}?`, null, [ [ 'Cancel', 'btn-ghost', false ], [ 'Remove', 'btn-error', true ] ]);
}

export default {
	title: 'Home lab',

	async render(main) {
		const [ st, pi, piPresets ] = await Promise.all([
			maybe('alphawrt-homelab', 'status', {}, { mode: 'bridge', services: {}, ssh: {} }),
			maybe('alphawrt-pihole', 'status', {}, null),
			maybe('alphawrt-pihole', 'presets', {}, { presets: [] }),
			uci.load('firewall', 'dhcp', 'system')
		]);
		const bridge = st.mode == 'bridge';
		const presets = piPresets?.presets || [];
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'Home lab'),
			h('p', { class: 'text-sm opacity-70' }, 'Extras for tinkerers. Dynamic DNS, site-to-site WireGuard and VLANs are in ',
				h('a', { href: '/cgi-bin/luci/', class: 'link link-primary' }, 'Advanced settings'), '.'),
			h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' },
				pi ? this.adblock(pi, presets, bridge) : null,
				this.services(st, bridge),
				this.ssh(st),
				this.forwards(bridge),
				this.names(bridge),
				this.syslog()));
	},

	adblock(pi, presets, bridge) {
		if (bridge || !pi?.available)
			return card('vpn', 'Ad blocking', badge('off', 'Bridge mode'), ROUTER_ONLY());

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

		const adminBtn = pi.web_installed ? h('a', {
			href: `${location.protocol}//${location.hostname}:${pi.admin_port || 8080}${pi.admin_path || '/admin/'}`,
			target: '_blank',
			rel: 'noopener',
			class: 'btn btn-sm btn-ghost text-primary'
		}, 'Open Pi-hole admin', icon('external', 'size-4')) : null;

		return card('vpn', 'Ad blocking', badgeEl, h('div', { class: 'space-y-3' },
			h('div', { class: 'text-sm opacity-80' }, 'Network-wide ad and tracker blocking powered by Pi-hole and Hagezi lists.'),
			statsRows,
			pauseCtl,
			h('div', { class: 'space-y-2 pt-2 border-t border-base-300' },
				enTog,
				presetSel,
				tifTog,
				pwField),
			h('div', { class: 'flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-base-300' },
				h('div', { class: 'flex flex-wrap gap-1' }, updateBtn, adminBtn),
				saveBtn)));
	},

	services(st, bridge) {
		const s = st.services || {};
		const item = (name, label, hint, routerOnly) => {
			const sv = s[name] || {};
			if (routerOnly && bridge) return null;
			const t = toggle(label, sv.enabled, sv.installed === false ? 'Not in this build.' : hint);
			if (sv.installed === false) t.input.disabled = true;
			t.input.addEventListener('change', async () => {
				t.input.disabled = true;
				const r = await call('alphawrt-homelab', 'set_service', { name, enabled: t.input.checked }).catch(e => ({ error: e.message }));
				t.input.disabled = false;
				if (r.error) { t.input.checked = !t.input.checked; return toast('bad', r.error); }
				toast('ok', `${label} ${t.input.checked ? 'on' : 'off'}.`);
			});
			return h('div', { class: 'py-1' }, t);
		};
		const maps = st.upnp_maps || [];
		return card('system', 'Services', null, h('div', { class: 'space-y-2' },
			item('metrics', 'Metrics (Prometheus)', [ 'Fibre readings (Rx/Tx dBm, optics temperature, line errors) for Prometheus. Scrape ',
				h('code', { class: 'text-xs break-all' }, s.metrics?.url || ''), ' from your LAN.' ]),
			item('iperf3', 'iperf3 server', `Test your LAN or Wi-Fi speed against the box: iperf3 -c <box>${s.iperf3?.port && s.iperf3.port != 5201 ? ` -p ${s.iperf3.port}` : ''}. It measures the box’s CPU, not your fibre.`),
			item('upnp', 'UPnP and NAT-PMP', 'Lets games and apps open ports by themselves. Off is safer.', true),
			item('ntp', 'Time server for your network', 'Devices on your LAN can set their clocks from this box.', true),
			bridge && ROUTER_ONLY(),
			maps.length > 0 && h('div', { class: 'mt-2' }, h('div', { class: 'text-sm font-medium mb-1' }, 'Ports opened by UPnP'),
				h('ul', { class: 'text-sm opacity-80' }, maps.map(m => h('li', {}, `${m.desc || 'App'}: ${m.proto} ${m.ext_port} → ${m.int_addr}:${m.int_port}`))))));
	},

	forwards(bridge) {
		if (bridge) return card('globe', 'Port forwards', null, ROUTER_ONLY());
		const list = uci.sections('firewall', 'redirect').filter(r => (r.target || 'DNAT') == 'DNAT' && (r.src || 'wan') == 'wan');
		const add = async () => {
			const name = field('Name', { placeholder: 'e.g. Minecraft' }), proto = choice('Protocol', PROTO, 'tcp'),
			      ext = field('Outside port', { placeholder: '25565', hint: 'A port or a range like 6000-6010.' }),
			      ip = field('To device address', { placeholder: '192.168.1.50' }), port = field('Device port', { placeholder: 'Same as outside' });
			if (!await modal('Add a port forward', h('div', {}, name, proto, ext, ip, port), [ [ 'Cancel', 'btn-ghost', false ], [ 'Add', 'btn-primary', true ] ])) return;
			const v = { name: name.input.value.trim() || 'Forward', proto: proto.input.value, src: 'wan', src_dport: ext.input.value.trim(),
				dest: 'lan', dest_ip: ip.input.value.trim(), dest_port: port.input.value.trim() || ext.input.value.trim(), target: 'DNAT' };
			if (!portOk(v.src_dport) || !portOk(v.dest_port)) return toast('warn', 'Ports are numbers from 1 to 65535.');
			if (!ipOk(v.dest_ip)) return toast('warn', 'Enter the device’s address, like 192.168.1.50.');
			await this.apply([ [ 'add', 'firewall', 'redirect', v ] ], 'Port forward added.');
		};
		return card('globe', 'Port forwards', null, h('div', { class: 'space-y-3' },
			h('div', { role: 'status', class: 'alert alert-soft alert-warning text-sm' }, icon('warn'),
				'Needs a public IPv4 address. TIME home plans are behind CGNAT unless you ask TIME for a public IP; Unifi usually gives one.'),
			this.listOf(list, r => `${r.name || 'Forward'}`, r => `${(r.proto || 'tcp udp').toUpperCase().replace(' ', '+')} ${r.src_dport} → ${r.dest_ip}:${r.dest_port || r.src_dport}`, 'firewall', 'port forward'),
			h('div', { class: 'card-actions justify-end' }, h('button', { class: 'btn btn-sm btn-primary', onclick: add }, 'Add'))));
	},

	names(bridge) {
		if (bridge) return card('devices', 'Local names', null, ROUTER_ONLY());
		const list = uci.sections('dhcp', 'domain');
		const add = async () => {
			const name = field('Name', { placeholder: 'nas', hint: 'Devices on your network can then use nas.lan.' }), ip = field('Address', { placeholder: '192.168.1.20' });
			if (!await modal('Add a local name', h('div', {}, name, ip), [ [ 'Cancel', 'btn-ghost', false ], [ 'Add', 'btn-primary', true ] ])) return;
			const n = name.input.value.trim().toLowerCase().replace(/\.lan$/, '');
			if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(n)) return toast('warn', 'Use letters, digits and dashes.');
			if (!ipOk(ip.input.value.trim())) return toast('warn', 'Enter an address like 192.168.1.20.');
			await this.apply([ [ 'add', 'dhcp', 'domain', { name: n, ip: ip.input.value.trim() } ] ], `${n}.lan added.`);
		};
		return card('devices', 'Local names', null, h('div', { class: 'space-y-3' },
			this.listOf(list, d => `${d.name}.lan`, d => d.ip, 'dhcp', 'local name'),
			h('div', { class: 'card-actions justify-end' }, h('button', { class: 'btn btn-sm btn-primary', onclick: add }, 'Add'))));
	},

	syslog() {
		const sys = uci.sections('system', 'system')[0] || {};
		const ip = field('Send the log to', { value: sys.log_ip || '', placeholder: '192.168.1.10', hint: 'Empty turns it off.' });
		const port = field('Port', { value: sys.log_port || '514' }), proto = choice('Protocol', [ [ 'udp', 'UDP' ], [ 'tcp', 'TCP' ] ], sys.log_proto || 'udp');
		const go = async () => {
			const a = ip.input.value.trim();
			if (a && !ipOk(a)) return toast('warn', 'Enter an address like 192.168.1.10, or leave it empty.');
			if (!portOk(port.input.value.trim())) return toast('warn', 'The port is a number from 1 to 65535.');
			await this.apply(a ? [ [ 'set', 'system', sys['.name'], { log_ip: a, log_port: port.input.value.trim(), log_proto: proto.input.value } ] ]
				: [ [ 'unset', 'system', sys['.name'], 'log_ip' ] ], a ? 'Remote log on.' : 'Remote log off.');
		};
		return card('system', 'Remote log', null, h('div', {}, ip, h('div', { class: 'grid grid-cols-2 gap-3' }, port, proto),
			h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-sm btn-primary', onclick: go }, 'Save'))));
	},

	ssh(st) {
		const ssh = st.ssh || {}, keys = ssh.keys || [];
		const send = async (newKeys, pw, ok) => {
			const r = await call('alphawrt-homelab', 'set_ssh', { keys: newKeys, password_auth: pw }).catch(e => ({ error: e.message }));
			if (r.error) return toast('bad', r.error.replace(/^./, c => c.toUpperCase()) + '.');
			toast('ok', ok);
			redraw();
		};
		const pw = toggle('Allow password login', ssh.password_auth, 'Turn off once your key works: then only your keys get in.');
		pw.input.addEventListener('change', () => send(keys.map(k => k.key), pw.input.checked, pw.input.checked ? 'Password login on.' : 'Password login off.'));
		const add = async () => {
			const ta = h('textarea', { class: 'textarea w-full font-mono text-xs h-28', placeholder: 'ssh-ed25519 AAAA… you@laptop', spellcheck: 'false' });
			if (!await modal('Add an SSH key', h('div', {}, h('p', { class: 'text-sm mb-2' }, 'Paste the public key (the .pub file), one line.'), ta),
				[ [ 'Cancel', 'btn-ghost', false ], [ 'Add', 'btn-primary', true ] ])) return;
			send([ ...keys.map(k => k.key), ta.value.trim() ], ssh.password_auth, 'Key added.');
		};
		return card('key', 'SSH access', null, h('div', { class: 'space-y-3' }, pw,
			h('ul', { class: 'divide-y divide-base-300' }, keys.length ? keys.map((k, i) => h('li', { class: 'flex items-center gap-3 py-2' },
				h('span', { class: 'flex-1 min-w-0' }, h('span', { class: 'block font-medium truncate' }, k.comment || 'Key'), h('span', { class: 'block text-xs opacity-60' }, k.type)),
				h('button', { class: 'btn btn-ghost btn-xs', onclick: async () => {
					if (await confirmDelete('this key')) send(keys.filter((x, j) => j != i).map(x => x.key), ssh.password_auth, 'Key removed.');
				} }, 'Remove'))) : h('li', { class: 'text-sm opacity-70 py-2' }, 'No keys yet.')),
			h('div', { class: 'card-actions justify-end' }, h('button', { class: 'btn btn-sm btn-primary', onclick: add }, 'Add key'))));
	},

	/* a list of uci sections with a Remove button each */
	listOf(sections, title, sub, config, what) {
		if (!sections.length) return h('p', { class: 'text-sm opacity-70' }, 'None yet.');
		return h('ul', { class: 'divide-y divide-base-300' }, sections.map(s => h('li', { class: 'flex items-center gap-3 py-2' },
			h('span', { class: 'flex-1 min-w-0' }, h('span', { class: 'block font-medium truncate' }, title(s)), h('span', { class: 'block text-sm opacity-70 truncate' }, sub(s))),
			h('button', { class: 'btn btn-ghost btn-xs', onclick: async () => {
				if (await confirmDelete(`this ${what}`)) this.apply([ [ 'remove', config, s['.name'] ] ], 'Removed.');
			} }, 'Remove'))));
	},

	async apply(ops, done) {
		const ok = await save(ops).catch(e => { toast('bad', e.message); return null; });
		if (ok != null) toast(ok ? 'ok' : 'warn', ok ? done : 'The box didn’t confirm the change, so it was undone.');
		redraw();
	}
};
