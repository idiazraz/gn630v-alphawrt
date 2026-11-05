/*
 * VPN: the WireGuard server and its devices, with live handshake and
 * transfer figures and a QR code per device, drawn in the browser.
 * Below it, Tailscale when the build has it (luci-app-tailscale-community's
 * rpcd object "tailscale"; the GN630V's flash is too small for it).
 */
import { h, icon, badge, alert, card, rows, field, modal, toast, redraw } from '../lib/ui.js';
import { call, maybe, uci, list } from '../lib/rpc.js';
import { save } from '../lib/apply.js';
import { qrSvg } from '../lib/qr.js';

function fmtBytes(b) {
	b = +b || 0;
	if (b < 1024) return `${b} B`;
	if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
	return `${(b / 1073741824).toFixed(2)} GB`;
}

function fmtAgo(ts) {
	if (!ts || ts <= 0) return 'Never';
	const s = Math.floor(Date.now() / 1000) - ts;
	if (s < 60) return 'Just now';
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86400)} d ago`;
}

function makeClientConf({ clientPriv, clientIp, serverPub, endpoint, psk, dns }) {
	let conf = `[Interface]
PrivateKey = ${clientPriv}
Address = ${clientIp}/32
DNS = ${dns || '10.8.0.1'}

[Peer]
PublicKey = ${serverPub}
Endpoint = ${endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
	if (psk) {
		conf = conf.replace('[Peer]\n', `[Peer]\nPresharedKey = ${psk}\n`);
	}
	return conf;
}

export default {
	title: 'VPN',

	async render(main) {
		await uci.load('network', 'firewall', 'alphawrt');

		const wgInstalled = await maybe('luci.wireguard', 'getWgInstances').then(r => r !== null).catch(() => false);
		const content = h('div', { class: 'grid gap-4 lg:grid-cols-2 items-start' });
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'VPN'),
			h('p', { class: 'text-sm opacity-70' }, 'An encrypted tunnel back to your home network from anywhere.'),
			content);

		if (!wgInstalled) {
			content.append(card('vpn', 'WireGuard', badge('warn', 'Not installed'), h('div', { class: 'space-y-3' },
				h('p', { class: 'text-sm opacity-80' }, 'WireGuard isn’t in this build, so this box can’t be a VPN server.'),
				h('div', { class: 'card-actions justify-end' },
					h('a', { href: '/cgi-bin/luci/', class: 'btn btn-ghost btn-sm text-primary' }, 'Advanced settings', icon('external', 'size-4'))))));
			return;
		}

		const tick = async () => {
			await uci.load('network', 'firewall', 'alphawrt');
			/* the WAN address comes from the dump: network.interface.wan isn't in the ACL and sent the page to login (issue 0021) */
			const [ instances, ifDump, ts ] = await Promise.all([
				maybe('luci.wireguard', 'getWgInstances'),
				maybe('network.interface', 'dump'),
				maybe('tailscale', 'get_status', {}, null)
			]);

			const wg = uci.get('network', 'wg0');
			const isBridge = (uci.get('alphawrt', 'setup', 'mode') || 'bridge') == 'bridge';

			/* the endpoint: the WAN address when it's public, else the address this page was opened on */
			const wanIp = ifDump?.interface?.find(i => i.interface == 'wan')?.['ipv4-address']?.[0]?.address;
			let epHost = location.hostname;
			if (wanIp && !/^192\.168\./.test(wanIp) && !/^10\./.test(wanIp) && !/^172\.(1[6-9]|2\d|3[01])\./.test(wanIp)) {
				epHost = wanIp;
			}
			const listenPort = wg?.listen_port || '51820';
			const endpoint = `${epHost}:${listenPort}`;

			let serverPub = instances?.wg0?.public_key;
			if (!serverPub && wg?.private_key) {
				const keys = await maybe('luci.wireguard', 'getPublicAndPrivateKeyFromPrivate', { privkey: wg.private_key });
				serverPub = keys?.keys?.pub || '';
			}

			content.replaceChildren(...[
				isBridge && h('div', { class: 'lg:col-span-2' }, alert('off', 'Bridge mode: forward a port on your router',
					`To reach this VPN from outside your home, forward ${listenPort} UDP on your main router to this box (192.168.100.1).`)),
				...(wg ? [ this.serverCard(wg, serverPub, endpoint), this.peersCard(serverPub, endpoint, instances?.wg0?.peers || []) ] : [ this.setupCard() ]),
				ts?.status && ts.status != 'not_installed' && this.tailscaleCard(ts)
			].filter(Boolean));
		};

		await tick();
		return tick;
	},

	setupCard() {
		return card('vpn', 'WireGuard', badge('off', 'Off'), h('div', { class: 'space-y-3' },
			h('p', { class: 'text-sm opacity-80' }, 'A private, fast, encrypted tunnel back home: browse safely on public Wi-Fi, reach your NAS and servers, and send your phone’s traffic through your home fibre.'),
			h('div', { class: 'card-actions justify-end' },
				h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => this.enableServer() }, 'Set up WireGuard'))));
	},

	serverCard(wg, serverPub, endpoint) {
		const copy = () => navigator.clipboard.writeText(serverPub).then(() => toast('ok', 'Public key copied.'), () => toast('warn', 'Select the key and copy it.'));
		return card('vpn', 'WireGuard server', badge('ok', 'On'), rows([
			[ 'Tunnel network', list(wg.addresses)[0] || '10.8.0.1/24' ],
			[ 'Listen port', `${wg.listen_port || '51820'} UDP` ],
			[ 'Endpoint', endpoint ],
			serverPub && [ 'Public key', h('span', { class: 'inline-flex items-center gap-1 max-w-full' },
				h('span', { class: 'font-mono text-xs truncate', title: serverPub }, serverPub),
				h('button', { type: 'button', class: 'btn btn-ghost btn-xs btn-square -mr-1', 'aria-label': 'Copy public key', onclick: copy }, icon('copy', 'size-3.5'))) ]
		]));
	},

	peersCard(serverPub, endpoint, livePeers) {
		const peers = uci.sections('network', 'wireguard_wg0');
		const live = Object.fromEntries(livePeers.filter(p => p.public_key).map(p => [ p.public_key, p ]));
		const add = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => this.addPeer(serverPub, endpoint) }, icon('plus', 'size-4'), 'Add device');
		return card('devices', 'Devices', null, h('div', { class: 'space-y-3' },
			!peers.length ? h('p', { class: 'text-sm opacity-70' }, 'None yet. Add one to get a QR code for your phone or laptop.')
				: h('ul', { class: 'divide-y divide-base-300' }, peers.map(p => {
					const lp = live[p.public_key] || {}, hs = +lp.latest_handshake || 0;
					const active = hs > 0 && Date.now() / 1000 - hs < 180;
					const rx = +lp.transfer_rx || 0, tx = +lp.transfer_tx || 0;
					const ip = (list(p.allowed_ips)[0] || '').replace(/\/32$/, '');
					return h('li', { class: 'flex items-center gap-3 py-2' },
						h('span', { class: 'flex-1 min-w-0' },
							h('span', { class: 'flex items-center gap-2' }, h('span', { class: 'font-medium truncate' }, p.description || 'Device'),
								active ? badge('ok', 'Active') : badge('off', fmtAgo(hs))),
							h('span', { class: 'block text-sm opacity-70 truncate tabular-nums' }, ip, (rx || tx) ? ` · ↓ ${fmtBytes(rx)} · ↑ ${fmtBytes(tx)}` : '')),
						h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-square text-primary', 'aria-label': 'Show QR code', title: 'Show QR code',
							onclick: () => this.showPeerConfig(p, serverPub, endpoint) }, icon('qr', 'size-4')),
						h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-square text-error', 'aria-label': 'Remove device', title: 'Remove device',
							onclick: () => this.removePeer(p['.name'], p.description || 'Device') }, icon('trash', 'size-4')));
				})),
			h('div', { class: 'card-actions justify-end' }, add)));
	},

	async enableServer() {
		const keyGen = await maybe('luci.wireguard', 'generateKeyPair');
		if (!keyGen?.keys?.priv)
			return toast('bad', 'Could not generate WireGuard keypair on this box.');

		const priv = keyGen.keys.priv;
		const wgValues = {
			proto: 'wireguard',
			private_key: priv,
			listen_port: '51820',
			addresses: [ '10.8.0.1/24' ]
		};
		const ops = [
			uci.get('network', 'wg0')
				? [ 'set', 'network', 'wg0', wgValues ]
				: [ 'add', 'network', 'interface', wgValues, 'wg0' ]
		];

		const zones = uci.sections('firewall', 'zone');
		const vpnZone = zones.find(z => z.name == 'vpn');
		if (!vpnZone) {
			ops.push([ 'add', 'firewall', 'zone', {
				name: 'vpn',
				network: [ 'wg0' ],
				input: 'ACCEPT',
				output: 'ACCEPT',
				forward: 'ACCEPT',
				masq: '1'
			} ]);
		} else {
			const nets = list(vpnZone.network);
			if (!nets.includes('wg0')) {
				ops.push([ 'set', 'firewall', vpnZone['.name'], { network: [ ...nets, 'wg0' ] } ]);
			}
		}

		const fwds = uci.sections('firewall', 'forwarding');
		if (!fwds.some(f => f.src == 'vpn' && f.dest == 'wan')) {
			ops.push([ 'add', 'firewall', 'forwarding', { src: 'vpn', dest: 'wan' } ]);
		}
		if (!fwds.some(f => f.src == 'vpn' && f.dest == 'lan')) {
			ops.push([ 'add', 'firewall', 'forwarding', { src: 'vpn', dest: 'lan' } ]);
		}

		const rules = uci.sections('firewall', 'rule');
		if (!rules.some(r => r.name == 'Allow-WireGuard')) {
			ops.push([ 'add', 'firewall', 'rule', {
				name: 'Allow-WireGuard',
				src: 'wan',
				proto: 'udp',
				dest_port: '51820',
				target: 'ACCEPT'
			} ]);
		}

		const ok = await save(ops, { what: 'Setting up WireGuard VPN' }).catch(e => { toast('bad', e.message); return null; });
		if (ok === false) return toast('warn', 'The box didn’t confirm the change, so it was undone.');
		if (ok) {
			toast('ok', 'WireGuard VPN server enabled.');
			redraw();
		}
	},

	async addPeer(serverPub, endpoint) {
		const nameField = field('Device name', {
			placeholder: 'e.g. iPhone, work laptop',
			hint: 'Give this device a recognisable name.'
		});
		const ok = await modal('Add a VPN device', h('div', { class: 'space-y-3' },
			h('p', { class: 'text-sm opacity-80' }, 'Generate a configuration for your phone or laptop to connect to this box.'),
			nameField
		), [
			[ 'Cancel', 'btn-ghost', false ],
			[ 'Create', 'btn-primary', true ]
		]);
		if (!ok) return;

		const desc = (nameField.input.value || '').trim() || 'Device';
		const [ clientKeys, pskRes ] = await Promise.all([
			call('luci.wireguard', 'generateKeyPair'),
			call('luci.wireguard', 'generatePsk').catch(() => null)
		]);

		if (!clientKeys?.keys?.pub)
			return toast('bad', 'Could not generate client keypair.');

		const clientPriv = clientKeys.keys.priv;
		const clientPub = clientKeys.keys.pub;
		const psk = pskRes?.psk || '';

		const peers = uci.sections('network', 'wireguard_wg0');
		let nextOctet = 2;
		for (const p of peers) {
			for (const a of list(p.allowed_ips)) {
				const m = /^10\.8\.0\.(\d+)/.exec(a);
				if (m && +m[1] >= nextOctet) nextOctet = +m[1] + 1;
			}
		}
		const clientIp = `10.8.0.${nextOctet}`;

		const peerValues = {
			description: desc,
			public_key: clientPub,
			allowed_ips: [ `${clientIp}/32` ],
			route_allowed_ips: '1',
			client_key: clientPriv
		};
		if (psk) peerValues.preshared_key = psk;

		const ops = [ [ 'add', 'network', 'wireguard_wg0', peerValues ] ];
		const saved = await save(ops, { what: 'Adding device' }).catch(e => { toast('bad', e.message); return null; });
		if (!saved) return saved === false && toast('warn', 'The box didn’t confirm the change, so it was undone.');

		const clientConf = makeClientConf({
			clientPriv,
			clientIp,
			serverPub,
			endpoint,
			psk,
			dns: '10.8.0.1'
		});

		this.showPeerModal(desc, clientConf);
		redraw();
	},

	showPeerConfig(peer, serverPub, endpoint) {
		const clientPriv = peer.client_key;
		const allowedIp = (list(peer.allowed_ips)[0] || '10.8.0.2/32').replace(/\/32$/, '');
		const psk = peer.preshared_key;

		if (!clientPriv) {
			return modal(peer.description || 'Device', h('div', { class: 'space-y-3 text-sm' },
				h('p', {}, 'The private key for this peer was not stored on the router.'),
				h('p', { class: 'opacity-70 text-xs' }, 'To get a new QR code for your device, remove this device and add it again.')
			), [ [ 'Close', 'btn-ghost', true ] ]);
		}

		const conf = makeClientConf({
			clientPriv,
			clientIp: allowedIp,
			serverPub,
			endpoint,
			psk,
			dns: '10.8.0.1'
		});

		this.showPeerModal(peer.description || 'Device', conf);
	},

	showPeerModal(title, conf) {
		let qrNode;
		try {
			qrNode = qrSvg(conf, 'w-60 h-60 mx-auto rounded-xl p-2 bg-white border border-base-300 shadow-sm');
		} catch (e) {
			console.warn('QR render error:', e);
			qrNode = h('p', { class: 'text-error text-xs' }, 'Configuration too large for QR: copy text below instead.');
		}

		const copyBtn = h('button', {
			type: 'button',
			class: 'btn btn-outline btn-sm gap-2',
			onclick: async () => {
				try {
					await navigator.clipboard.writeText(conf);
					toast('ok', 'Configuration copied to clipboard.');
				} catch (e) {
					toast('warn', 'Select and copy text below.');
				}
			}
		}, icon('copy', 'size-4'), 'Copy text');

		const dlBtn = h('button', {
			type: 'button',
			class: 'btn btn-outline btn-sm gap-2',
			onclick: () => {
				const blob = new Blob([ conf ], { type: 'text/plain' });
				const a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.conf`;
				a.click();
				URL.revokeObjectURL(a.href);
			}
		}, icon('cable', 'size-4'), 'Download .conf');

		modal(title, h('div', { class: 'space-y-4 text-center' },
			qrNode,
			h('p', { class: 'text-xs opacity-75' }, 'Open WireGuard on your phone, tap ', h('b', {}, '+'), ' and choose ', h('b', {}, 'Create from QR code'), '.'),
			h('div', { class: 'flex justify-center gap-2' }, copyBtn, dlBtn),
			h('details', { class: 'collapse collapse-arrow bg-base-200 border border-base-300 text-left' },
				h('summary', { class: 'collapse-title text-xs font-semibold' }, 'View configuration text'),
				h('div', { class: 'collapse-content' },
					h('pre', { class: 'text-xs font-mono p-3 rounded bg-base-300 overflow-x-auto select-all whitespace-pre' }, conf)
				)
			)
		), [
			[ 'Done', 'btn-primary', true ]
		]);
	},

	/* status from get_status; login opens Tailscale's sign-in page, the rest is in LuCI */
	tailscaleCard(ts) {
		const peers = Object.values(ts.peers || {}), online = peers.filter(p => p.online).length;
		const running = ts.status == 'running';
		const login = async ev => {
			ev.target.disabled = true;
			toast('ok', 'Asking Tailscale for a sign-in link…');
			const r = await call('tailscale', 'do_login', { form_data: { loginserver: '' } }).catch(e => ({ error: e.message }));
			ev.target.disabled = false;
			if (!r.url) return toast('bad', r.error || 'Tailscale gave no sign-in link.');
			window.open(r.url, '_blank', 'noopener');
		};
		const logout = async () => {
			if (!await modal('Log out of Tailscale?', h('p', { class: 'text-sm' }, 'Your other Tailscale devices can’t reach this box until you log in again.'),
				[ [ 'Cancel', 'btn-ghost', false ], [ 'Log out', 'btn-warning', true ] ])) return;
			const r = await call('tailscale', 'do_logout').catch(e => ({ error: e.message }));
			toast(r.error ? 'bad' : 'ok', r.error || 'Logged out of Tailscale.');
			redraw();
		};
		const b = running ? badge('ok', 'Connected') : ts.status == 'logout' ? badge('warn', 'Not logged in') : badge('off', 'Stopped');
		return card('vpn', 'Tailscale', b, h('div', { class: 'space-y-3' },
			h('p', { class: 'text-sm opacity-80' }, running
				? `This box is ${ts.ipv4} on ${ts.domain_name || 'your tailnet'}. ${online} of ${peers.length} other devices online.`
				: 'Reach your home network from any device with Tailscale, without opening a port. Works behind CGNAT too.'),
			ts.health && h('p', { class: 'text-xs opacity-60' }, ts.health),
			h('div', { class: 'card-actions justify-end' },
				h('a', { href: '/cgi-bin/luci/admin/vpn/tailscale', class: 'btn btn-ghost btn-sm text-primary' }, 'More settings', icon('external', 'size-4')),
				running ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: logout }, 'Log out')
					: ts.status == 'logout' && h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: login }, 'Log in to Tailscale'))));
	},

	async removePeer(sectionName, desc) {
		const ok = await modal(`Remove ${desc}?`, h('p', { class: 'text-sm' }, `This device will no longer be able to connect through this VPN.`), [
			[ 'Cancel', 'btn-ghost', false ],
			[ 'Remove', 'btn-error', true ]
		]);
		if (!ok) return;

		const ops = [ [ 'remove', 'network', sectionName ] ];
		const saved = await save(ops, { what: 'Removing device' }).catch(e => { toast('bad', e.message); return null; });
		if (saved === false) return toast('warn', 'The box didn’t confirm the change, so it was undone.');
		if (saved) {
			toast('ok', `${desc} removed.`);
			redraw();
		}
	}
};
