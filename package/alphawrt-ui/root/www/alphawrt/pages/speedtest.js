/*
 * Speed test: download, upload, ping and jitter measured from the box itself
 * against Speedtest.net (Ookla) servers (alphawrt-speedtest). Testing from
 * the box leaves Wi-Fi and the user's device out of the result.
 */
import { h, icon, badge, card, choice, toast } from '../lib/ui.js';
import { call, maybe, uci } from '../lib/rpc.js';

const PHASE = { select: 'Finding the closest server…', ping: 'Measuring ping…', download: 'Measuring download…', upload: 'Measuring upload…' };
const fmt = (v, d = 0) => v == null || v < 0 ? '–' : v >= 100 ? Math.round(v) : v.toFixed(d);

export default {
	title: 'Speed test',

	async render(main) {
		await uci.load('alphawrt');
		const bridge = uci.get('alphawrt', 'setup', 'mode') == 'bridge';
		const body = h('div');
		main.append(h('h1', { class: 'text-2xl font-bold' }, 'Speed test'),
			h('p', { class: 'text-sm opacity-70' }, 'Tests your internet line from this box against Speedtest.net servers, so Wi-Fi and your device don’t slow the result.'),
			bridge ? h('div', { role: 'status', class: 'alert alert-soft alert-info items-start' }, icon('info', 'size-6 shrink-0'),
				h('div', { class: 'text-sm' }, 'In bridge mode your router has the internet connection, not this box. Run the test on your router, or from a computer.')) : '',
			body);

		const server = choice('Server', [ [ '', 'Closest (automatic)' ] ], '');
		maybe('alphawrt-speedtest', 'servers', {}, {}).then(r => {
			for (const s of r.servers || [])
				server.input.append(h('option', { value: s.host }, `${s.sponsor} · ${s.name}${s.distance != null ? ` (${s.distance} km)` : ''}`));
		});

		let st = await maybe('alphawrt-speedtest', 'status', {}, { state: 'idle' });
		const draw = () => body.replaceChildren(this.view(st, server, start, stop));
		const poll = async () => {
			st = await maybe('alphawrt-speedtest', 'status', {}, st);
			if (!main.isConnected) return;
			draw();
			if (st.running) setTimeout(poll, 500);
		};
		const start = async () => {
			const r = await call('alphawrt-speedtest', 'start', server.input.value ? { host: server.input.value } : {}).catch(e => ({ error: e.message }));
			if (r.error) return toast('bad', r.error);
			st = { state: 'select', running: true };
			draw();
			setTimeout(poll, 500);
		};
		const stop = () => call('alphawrt-speedtest', 'stop').catch(() => {});
		draw();
		if (st.running) poll();
	},

	view(st, server, start, stop) {
		const run = !!st.running, phase = run ? st.state : null;
		const b = run ? badge('off', 'Running') : st.state == 'done' ? badge('ok', 'Done') : st.state == 'error' ? badge('bad', 'Failed') : null;
		const cell = (key, label, value, unit) => h('div', { class: `rounded-box bg-base-200 p-4 ${phase == key ? 'text-primary' : ''}` },
			h('div', { class: 'text-sm opacity-70' }, label),
			h('div', { class: 'text-3xl font-bold tabular-nums' }, value),
			h('div', { class: 'text-xs opacity-70' }, unit));
		const when = st.time && !run && st.state == 'done' ? ` · ${new Date(st.time * 1000).toLocaleString()}` : '';
		return card('speed', 'Internet speed', b, h('div', { class: 'space-y-4' },
			h('div', { class: 'grid grid-cols-2 gap-3 lg:grid-cols-4' },
				cell('download', 'Download', fmt(st.download, 1), 'Mbps'),
				cell('upload', 'Upload', fmt(st.upload, 1), 'Mbps'),
				cell('ping', 'Ping', fmt(st.ping, 1), 'ms'),
				cell('ping', 'Jitter', fmt(st.jitter, 1), 'ms')),
			run && h('div', { class: 'space-y-1' },
				h('div', { class: 'text-sm' }, PHASE[phase] || 'Starting…'),
				h('progress', { class: 'progress progress-primary w-full', value: Math.round((st.progress || 0) * 100), max: 100 })),
			st.state == 'error' && !run && h('p', { class: 'text-sm text-error' }, st.error || 'The test failed.'),
			st.server && h('p', { class: 'text-sm opacity-70' }, `Server: ${st.sponsor ? `${st.sponsor}, ${st.name}` : st.server}${when}`),
			!run && server,
			h('div', { class: 'card-actions justify-end' }, run
				? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: stop }, 'Stop')
				: h('button', { type: 'button', class: 'btn btn-primary', onclick: start }, st.state == 'idle' ? 'Start test' : 'Test again'))));
	}
};
