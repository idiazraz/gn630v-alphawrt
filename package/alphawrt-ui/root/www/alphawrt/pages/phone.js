/*
 * Phone: the TEL port as a home phone line over SIP (alphawrt-voice:
 * /etc/config/voice, rendered into baresip). Shown only on boards with a
 * TEL port (alphawrt.board.voice = 1). A voice VLAN gets its own DHCP
 * interface "voice" on the WAN's device and a "voice" firewall zone.
 */
import { h, icon, badge, card, field, toggle, choice, toast, redraw } from '../lib/ui.js';
import { call, maybe, uci } from '../lib/rpc.js';
import { save } from '../lib/apply.js';

/* Unifi from the stock firmware's voice settings; others are typed in */
const PRESETS = {
	unifi: { name: 'Unifi (TM)', registrar: 'ims.tm.com.my', proxy: '10.255.0.1', vlan: '400', transport: 'udp' },
	custom: { name: 'Other provider' }
};
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

export default {
	title: 'Phone',

	async render(main) {
		await uci.load('voice', 'network', 'firewall');
		const head = h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' });
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'Phone'),
			h('p', { class: 'text-sm opacity-70' }, 'Plug a home phone into the TEL port and use your provider’s phone line through this box.'),
			head);
		const statusEl = h('div');
		head.append(statusEl, this.settings());

		const tick = async () => {
			const st = await maybe('alphawrt-voice', 'status', {}, {});
			statusEl.replaceChildren(this.status(st));
		};
		await tick();
		return tick;
	},

	status(st) {
		const on = uci.get('voice', 'main', 'enabled') == '1';
		const b = !st.ports ? badge('warn', 'Port not ready')
			: !on ? badge('off', 'Off')
			: !st.running ? badge('bad', 'Not running')
			: st.registered == null ? badge('off', 'Connecting')
			: st.registered ? badge('ok', 'Ready for calls') : badge('bad', 'Not registered');
		const text = !st.ports ? 'The TEL port driver isn’t loaded in this build yet, so the phone can’t ring. You can still save the line’s settings.'
			: !st.driver ? 'The line can register, but the phone link (baresip fxs module) is missing, so calls won’t reach the phone.'
			: !on ? 'Turn the phone line on and fill in the details from your provider.'
			: st.registered === false ? 'The provider didn’t accept the login. Check the number and password.'
			: st.registered ? 'Pick up the phone: you should hear a dial tone.' : 'Waiting for the provider to answer.';
		const ring = async ev => {
			ev.target.disabled = true;
			const r = await call('alphawrt-voice', 'ring').catch(e => ({ error: e.message }));
			setTimeout(() => { ev.target.disabled = false; }, 4000);
			toast(r.ok ? 'ok' : 'bad', r.ok ? 'Ringing for a few seconds.' : r.error || 'Ringing failed.');
		};
		return card('phone', 'Phone line', b, h('div', {},
			h('p', { class: 'text-sm opacity-80' }, text),
			st.ports > 0 && h('div', { class: 'card-actions justify-end mt-3' },
				h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: ring }, 'Ring the phone'))));
	},

	settings() {
		const v = uci.get('voice', 'main') || {};
		const on = toggle('Use the TEL port as a phone line', v.enabled == '1');
		const preset = choice('Provider', Object.entries(PRESETS).map(([ k, p ]) => [ k, p.name ]), v.preset || 'custom');
		const user = field('Phone number', { value: v.user || '', placeholder: 'e.g. 0312345678', hint: 'As your provider gave it.' });
		const pass = field('Password', { password: true, value: v.password || '', autocomplete: 'new-password' });
		const auth = field('Login name', { value: v.auth_user || '', placeholder: 'Same as the phone number', hint: 'Only if your provider gave a separate login.' });
		const disp = field('Caller name', { value: v.display || '', placeholder: 'Optional' });
		const reg = field('SIP server', { value: v.registrar || '', placeholder: 'sip.provider.com' });
		const proxy = field('Outbound proxy', { value: v.proxy || '', placeholder: 'Optional' });
		const vlan = field('Voice VLAN', { type: 'number', value: v.vlan || '', placeholder: 'None', hint: 'The provider’s separate voice network on the fibre. Empty uses your internet connection.' });
		const transport = choice('Transport', [ [ 'udp', 'UDP' ], [ 'tcp', 'TCP' ] ], v.transport || 'udp');
		const codecs = choice('Voice codec', [ [ 'PCMA PCMU', 'G.711 A-law first (Malaysia, Europe)' ], [ 'PCMU PCMA', 'G.711 µ-law first (US, Japan)' ] ], v.codecs || 'PCMA PCMU');
		preset.input.addEventListener('change', () => {
			const p = PRESETS[preset.input.value];
			if (p.registrar) { reg.input.value = p.registrar; proxy.input.value = p.proxy || ''; vlan.input.value = p.vlan || ''; transport.input.value = p.transport; }
		});

		const go = async () => {
			const val = {
				enabled: on.input.checked ? '1' : '0', preset: preset.input.value,
				user: user.input.value.trim(), password: pass.input.value, auth_user: auth.input.value.trim(), display: disp.input.value.trim().replace(/"/g, ''),
				registrar: reg.input.value.trim(), proxy: proxy.input.value.trim(), vlan: vlan.input.value.trim(),
				transport: transport.input.value, codecs: codecs.input.value
			};
			if (val.enabled == '1') {
				if (!/^\+?[0-9A-Za-z._-]+$/.test(val.user)) return toast('warn', 'Enter the phone number your provider gave you.');
				if (!HOST.test(val.registrar)) return toast('warn', 'Enter the SIP server, like sip.provider.com.');
				if (val.proxy && !HOST.test(val.proxy)) return toast('warn', 'The outbound proxy is a name or address, like 10.255.0.1.');
			}
			if (val.vlan && !(+val.vlan >= 1 && +val.vlan <= 4094)) return toast('warn', 'A VLAN is a number from 1 to 4094.');

			const ops = [ [ 'set', 'voice', 'main', val ] ];
			const iface = uci.get('network', 'voice'), zone = uci.sections('firewall', 'zone').find(z => z.name == 'voice');
			if (val.vlan) {
				const base = String(uci.get('network', 'wan', 'device') || '').replace(/\.\d+$/, '');
				if (!base) return toast('warn', 'Set up the internet connection first: the voice VLAN goes on the same fibre.');
				const net = { proto: 'dhcp', device: `${base}.${val.vlan}`, defaultroute: '0', peerdns: '0' };
				ops.push(iface ? [ 'set', 'network', 'voice', net ] : [ 'add', 'network', 'interface', net, 'voice' ]);
				/* the provider's own voice network: let its calls in, nothing out to the LAN */
				if (!zone) ops.push([ 'add', 'firewall', 'zone', { name: 'voice', network: [ 'voice' ], input: 'ACCEPT', output: 'ACCEPT', forward: 'REJECT' } ]);
			} else {
				if (iface) ops.push([ 'remove', 'network', 'voice' ]);
				if (zone) ops.push([ 'remove', 'firewall', zone['.name'] ]);
			}
			const ok = await save(ops, { what: 'Saving the phone line' }).catch(e => { toast('bad', e.message); return null; });
			if (ok === false) return toast('warn', 'The box didn’t confirm the change, so it was undone.');
			if (ok) { toast('ok', 'Phone line saved.'); redraw(); }
		};

		return card('phone', 'Line settings', null, h('div', {},
			on, preset, user, pass,
			h('details', { class: 'collapse collapse-arrow bg-base-200 border border-base-300 mt-3' },
				h('summary', { class: 'collapse-title text-sm font-medium' }, 'Server and network'),
				h('div', { class: 'collapse-content' }, reg, proxy, auth, disp, vlan, transport, codecs)),
			h('div', { class: 'card-actions justify-end mt-3' }, h('button', { class: 'btn btn-primary btn-sm', onclick: go }, 'Save'))));
	}
};
