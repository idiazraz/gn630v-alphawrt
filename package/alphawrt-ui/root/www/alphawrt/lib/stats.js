/*
 * CPU and memory, shared by Home and System: per-core CPU from two samples
 * of alphawrt.cpu ([busy, total] jiffies, index 0 = all cores; the same call
 * as Advanced's Status page), memory, load and uptime from system.info.
 * usage(head) returns { el, tick }; the page calls tick() on its 5 s refresh.
 */
import { h, rows, fmtTime } from './ui.js';
import { maybe } from './rpc.js';

const bar = (label, v) => h('div', { class: 'flex items-center gap-3' },
	h('span', { class: 'w-20 text-sm opacity-70' }, label),
	h('progress', { class: 'progress progress-primary flex-1', value: v ?? 0, max: 100 }),
	h('span', { class: 'w-12 text-right text-sm tabular-nums' }, v == null ? '…' : `${v}%`));

/* head: rows shown before the usage rows; uptime: false when the page shows it elsewhere */
export function usage(head = [], { uptime = true } = {}) {
	const el = h('div');
	let prev = null;
	const tick = async () => {
		const [ info, cpu ] = await Promise.all([ maybe('system', 'info'), maybe('alphawrt', 'cpu').then(r => r.cpu || []) ]);
		const pct = prev && cpu.length == prev.length ? cpu.map(([ b, t ], i) => Math.max(0, Math.min(100, Math.round((b - prev[i][0]) / ((t - prev[i][1]) || 1) * 100)))) : null;
		prev = cpu;
		const mem = info.memory, used = mem && mem.total - (mem.available ?? mem.free);
		el.replaceChildren(h('div', { class: 'space-y-4' },
			cpu.length > 1 && h('div', { class: 'space-y-2' }, cpu.slice(1).map((c, i) => bar(`CPU ${i + 1}`, pct?.[i + 1]))),
			mem && bar('Memory', Math.round(used / mem.total * 100)),
			rows([
				...head,
				mem && [ 'Memory used', `${Math.round(used / 1048576)} of ${Math.round(mem.total / 1048576)} MB` ],
				info.load && [ 'Load (1, 5, 15 min)', info.load.map(l => (l / 65536).toFixed(2)).join(' · ') ],
				uptime && info.uptime && [ 'Up for', fmtTime(info.uptime) ]
			])));
	};
	return { el, tick };
}
