import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SocketService } from './socket.service';
import * as units from './units';

export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'zwifit.theme';
const MAX_HR_KEY = 'zwifit.maxHr';
// The units Zwifit last told this browser, used until its settings arrive (so a page that is
// still connecting doesn't flash miles at a metric user).
const METRIC_KEY = 'zwifit.metric';
export const DEFAULT_MAX_HR = 190;

// Heart-rate zones as shares of the maximum: Z1 below 60 %, Z2 60–70, Z3 70–80, Z4 80–90, Z5 from 90.
export const ZONE_FLOORS = [0, 0.6, 0.7, 0.8, 0.9];

export function zoneOf(bpm: number, maxHr: number): number {
	let zone = 1;
	ZONE_FLOORS.forEach((floor, i) => {
		if (bpm >= floor * maxHr) {
			zone = i + 1;
		}
	});
	return zone;
}

// Seconds in each zone (index 0 = Z1). A sample's heart rate counts until the next sample; gaps
// longer than maxGapS (a pause, a dropped sensor) count only maxGapS.
export function timeInZones(points: { t: number; bpm: number | null | undefined }[], maxHr: number, maxGapS = 5): number[] {
	const seconds = [0, 0, 0, 0, 0];
	for (let i = 0; i < points.length - 1; i++) {
		const bpm = points[i].bpm;
		if (bpm && bpm > 0) {
			seconds[zoneOf(bpm, maxHr) - 1] += Math.max(0, Math.min(maxGapS, (points[i + 1].t - points[i].t) / 1000));
		}
	}
	return seconds;
}

// Gradient stops that colour a heart-rate line by zone: on a chart whose top edge is `top` bpm and
// bottom edge `bottom` bpm, each zone's colour runs between that zone's limits (offsets 0..1 from
// the top). Used with a userSpaceOnUse gradient spanning the chart's height.
export function zoneStops(maxHr: number, top: number, bottom: number): { offset: number; zone: number }[] {
	const span = top - bottom || 1;
	const at = (bpm: number) => Math.min(1, Math.max(0, (top - bpm) / span));
	const stops: { offset: number; zone: number }[] = [];
	for (let zone = 5; zone >= 1; zone--) {
		const upper = zone === 5 ? Infinity : ZONE_FLOORS[zone] * maxHr;
		const lower = zone === 1 ? -Infinity : ZONE_FLOORS[zone - 1] * maxHr;
		const from = at(upper);
		const to = at(lower);
		if (to > from) {
			stops.push({ offset: from, zone }, { offset: to, zone });
		}
	}
	return stops;
}

// Display units, threshold power and weight come from the server settings; the theme and maximum
// heart rate are per-browser choices.
@Injectable({ providedIn: 'root' })
export class PrefsService {
	private readonly socket = inject(SocketService);
	private readonly lastMetric = this.read(METRIC_KEY);
	readonly metric = computed(() => this.socket.settings()?.metric ?? (this.lastMetric === null ? false : this.lastMetric === '1'));
	readonly speedLabel = computed(() => units.speedLabel(this.metric()));
	readonly distanceLabel = computed(() => units.distanceLabel(this.metric()));
	readonly paceLabel = computed(() => units.paceUnit(this.metric()));
	readonly theme = signal<Theme>(this.readTheme());
	readonly maxHr = signal<number>(this.readNumber(MAX_HR_KEY, 120, 230) ?? DEFAULT_MAX_HR);
	// Running power threshold (e.g. Stryd's critical power) in watts, and body weight in kg; null when not set.
	readonly thresholdPower = computed(() => this.socket.settings()?.sensors?.thresholdPower ?? null);
	readonly weightKg = computed(() => this.socket.settings()?.sensors?.weightKg ?? null);

	constructor() {
		this.applyTheme(this.theme());
		effect(() => {
			const metric = this.socket.settings()?.metric;
			if (metric !== undefined) {
				this.write(METRIC_KEY, metric ? '1' : '0');
			}
		});
	}

	setMaxHr(bpm: number): void {
		const value = Math.round(Math.min(230, Math.max(120, Number(bpm) || DEFAULT_MAX_HR)));
		this.maxHr.set(value);
		this.write(MAX_HR_KEY, String(value));
	}

	private readNumber(key: string, min: number, max: number): number | null {
		const n = Number(this.read(key));
		return this.read(key) && Number.isFinite(n) && n >= min && n <= max ? n : null;
	}

	private write(key: string, value: string): void {
		try {
			localStorage.setItem(key, value);
		}
		catch {
			// storage unavailable: the choice lasts for this visit
		}
	}

	speed(kph: number | null | undefined): string {
		return units.formatSpeed(kph, this.metric());
	}

	pace(kph: number | null | undefined): string {
		return units.formatPace(kph, this.metric());
	}

	distance(metres: number | null | undefined, places = 2): string {
		return units.formatDistance(metres, this.metric(), places);
	}

	duration(seconds: number | null | undefined): string {
		return units.formatDuration(seconds);
	}

	// Height climbed: metres, or feet in imperial.
	readonly heightLabel = computed(() => (this.metric() ? 'm' : 'ft'));

	height(metres: number | null | undefined): string {
		if (metres === null || metres === undefined || !Number.isFinite(metres)) {
			return '–';
		}
		return String(Math.round(this.metric() ? metres : metres * 3.28084));
	}

	setTheme(theme: Theme): void {
		this.theme.set(theme);
		this.applyTheme(theme);
		try {
			localStorage.setItem(THEME_KEY, theme);
		}
		catch {
			// storage unavailable (private mode): the choice lasts for this visit
		}
	}

	private read(key: string): string | null {
		try {
			return localStorage.getItem(key);
		}
		catch {
			return null;
		}
	}

	private readTheme(): Theme {
		// The design is dark; light and "follow the system" are choices in Settings.
		const saved = this.read(THEME_KEY);
		return saved === 'light' || saved === 'system' ? saved : 'dark';
	}

	private applyTheme(theme: Theme): void {
		if (theme === 'system') {
			document.documentElement.removeAttribute('data-theme');
		}
		else {
			document.documentElement.setAttribute('data-theme', theme);
		}
	}
}
