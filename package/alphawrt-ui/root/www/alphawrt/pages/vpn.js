/*
 * VPN: WireGuard server management.
 * Connect securely to your home network from phone or laptop.
 * Displays peer status, live handshake/transfer metrics, and draws
 * scannable QR codes in the browser for instant mobile setup.
 */
import { h, icon, field, toggle, modal, toast, redraw, fmtTime } from '../lib/ui.js';
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
		const head = h('div', { class: 'flex items-center justify-between mb-2' },
			h('div', {},
				h('h1', { class: 'text-2xl font-bold' }, 'VPN (WireGuard)'),
				h('p', { class: 'text-sm opacity-70 mt-1' }, 'Encrypted tunnel back to your home network from anywhere.')
			)
		);
		const content = h('div', { class: 'space-y-6' });
		main.append(head, content);

		if (!wgInstalled) {
			content.append(h('div', { class: 'card bg-base-100 border border-base-300' },
				h('div', { class: 'card-body' },
					h('div', { class: 'flex items-center gap-3 text-warning font-semibold' },
						icon('warn', 'size-5'), 'WireGuard package not detected'
					),
					h('p', { class: 'text-sm opacity-80 mt-2' },
						'The WireGuard kernel module or tools are not present on this build. WireGuard is pinned for the complete v0.3.0 image.'
					),
					h('div', { class: 'card-actions mt-4' },
						h('a', { href: '/cgi-bin/luci/', class: 'btn btn-outline btn-sm' },
							icon('external', 'size-4'), 'Open Advanced settings'
						)
					)
				)
			));
			return;
		}

		const tick = async () => {
			await uci.load('network', 'firewall', 'alphawrt');
			const [ instances, wanStatus, ifDump ] = await Promise.all([
				maybe('luci.wireguard', 'getWgInstances'),
				maybe('network.interface.wan', 'status'),
				maybe('network.interface', 'dump')
			]);

			const wg = uci.get('network', 'wg0');
			const mode = uci.get('alphawrt', 'setup', 'mode') || 'bridge';
			const isBridge = mode == 'bridge';

			// Determine external endpoint
			let wanIp = wanStatus?.ipv4_address?.[0]?.address;
			if (!wanIp && ifDump?.interface) {
				const wan = ifDump.interface.find(i => i.interface == 'wan');
				wanIp = wan?.['ipv4-address']?.[0]?.address;
			}
			let epHost = location.hostname;
			if (wanIp && !/^192\.168\./.test(wanIp) && !/^10\./.test(wanIp) && !/^172\.(1[6-9]|2\d|3[01])\./.test(wanIp)) {
				epHost = wanIp;
			}
			const listenPort = wg?.listen_port || '51820';
			const endpoint = `${epHost}:${listenPort}`;

			// Server public key
			let serverPub = instances?.wg0?.public_key;
			if (!serverPub && wg?.private_key) {
				const keys = await maybe('luci.wireguard', 'getPublicAndPrivateKeyFromPrivate', { privkey: wg.private_key });
				serverPub = keys?.keys?.pub || '';
			}

			content.replaceChildren();

			if (isBridge) {
				content.append(h('div', { role: 'status', class: 'alert alert-soft alert-info text-sm flex gap-3 items-start' },
					icon('warn', 'size-5 shrink-0'),
					h('div', {},
						h('b', {}, 'In bridge mode: '),
						'To reach this VPN from outside your home, forward port ',
						h('b', {}, `${listenPort} UDP`),
						' on your main router to this box’s IP (',
						h('b', {}, '192.168.100.1'),
						').'
					)
				));
			}

			if (!wg) {
				content.append(this.setupCard());
			} else {
				content.append(this.serverCard(wg, serverPub, endpoint, isBridge));
				content.append(this.peersCard(wg, serverPub, endpoint, isBridge, instances?.wg0?.peers || []));
			}
		};

		await tick();
		return tick;
	},

	setupCard() {
		return h('div', { class: 'card bg-base-100 border border-base-300' },
			h('div', { class: 'card-body p-6' },
				h('div', { class: 'flex items-center gap-3' },
					h('span', { class: 'grid place-items-center size-10 rounded-full bg-primary/10 text-primary' }, icon('vpn', 'size-6')),
					h('div', {},
						h('h2', { class: 'text-lg font-bold' }, 'Turn on WireGuard VPN'),
						h('span', { class: 'badge badge-sm badge-ghost' }, 'Not configured')
					)
				),
				h('p', { class: 'text-sm opacity-80 mt-3 leading-relaxed' },
					'WireGuard gives you a private, high-speed encrypted tunnel back to your home network. ' +
					'Browse securely on public Wi-Fi, access your local NAS/servers, and route all phone traffic through your home fibre line.'
				),
				h('div', { class: 'card-actions mt-4' },
					h('button', {
						type: 'button',
						class: 'btn btn-primary gap-2',
						onclick: () => this.enableServer()
					}, icon('ok', 'size-4'), 'Set up WireGuard Server')
				)
			)
		);
	},

	serverCard(wg, serverPub, endpoint, isBridge) {
		const port = wg.listen_port || '51820';
		const addr = (list(wg.addresses)[0] || '10.8.0.1/24');
		return h('div', { class: 'card bg-base-100 border border-base-300' },
			h('div', { class: 'card-body p-6' },
				h('div', { class: 'flex items-center justify-between' },
					h('div', { class: 'flex items-center gap-3' },
						h('span', { class: 'grid place-items-center size-9 rounded-full bg-success/15 text-success' }, icon('vpn', 'size-5')),
						h('div', {},
							h('h2', { class: 'font-semibold text-base' }, 'WireGuard Server'),
							h('span', { class: 'badge badge-sm badge-success badge-soft' }, 'Running')
						)
					),
					h('span', { class: 'text-xs font-mono opacity-60' }, `Interface wg0`)
				),
				h('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-sm' },
					h('div', { class: 'p-3 rounded-lg bg-base-200/60' },
						h('span', { class: 'block text-xs opacity-60 uppercase' }, 'Tunnel Network'),
						h('span', { class: 'font-mono font-medium' }, addr)
					),
					h('div', { class: 'p-3 rounded-lg bg-base-200/60' },
						h('span', { class: 'block text-xs opacity-60 uppercase' }, 'Listen Port'),
						h('span', { class: 'font-mono font-medium' }, `${port} UDP`)
					),
					h('div', { class: 'p-3 rounded-lg bg-base-200/60' },
						h('span', { class: 'block text-xs opacity-60 uppercase' }, 'Endpoint Address'),
						h('span', { class: 'font-mono font-medium truncate block', title: endpoint }, endpoint)
					)
				),
				serverPub && h('div', { class: 'mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-base-200/40 text-xs font-mono' },
					h('span', { class: 'opacity-60 shrink-0 font-sans' }, 'Server Public Key:'),
					h('span', { class: 'truncate flex-1 font-mono' }, serverPub),
					h('button', {
						type: 'button',
						class: 'btn btn-ghost btn-xs',
						title: 'Copy public key',
						onclick: () => {
							navigator.clipboard.writeText(serverPub);
							toast('ok', 'Public key copied.');
						}
					}, icon('copy', 'size-3.5'))
				)
			)
		);
	},

	peersCard(wg, serverPub, endpoint, isBridge, livePeers) {
		const peers = uci.sections('network', 'wireguard_wg0');
		const liveMap = {};
		for (const lp of livePeers) {
			if (lp.public_key) liveMap[lp.public_key] = lp;
		}

		return h('div', { class: 'card bg-base-100 border border-base-300' },
			h('div', { class: 'card-body p-6' },
				h('div', { class: 'flex items-center justify-between mb-2' },
					h('div', { class: 'flex items-center gap-2' },
						h('h2', { class: 'font-bold text-lg' }, 'Connected Devices'),
						h('span', { class: 'badge badge-sm badge-neutral badge-soft' }, peers.length)
					),
					h('button', {
						type: 'button',
						class: 'btn btn-primary btn-sm gap-1',
						onclick: () => this.addPeer(serverPub, endpoint, isBridge)
					}, icon('plus', 'size-4'), 'Add Device')
				),

				!peers.length ? h('div', { class: 'text-center py-8 opacity-70' },
					icon('devices', 'size-10 mx-auto opacity-40 mb-2'),
					h('p', { class: 'text-sm font-medium' }, 'No devices added yet'),
					h('p', { class: 'text-xs mt-1' }, 'Click “Add Device” to generate a secure profile for your phone or laptop.')
				) : h('ul', { class: 'divide-y divide-base-300 -mx-4 mt-2' }, peers.map(p => {
					const lp = liveMap[p.public_key] || {};
					const latestHs = +lp.latest_handshake || 0;
					const isRecent = latestHs > 0 && (Date.now() / 1000 - latestHs < 180);
					const rx = +lp.transfer_rx || 0;
					const tx = +lp.transfer_tx || 0;
					const allowedIp = (list(p.allowed_ips)[0] || '').replace(/\/32$/, '');

					return h('li', { class: 'flex items-center gap-3 px-4 py-3 hover:bg-base-200/50 transition-colors' },
						h('span', { class: `grid place-items-center size-9 shrink-0 rounded-full ${isRecent ? 'bg-success/15 text-success' : 'bg-base-200 text-base-content/60'}` },
							icon('devices', 'size-5')
						),
						h('div', { class: 'flex-1 min-w-0' },
							h('div', { class: 'flex items-center gap-2' },
								h('span', { class: 'font-medium text-sm truncate' }, p.description || 'Device'),
								h('span', { class: `badge badge-xs ${isRecent ? 'badge-success' : 'badge-ghost'}` },
									isRecent ? 'Active' : fmtAgo(latestHs)
								)
							),
							h('div', { class: 'flex items-center gap-3 text-xs opacity-70 mt-0.5' },
								h('span', { class: 'font-mono' }, allowedIp),
								(rx > 0 || tx > 0) && h('span', { class: 'tabular-nums' }, `↓ ${fmtBytes(rx)} · ↑ ${fmtBytes(tx)}`)
							)
						),
						h('div', { class: 'flex items-center gap-1' },
							h('button', {
								type: 'button',
								class: 'btn btn-ghost btn-sm btn-square',
								title: 'Show QR code & configuration',
								onclick: () => this.showPeerConfig(p, serverPub, endpoint, isBridge)
							}, icon('qr', 'size-4 text-primary')),
							h('button', {
								type: 'button',
								class: 'btn btn-ghost btn-sm btn-square text-error',
								title: 'Remove device',
								onclick: () => this.removePeer(p['.name'], p.description || 'Device')
							}, icon('trash', 'size-4'))
						)
					);
				}))
			)
		);
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

		const ok = await save(ops, { what: 'Setting up WireGuard VPN' }).catch(e => { toast('bad', e.message); return false; });
		if (ok) {
			toast('ok', 'WireGuard VPN server enabled.');
			redraw();
		}
	},

	async addPeer(serverPub, endpoint, isBridge) {
		const nameField = field('Device name', {
			placeholder: 'e.g. iPhone, Work Laptop',
			hint: 'Give this device a recognisable name.'
		});
		const ok = await modal('Add VPN Device', h('div', { class: 'space-y-3' },
			h('p', { class: 'text-sm opacity-80' }, 'Generate a configuration for your phone or laptop to connect to this box.'),
			nameField
		), [
			[ 'Cancel', 'btn-ghost', false ],
			[ 'Generate & Connect', 'btn-primary', true ]
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
		const saved = await save(ops, { what: 'Adding device' }).catch(e => { toast('bad', e.message); return false; });
		if (!saved) return;

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

	showPeerConfig(peer, serverPub, endpoint, isBridge) {
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

	async removePeer(sectionName, desc) {
		const ok = await modal(`Remove ${desc}?`, h('p', { class: 'text-sm' }, `This device will no longer be able to connect through this VPN.`), [
			[ 'Cancel', 'btn-ghost', false ],
			[ 'Remove', 'btn-error', true ]
		]);
		if (!ok) return;

		const ops = [ [ 'remove', 'network', sectionName ] ];
		const saved = await save(ops, { what: 'Removing device' }).catch(e => { toast('bad', e.message); return false; });
		if (saved) {
			toast('ok', `${desc} removed.`);
			redraw();
		}
	}
};
