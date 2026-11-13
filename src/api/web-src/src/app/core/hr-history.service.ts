import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SocketService } from './socket.service';

export interface HrSample {
	t: number;
	// null while nothing reports a pulse, so a trace shows a gap instead of a drop to 0.
	bpm: number | null;
	// Running power in watts (Stryd), when reported.
	w?: number | null;
	// Belt speed in km/h (0 when stopped or not connected), cadence in steps per minute, incline in %.
	kph?: number | null;
	c?: number | null;
	inc?: number | null;
}

// How far back the background traces look.
export const HR_WINDOW_MS = 10 * 60 * 1000;
// How long samples are kept: long enough to chart a whole workout.
export const KEEP_MS = 3 * 60 * 60 * 1000;
const SAMPLE_EVERY_MS = 1000;
const SAVE_EVERY_MS = 10 * 1000;

const STORAGE_KEY = 'zwifit.hrHistory';

const positive = (n: number | null | undefined, places = 0) => {
	const f = 10 ** places;
	return typeof n === 'number' && n > 0 ? Math.round(n * f) / f : null;
};

// The live readings of the last few hours, sampled once a second from the status: heart rate,
// power, speed, cadence and incline. Kept in this browser tab only (session storage survives a
// reload); workouts store their own samples in History.
@Injectable({ providedIn: 'root' })
export class HrHistoryService {
	private readonly socket = inject(SocketService);
	private readonly buffer = signal<HrSample[]>(restore());
	private savedAt = 0;
	readonly samples = this.buffer.asReadonly();
	readonly latest = computed(() => {
		const list = this.buffer();
		return list.length ? list[list.length - 1].bpm : null;
	});

	constructor() {
		effect(() => {
			const status = this.socket.status();
			// Recorded whether or not the treadmill is connected or a run is going: a strap or watch
			// gives heart rate on its own, and the traces show it.
			if (status) {
				const t = status.treadmill;
				this.add(Date.now(), t.hr ?? null, t.power ?? null, {
					kph: t.connected ? t.kph : 0,
					c: t.cadence ?? null,
					inc: t.connected ? t.incline : null
				});
			}
		});
	}

	add(t: number, bpm: number | null, watts: number | null = null, more: { kph?: number | null; c?: number | null; inc?: number | null } = {}): void {
		const list = this.buffer();
		const last = list[list.length - 1];
		const sample: HrSample = {
			t,
			bpm: positive(bpm),
			w: positive(watts),
			kph: typeof more.kph === 'number' ? Math.max(0, Math.round(more.kph * 100) / 100) : null,
			c: positive(more.c),
			inc: typeof more.inc === 'number' ? Math.round(more.inc * 10) / 10 : null
		};
		const changedKind = last && (['bpm', 'w', 'c'] as const).some(k => (last[k] == null) !== (sample[k] == null));
		if (last && t - last.t < SAMPLE_EVERY_MS && !changedKind) {
			return;
		}
		const next = [...list.filter(s => t - s.t <= KEEP_MS), sample];
		this.buffer.set(next);
		if (t - this.savedAt >= SAVE_EVERY_MS) {
			this.savedAt = t;
			try {
				sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			}
			catch {
				// storage unavailable or full: the history lasts until the page reloads
			}
		}
	}
}

const optionalNumber = (v: unknown) => v == null || typeof v === 'number';

function restore(): HrSample[] {
	try {
		const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
		const now = Date.now();
		return Array.isArray(saved)
			? saved.filter(s => s && typeof s.t === 'number' && now - s.t <= KEEP_MS && optionalNumber(s.bpm) && optionalNumber(s.w)
				&& optionalNumber(s.kph) && optionalNumber(s.c) && optionalNumber(s.inc)).map(s => ({ ...s, bpm: s.bpm ?? null }))
			: [];
	}
	catch {
		return [];
	}
}
