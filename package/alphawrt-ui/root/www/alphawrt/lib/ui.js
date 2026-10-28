/*
 * Building blocks for the pages: an h() element helper, inline icons, the
 * logo, and the daisyUI pieces every page uses. Class names are written out
 * whole so ui/build.sh keeps them (see ui/input.css).
 */

export function h(tag, attrs, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v == null || v === false) continue;
		if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else if (k == 'style') el.style.cssText = v;
		else el.setAttribute(k, v === true ? '' : v);
	}
	el.append(...kids.flat(Infinity).filter(c => c != null && c !== false).map(c => c.nodeType ? c : String(c)));
	return el;
}

const ICONS = {
	home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
	wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
	devices: 'M3 5h13v9H3zM1 18h17M18 9h4v11h-4z',
	more: 'M5 12h.01M12 12h.01M19 12h.01',
	fibre: 'M3 18C6 18 7 6 12 6s6 12 9 12M20 18h.01',
	globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3.5 3.5 3.5 14.5 0 18M12 3c-3.5 3.5-3.5 14.5 0 18',
	box: 'M3 13h18v6H3zM7 16h.01M11 16h.01M8 13 6 6M16 13l2-7',
	vpn: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
	system: 'M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4',
	wand: 'M4 20 16 8M14 3v3M18 7h3M17 4l2-2',
	external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
	logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
	ok: 'M5 12l5 5 9-10',
	warn: 'M12 3l10 18H2zM12 10v4M12 17h.01',
	bad: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6',
	off: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12h8',
	cable: 'M4 8h16v8H4zM8 16v3M16 16v3M8 12h8',
	chevron: 'M9 6l6 6-6 6',
	eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
	key: 'M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7zM16 10h.01',
	qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM14 14h3v3h-3zM18 18h3v3h-3zM14 18h3v3h-3zM18 14h3v3h-3z',
	trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
	plus: 'M12 5v14M5 12h14',
	copy: 'M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2zM16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2'
};

export function icon(name, cls = 'size-5 shrink-0') {
	const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
	for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', fill: 'none',
		stroke: 'currentColor', 'stroke-width': name == 'more' ? 3 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
		s.setAttribute(k, v);
	p.setAttribute('d', ICONS[name]);
	s.append(p);
	return s;
}

const LOCKUP = '<svg viewBox="0 -5 312 60" role="img" aria-label="AlphaWRT"><g transform="translate(0 -5) scale(0.9375)"><path class="logo-a" d="M51 12C45 30 39 50 24 50 14 50 9 42 9 33 9 22 16 14 27 14 39 14 45 34 52 47" fill="none" stroke-width="10.5" stroke-linecap="round"/><circle class="logo-b" cx="57" cy="55" r="6.5"/></g><g transform="translate(74 0)" fill="none" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"><g class="logo-t"><path d="M3.5 36.75 12.5 3.25 21.5 36.75M7 26H18M31 3.25V36.75M42 13.25V48.75M76 3.25V36.75M76 23C76 16.5 80 13.25 85 13.25 90 13.25 94 16.5 94 22V36.75M128.5 13.25V36.75"/><circle cx="53.75" cy="25" r="11.75"/><circle cx="116.75" cy="25" r="11.75"/></g><path class="logo-a" d="M141 3.25 147.5 36.75 155 12 162.5 36.75 169 3.25M180 36.75V3.25H190C196.5 3.25 200 7 200 12.5 200 18 196.5 21.75 190 21.75H180M191 21.75 201 36.75M209 3.25H233M221 3.25V36.75"/></g></svg>';

export function logo(cls) {
	const t = document.createElement('template');
	t.innerHTML = LOCKUP;
	t.content.firstElementChild.setAttribute('class', cls);
	return t.content.firstElementChild;
}

/* level → [ badge class, alert class, icon ]: colour always comes with a word and an icon */
const LEVEL = {
	ok: [ 'badge-success', 'alert-success', 'ok' ],
	warn: [ 'badge-warning', 'alert-warning', 'warn' ],
	bad: [ 'badge-error', 'alert-error', 'bad' ],
	off: [ 'badge-neutral', 'alert-info', 'off' ]
};

export function badge(level, text) {
	return h('span', { class: `badge badge-soft ${LEVEL[level][0]} gap-1 whitespace-nowrap` }, icon(LEVEL[level][2], 'size-3.5'), text);
}

export function alert(level, title, text, action) {
	return h('div', { role: level == 'bad' ? 'alert' : 'status', class: `alert alert-soft ${LEVEL[level][1]} items-start` },
		icon(LEVEL[level][2], 'size-6 shrink-0'),
		h('div', { class: 'space-y-1' },
			h('div', { class: 'font-bold text-base' }, title),
			text && h('div', { class: 'text-sm' }, text),
			action));
}

/* label / value pairs; falsy rows are skipped */
export function rows(list, cls = '') {
	return h('dl', { class: `grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm ${cls}` }, list.filter(Boolean).map(r => [
		h('dt', { class: 'opacity-70' }, r[0]),
		h('dd', { class: 'text-right break-words font-medium' }, r[1])
	]));
}

export function card(ic, title, status, body, link) {
	return h('section', { class: 'card bg-base-100 border border-base-300' },
		h('div', { class: 'card-body gap-4 p-5' },
			h('div', { class: 'flex items-center gap-2' },
				h('span', { class: 'grid place-items-center size-9 rounded-full bg-base-200 text-primary' }, icon(ic)),
				h('h2', { class: 'card-title text-lg flex-1' }, title),
				status),
			body,
			link && h('div', { class: 'card-actions justify-end mt-auto' },
				h('a', { href: link[1], class: 'btn btn-ghost btn-sm text-primary' }, link[0], icon('chevron', 'size-4')))));
}

export function fmtTime(s) {
	const d = Math.floor(s / 86400), hr = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
	return d ? `${d} d ${hr} h` : hr ? `${hr} h ${m} min` : `${m} min`;
}

export function portName(p) { return p ? p.replace(/^lan(\d+)$/, 'LAN $1') : '?'; }

/* --- forms and dialogs --- */

/* a labelled input; o: { type, value, hint, placeholder, autocomplete, password } */
export function field(label, o = {}) {
	const input = h('input', { type: o.password ? 'password' : o.type || 'text', value: o.value ?? '', placeholder: o.placeholder,
		autocomplete: o.autocomplete || 'off', spellcheck: 'false', class: o.password ? 'grow min-w-0' : 'input w-full',
		maxlength: o.maxlength, required: o.required });
	const ctl = !o.password ? input : h('label', { class: 'input w-full' }, input,
		h('button', { type: 'button', class: 'btn btn-ghost btn-xs btn-square -mr-2', 'aria-label': 'Show or hide password',
			onclick: () => { input.type = input.type == 'password' ? 'text' : 'password'; } }, icon('eye', 'size-4')));
	const el = h('fieldset', { class: 'fieldset' }, h('legend', { class: 'fieldset-legend text-sm' }, label), ctl,
		o.hint && h('p', { class: 'label text-xs whitespace-normal leading-snug' }, o.hint));
	el.input = input;
	return el;
}

export function toggle(label, checked, hint) {
	const input = h('input', { type: 'checkbox', class: 'toggle toggle-primary mt-0.5', checked });
	const el = h('label', { class: 'flex items-start gap-3 py-1 cursor-pointer' }, input,
		h('span', {}, h('span', { class: 'font-medium' }, label), hint && h('span', { class: 'block text-sm opacity-70' }, hint)));
	el.input = input;
	return el;
}

/* modal(title, body, buttons): buttons are [ label, class, value ]; resolves with the value (null on Esc) */
export function modal(title, body, buttons = [ [ 'OK', 'btn-primary', true ] ]) {
	return new Promise(resolve => {
		const dlg = h('dialog', { class: 'modal modal-bottom sm:modal-middle' },
			h('div', { class: 'modal-box' },
				title && h('h3', { class: 'text-lg font-bold mb-3' }, title),
				body,
				buttons.length > 0 && h('div', { class: 'modal-action' }, buttons.map(([ label, cls, value ]) =>
					h('button', { type: 'button', class: `btn ${cls || ''}`, onclick: () => { dlg.close(); resolve(value); } }, label)))));
		dlg.addEventListener('close', () => { dlg.remove(); resolve(null); });
		document.body.append(dlg);
		dlg.showModal();
	});
}

/* a modal with a spinner and no buttons; returns { close, text(msg) } */
export function busy(title, text) {
	const p = h('p', { class: 'text-sm opacity-80' }, text);
	const dlg = h('dialog', { class: 'modal' }, h('div', { class: 'modal-box text-center' },
		h('span', { class: 'loading loading-spinner loading-lg text-primary' }),
		h('h3', { class: 'text-lg font-bold mt-4' }, title), p));
	dlg.addEventListener('cancel', e => e.preventDefault());
	document.body.append(dlg);
	dlg.showModal();
	return { close: () => { dlg.close(); dlg.remove(); }, text: t => { p.textContent = t; } };
}

export function toast(level, text) {
	const cls = { ok: 'alert-success', warn: 'alert-warning', bad: 'alert-error' }[level];
	const el = h('div', { class: 'toast toast-top toast-center z-50' }, h('div', { role: 'status', class: `alert ${cls}` }, icon({ ok: 'ok', warn: 'warn', bad: 'bad' }[level]), text));
	document.body.append(el);
	setTimeout(() => el.remove(), 4000);
}

/* draw the current page again (after a save) */
export const redraw = () => dispatchEvent(new HashChangeEvent('hashchange'));

/* a labelled select; options: [ [ value, label ] ] */
export function choice(label, options, value) {
	const sel = h('select', { class: 'select w-full' }, options.map(([ v, l ]) => h('option', { value: v, selected: v == value }, l)));
	const el = h('fieldset', { class: 'fieldset' }, h('legend', { class: 'fieldset-legend text-sm' }, label), sel);
	el.input = sel;
	return el;
}
