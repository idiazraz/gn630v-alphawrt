'use strict';
'require baseclass';
'require ui';

/* Menu renderer for the AlphaWRT theme, based on menu-bootstrap.js.
 * Adds "active" classes for the current section and page, and ARIA state for
 * the dropdown groups (opened by nav.js on narrow screens).
 *
 * Pages are grouped here, not in menu.d, so they keep their addresses and
 * pages from other packages can move too. */

/* groups built from pages under admin/: [ path, label ] in menu order. A
 * group with none of its pages installed doesn't show. Each build has one of
 * network/omci (omci-agent) and the xpon/ pages (luci-app-xpon). */
const GROUPS = [
	{ key: 'fibre', title: _('Fibre'), order: 15, pages: [
		[ 'status/fibre', _('Diagnostics') ],
		[ 'status/fibre-topology', _('Topology') ],
		[ 'status/fibre-provisioning', _('Provisioning') ],
		[ 'network/omci', _('OMCI') ],
		[ 'xpon/status', _('xPON status') ],
		[ 'xpon/omci', _('OMCI') ],
		[ 'xpon/config', _('xPON settings') ],
		[ 'xpon/epon', _('EPON') ]
	] },
	{ key: 'wifi', title: _('Wi-Fi'), order: 17, pages: [
		[ 'network/wireless', _('Wireless') ],
		[ 'status/channel_analysis', _('Channel Analysis') ],
		[ 'network/usteer', _('Band steering') ]
	] },
	{ key: 'vpn', title: _('VPN'), order: 18, pages: [
		[ 'status/wireguard', _('WireGuard') ]
	] }
];

/* where the stock groups sit among those */
const ORDER = { network: 16, services: 40, system: 900 };

/* Status lists what Network sets up: these tell the two apart */
const TITLES = {
	'status/routes': _('Routing table'),
	'status/routesj': _('Routing table'),
	'status/nftables': _('Firewall rules'),
	'status/iptables': _('Firewall rules')
};

/* path under admin/, label in the bar, ahead of Services */
const SHORTCUTS = [
	[ 'services/pihole', _('Pi-hole') ]
];

return baseclass.extend({
	__init__() {
		/* one login for both UIs: the Simple UI takes this session (lib/rpc.js) */
		try {
			if (L.env.sessionid)
				localStorage.setItem('alphawrt-sid', L.env.sessionid);
		} catch (e) {}

		ui.menu.load().then((tree) => this.render(tree));
	},

	render(tree) {
		let node = tree;
		let url = '';

		/* tabs first: they walk the tree by address, before regroup() moves pages */
		if (L.env.dispatchpath.length >= 3) {
			for (let i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}

		this.renderModeMenu(tree);
	},

	regroup(root) {
		const page = (path) => {
			const [ group, name ] = path.split('/');
			return root.children[group]?.children?.[name];
		};

		for (const path in TITLES)
			if (page(path))
				page(path).title = TITLES[path];

		GROUPS.forEach(({ key, title, order, pages }) => {
			const group = root.children[key] ??= {};

			group.children ??= {};
			pages.forEach(([ path, label ], i) => {
				const node = page(path), [ from, name ] = path.split('/');

				if (node?.satisfied) {
					delete root.children[from].children[name];
					group.children[path] = Object.assign(node, { path, order: i + 1, title: label });
				}
			});
			Object.assign(group, { title, order, satisfied: ui.menu.getChildren(group).length > 0 });
		});

		for (const key in ORDER)
			if (root.children[key])
				root.children[key].order = ORDER[key];

		/* a group whose pages all moved has nothing left to open */
		if (root.children.xpon && !ui.menu.getChildren(root.children.xpon).length)
			delete root.children.xpon;
	},

	renderTabMenu(tree, url, level) {
		const container = document.querySelector('#tabmenu');
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[3 + (level || 0)] == child.name);
			const activeClass = isActive ? ' active' : '';
			const className = 'tabmenu-item-%s %s'.format(child.name, activeClass);

			ul.appendChild(E('li', { 'class': className }, [
				E('a', { 'href': L.url(url, child.name), 'aria-current': isActive ? 'page' : null }, [ _(child.title) ] )]));

			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return E([]);

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

		return ul;
	},

	renderMainMenu(tree, url, level) {
		const ul = level ? E('ul', { 'class': 'dropdown-menu' }) : document.querySelector('#topmenu');
		const children = ui.menu.getChildren(tree);

		if (children.length == 0 || level > 1)
			return E([]);

		const here = L.env.dispatchpath.slice(1, 3).join('/');
		const onShortcut = SHORTCUTS.some(([ path ]) => path == here);

		const addShortcuts = () => SHORTCUTS.forEach(([ path, label ]) => {
			const [ group, page ] = path.split('/');

			if (!tree.children[group]?.children?.[page]?.satisfied)
				return;

			ul.appendChild(E('li', { 'class': 'shortcut topmenu-%s%s'.format(page, path == here ? ' active' : '') }, [
				E('a', { 'href': L.url(url, group, page), 'aria-current': path == here ? 'page' : null }, [ label ])
			]));
		});

		children.forEach(child => {
			if (!level && child.name == 'services')
				addShortcuts();

			const submenu = this.renderMainMenu(child, url + '/' + child.name, (level || 0) + 1);
			const hasSub = !level && submenu.firstElementChild;
			const path = child.path || url.split('/').slice(1).concat(child.name).join('/');
			const isActive = level ? path == here
				: hasSub ? !onShortcut && !!submenu.querySelector('.active')
				: L.env.dispatchpath[1] == child.name;
			/* topmenu-<name>: lets the stylesheet place Log out */
			const classes = [ hasSub ? 'dropdown' : null, isActive ? 'active' : null,
				level ? null : 'topmenu-' + child.name ].filter(Boolean).join(' ');

			const li = E('li', { 'class': classes || null }, [
				E('a', {
					'class': hasSub ? 'menu' : null,
					'href': hasSub ? '#' : child.path ? L.url(url.split('/')[0], child.path) : L.url(url, child.name),
					'aria-haspopup': hasSub ? 'true' : null,
					'aria-expanded': hasSub ? 'false' : null,
					'aria-current': (isActive && level) ? 'page' : null
				}, [ _(child.title) ]),
				submenu
			]);

			ul.appendChild(li);
		});

		ul.style.display = '';

		return ul;
	},

	renderModeMenu(tree) {
		const ul = document.querySelector('#modemenu');
		const children = ui.menu.getChildren(tree);

		children.forEach((child, index) => {
			const isActive = L.env.requestpath.length
				? child.name === L.env.requestpath[0]
				: index === 0;

			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(child.name) }, [ _(child.title) ])
			]));

			if (isActive) {
				this.regroup(child);
				this.renderMainMenu(child, child.name);
			}
		});

		if (ul.children.length > 1)
			ul.style.display = '';
	}
});
