/*
 * App shell: login, the hash router (#/home, #/wifi …), the sidebar (laptop)
 * and dock (phone), and the page lifecycle. Each page is an ES module in
 * pages/ exporting { title, render(main, ctx) }; render may return a function
 * that runs every 5 s while the page is open and the tab is visible.
 */
import { h, icon, logo } from './lib/ui.js';
import { call, login, logout, forget, loggedIn, uci, AuthError } from './lib/rpc.js';

const LUCI = '/cgi-bin/luci/';
const NAV = [
	[ 'home', 'Home', 'home' ],
	[ 'fibre', 'Fibre', 'fibre' ],
	[ 'wifi', 'Wi-Fi', 'wifi' ],
	[ 'devices', 'Devices', 'devices' ],
	[ 'pihole', 'Pi-hole', 'block' ],
	[ 'vpn', 'VPN', 'vpn' ],
	[ 'system', 'System', 'system' ],
	[ 'homelab', 'Home lab', 'box' ]
];
const DOCK = [ 'home', 'wifi', 'devices', 'more' ];
const PAGES = [ 'home', 'fibre', 'wifi', 'devices', 'system', 'homelab', 'vpn', 'pihole', 'setup' ];

const app = document.getElementById('app');
let timer = null;

function route() { return (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'home'; }

function shell(page, main) {
	const link = ([ id, label, ic ], cls) => h('a', { href: `#/${id}`, class: cls, 'aria-current': id == page ? 'page' : null }, icon(ic), label);
	return h('div', { class: 'lg:flex' },
		h('aside', { class: 'hidden lg:flex flex-col w-64 shrink-0 h-dvh sticky top-0 bg-base-100 border-r border-base-300 px-3 py-5' },
			h('a', { href: '#/home', class: 'px-3 mb-6' }, logo('h-9 w-auto')),
			h('ul', { class: 'menu w-full gap-1 p-0 text-base' }, NAV.map(n => h('li', {}, link(n, n[0] == page ? 'menu-active' : null)))),
			h('ul', { class: 'menu w-full gap-1 p-0 mt-auto text-base' },
				h('li', {}, h('a', { href: LUCI }, icon('external'), 'Advanced (LuCI)')),
				h('li', {}, h('a', { href: '#/logout' }, icon('logout'), 'Log out')))),
		h('div', { class: 'flex-1 min-w-0' },
			h('header', { class: 'lg:hidden sticky top-0 z-10 flex items-center h-14 px-4 bg-base-100 border-b border-base-300' },
				h('a', { href: '#/home' }, logo('h-7 w-auto')),
				h('a', { href: '#/setup', class: 'btn btn-ghost btn-sm ml-auto -mr-2 text-primary' }, icon('wand'), 'Quick Setup')),
			main),
		h('nav', { class: 'dock lg:hidden bg-base-100 border-t border-base-300', 'aria-label': 'Main' }, DOCK.map(id => {
			const [ , label, ic ] = NAV.find(n => n[0] == id) || [ 'more', 'More', 'more' ];
			const on = id == page || (id == 'more' && !DOCK.includes(page));
			return h('a', { href: `#/${id}`, class: on ? 'dock-active text-primary' : null, 'aria-current': on ? 'page' : null },
				icon(ic), h('span', { class: 'dock-label' }, label));
		})));
}

function loginView(error) {
	const pw = h('input', { type: 'password', name: 'password', class: 'grow min-w-0', autocomplete: 'current-password', required: true, autofocus: true });
	const form = h('form', { class: 'card bg-base-100 border border-base-300 w-full max-w-sm' },
		h('div', { class: 'card-body gap-4' },
			logo('h-9 w-auto self-center mb-2'),
			h('h1', { class: 'text-xl font-bold text-center' }, 'Log in to this box'),
			h('fieldset', { class: 'fieldset' },
				h('legend', { class: 'fieldset-legend' }, 'Password'),
				h('label', { class: 'input w-full' }, pw,
					h('button', { type: 'button', class: 'btn btn-ghost btn-xs btn-square -mr-2', 'aria-label': 'Show or hide password',
						onclick: () => { pw.type = pw.type == 'password' ? 'text' : 'password'; } }, icon('eye', 'size-4'))),
				h('p', { class: 'label text-xs whitespace-normal' }, 'The same password as Advanced settings and SSH (user “root”).')),
			error && h('div', { role: 'alert', class: 'alert alert-error alert-soft text-sm' }, icon('bad'), error),
			h('button', { class: 'btn btn-primary' }, 'Log in')));
	form.addEventListener('submit', async e => {
		e.preventDefault();
		form.querySelector('.btn-primary').classList.add('btn-disabled');
		if (await login(pw.value))
			start();
		else
			app.replaceChildren(loginView('That password didn’t work.'));
	});
	return h('main', { class: 'min-h-dvh grid place-items-center p-4' }, form);
}

/* More (phone): everything the dock has no room for */
const more = {
	title: 'More',
	render(main) {
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'More'),
			h('ul', { class: 'menu w-full bg-base-100 rounded-box border border-base-300 text-base' },
				NAV.filter(n => !DOCK.includes(n[0])).map(([ id, label, ic ]) => h('li', {}, h('a', { href: `#/${id}` }, icon(ic), label))),
				h('li', {}, h('a', { href: LUCI }, icon('external'), 'Advanced settings (LuCI)')),
				h('li', {}, h('a', { href: '#/logout' }, icon('logout'), 'Log out'))));
	}
};

/* a page not built yet: send the user to the LuCI equivalent */
const later = (title, path) => ({
	title,
	render(main) {
		main.append(h('h1', { class: 'text-2xl font-bold' }, title),
			h('div', { class: 'card bg-base-100 border border-base-300' }, h('div', { class: 'card-body' },
				h('p', {}, 'This page is coming to the simple pages soon. Until then it’s in Advanced settings.'),
				h('div', { class: 'card-actions' }, h('a', { href: LUCI + path, class: 'btn btn-primary btn-sm' }, `Open ${title} in Advanced`, icon('external', 'size-4'))))));
	}
});
const LATER = {};

async function show() {
	clearInterval(timer);
	const page = route();
	if (page == 'logout') {
		await logout();
		location.hash = '#/home';
		return app.replaceChildren(loginView());
	}

	const main = h('main', { class: 'mx-auto max-w-5xl px-4 pt-4 pb-28 lg:px-8 lg:py-8 space-y-4', id: 'main' });
	const spinner = h('span', { class: 'loading loading-spinner loading-md text-primary block mx-auto my-16', 'aria-label': 'Loading' });
	main.append(spinner);
	app.replaceChildren(shell(page, main));
	try {
		const mod = page == 'more' ? more : LATER[page] || (await import(`./pages/${PAGES.includes(page) ? page : 'home'}.js?v=0.3.0`)).default;
		document.title = `${mod.title} · AlphaWRT`;
		const tick = await mod.render(main, { uci, call });
		spinner.remove();
		if (typeof tick == 'function')
			timer = setInterval(() => { if (!document.hidden) tick().catch(fail); }, 5000);
	}
	catch (e) { spinner.remove(); fail(e); }
}

function fail(e) {
	clearInterval(timer);
	if (e instanceof AuthError) {
		forget();
		return app.replaceChildren(loginView());
	}
	console.error(e);
	document.getElementById('main')?.append(h('div', { role: 'alert', class: 'alert alert-error alert-soft' }, icon('bad'), `Something went wrong: ${e.message}`));
}

/*
 * A bridge-mode box has no Internet, so no NTP: its clock drifts or restarts
 * from the last saved time (often a day off), and event times go wrong. Set it
 * from this browser when it's more than 5 minutes off, as LuCI's "Sync with
 * browser" button does. system.info's localtime is the box's local time in
 * epoch seconds, so compare it with the browser's local time; setLocaltime
 * takes UTC epoch seconds.
 */
async function syncClock() {
	if (uci.get('alphawrt', 'setup', 'mode') != 'bridge') return;
	const box = (await call('system', 'info').catch(() => ({}))).localtime, now = Math.floor(Date.now() / 1000);
	if (box && Math.abs(box - (now - new Date().getTimezoneOffset() * 60)) > 300)
		await call('luci', 'setLocaltime', { localtime: now }).catch(() => {});
}

async function start() {
	/* first run: Quick Setup, as the stock firmware does (once per tab, so Home stays reachable) */
	await uci.load('alphawrt');
	syncClock();
	if (uci.get('alphawrt', 'setup', 'done') == '0' && !sessionStorage.getItem('alphawrt-setup-offered')) {
		sessionStorage.setItem('alphawrt-setup-offered', '1');
		if (location.hash != '#/setup') return location.hash = '#/setup';   // the hashchange draws it
	}
	show();
}

addEventListener('hashchange', () => loggedIn() && show());
if (loggedIn())
	start().catch(fail);
else
	app.replaceChildren(loginView());
