// Display and entry helpers (browser port of src/core/units.js). Internally km/h, metres, seconds.
import { Entered, EnteredUnit, EndReason } from './api.types';

export const KM_PER_MILE = 1.609344;

export const kphToMph = (kph: number) => kph / KM_PER_MILE;
export const mphToKph = (mph: number) => mph * KM_PER_MILE;

export function parsePace(value: string): number | null {
	const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
	if (!match) {
		return null;
	}
	const seconds = Number(match[1]) * 60 + Number(match[2]);
	return seconds > 0 ? seconds : null;
}

export function kphToPace(kph: number, unit: 'min/mi' | 'min/km'): string | null {
	if (!Number.isFinite(kph) || kph <= 0) {
		return null;
	}
	const km = unit === 'min/mi' ? KM_PER_MILE : 1;
	const total = Math.round(Math.round(km * 3600 / kph * 1e6) / 1e6);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function enteredToKph(entered: Entered): number | null {
	if (entered.form === 'speed') {
		const value = Number(entered.value);
		if (!Number.isFinite(value) || value <= 0) {
			return null;
		}
		return entered.unit === 'mph' ? mphToKph(value) : value;
	}
	const seconds = parsePace(String(entered.value));
	if (seconds === null) {
		return null;
	}
	return (entered.unit === 'min/mi' ? KM_PER_MILE : 1) * 3600 / seconds;
}

export const speedUnit = (metric: boolean): EnteredUnit => (metric ? 'kph' : 'mph');
export const paceUnit = (metric: boolean): 'min/mi' | 'min/km' => (metric ? 'min/km' : 'min/mi');
export const speedLabel = (metric: boolean) => (metric ? 'km/h' : 'mph');
export const distanceLabel = (metric: boolean) => (metric ? 'km' : 'mi');

export const displaySpeed = (kph: number, metric: boolean) => (metric ? kph : kphToMph(kph));
export const fromDisplaySpeed = (value: number, metric: boolean) => (metric ? value : mphToKph(value));

export function formatSpeed(kph: number | null | undefined, metric: boolean): string {
	if (kph === null || kph === undefined || !Number.isFinite(kph)) {
		return '–';
	}
	return displaySpeed(kph, metric).toFixed(1);
}

export function formatPace(kph: number | null | undefined, metric: boolean): string {
	return (kph && kphToPace(kph, paceUnit(metric))) || '–:––';
}

export const displayDistance = (metres: number, metric: boolean) => (metric ? metres / 1000 : metres / (KM_PER_MILE * 1000));
export const fromDisplayDistance = (value: number, metric: boolean) => (metric ? value * 1000 : value * KM_PER_MILE * 1000);

export function formatDistance(metres: number | null | undefined, metric: boolean, places = 2): string {
	if (metres === null || metres === undefined || !Number.isFinite(metres)) {
		return '–';
	}
	return displayDistance(metres, metric).toFixed(places);
}

// 3725 → "1:02:05", 125 → "2:05"
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
		return '–';
	}
	const total = Math.max(0, Math.round(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// "1:02:05" | "2:05" | "45" → seconds, or null.
export function parseDuration(text: string): number | null {
	const parts = text.trim().split(':');
	if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) {
		return null;
	}
	const numbers = parts.map(Number);
	if (numbers.slice(1).some(n => n > 59)) {
		return null;
	}
	const seconds = numbers.reduce((acc, n) => acc * 60 + n, 0);
	return seconds > 0 ? seconds : null;
}

export const END_REASONS: Record<EndReason, string> = {
	completed: 'Completed',
	userStopped: 'Stopped by you',
	connectionLost: 'Connection lost',
	treadmillStopped: 'Stopped from treadmill',
	appRestart: 'App restarted'
};
