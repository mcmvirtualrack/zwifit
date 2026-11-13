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
