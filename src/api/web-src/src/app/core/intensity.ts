// Workout intensity (playback.intensity, 50–120 %): every step's target speed times this share,
// rounded to 0.1 km/h and kept within the treadmill limits, as the server sends it.
export const INTENSITY_MIN = 50;
export const INTENSITY_MAX = 120;
export const INTENSITY_STEP = 5;

export function atIntensity(kph: number, percent: number | undefined, limits?: { minKph: number; maxKph: number }): number {
	if (!percent || percent === 100) {
		return kph;
	}
	const scaled = Math.round((kph * percent) / 10) / 10;
	return limits ? Math.min(limits.maxKph, Math.max(limits.minKph, scaled)) : scaled;
}
