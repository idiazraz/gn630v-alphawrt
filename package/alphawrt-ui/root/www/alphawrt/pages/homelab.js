/*
 * Home lab (under More): services, remote syslog and SSH keys (port
 * forwards and local names are on the Network page), on WS4's alphawrt-homelab backend (contract:
 * side-session notes ws4-homelab-contract.md). Services and SSH apply at
 * once through the backend; the rest is plain uci with rollback.
 */
import { h, card, field, toggle, choice, modal, toast, redraw } from '../lib/ui.js';
import { call, maybe, uci } from '../lib/rpc.js';
import { save } from '../lib/apply.js';

const ROUTER_ONLY = () => h('p', { class: 'text-sm opacity-70' }, 'Only in router mode. In bridge mode your own router does this.');
const ipOk = ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => +n < 256);
const portOk = p => /^\d{1,5}(-\d{1,5})?$/.test(p) && p.split('-').every(n => +n > 0 && +n < 65536);

async function confirmDelete(what) {
	return modal(`Remove ${what}?`, null, [ [ 'Cancel', 'btn-ghost', false ], [ 'Remove', 'btn-error', true ] ]);
}

export default {
	title: 'Home lab',

	async render(main) {
		const [ st ] = await Promise.all([
			maybe('alphawrt-homelab', 'status', {}, { mode: 'bridge', services: {}, ssh: {} }),
			uci.load('system')
		]);
		const bridge = st.mode == 'bridge';
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'Home lab'),
			h('p', { class: 'text-sm opacity-70' }, 'Extras for tinkerers. Dynamic DNS, site-to-site WireGuard and VLANs are in ',
				h('a', { href: '/cgi-bin/luci/', class: 'link link-primary' }, 'Advanced settings'), '.'),
			h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' },
				this.services(st, bridge),
				this.ssh(st),
				this.syslog()));
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

	async apply(ops, done) {
		const ok = await save(ops).catch(e => { toast('bad', e.message); return null; });
		if (ok != null) toast(ok ? 'ok' : 'warn', ok ? done : 'The box didn’t confirm the change, so it was undone.');
		redraw();
	}
};
