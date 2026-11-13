// A readable default name for a device being paired, from its browser's user agent, e.g.
// "iPhone · Safari" or "Windows · Edge". The user can change it before pairing.
const PLATFORMS: [RegExp, string][] = [
	[/iPhone/, 'iPhone'],
	[/iPad/, 'iPad'],
	[/Android.*Mobile/, 'Android phone'],
	[/Android/, 'Android tablet'],
	[/CrOS/, 'Chromebook'],
	[/Windows/, 'Windows'],
	[/Macintosh/, 'Mac'],
	[/Linux/, 'Linux']
];

// Order matters: Edge and Opera also say "Chrome"; Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
	[/Edg(e|A|iOS)?\//, 'Edge'],
	[/OPR\/|Opera/, 'Opera'],
	[/Firefox\/|FxiOS\//, 'Firefox'],
	[/SamsungBrowser\//, 'Samsung Internet'],
	[/Chrome\/|CriOS\//, 'Chrome'],
	[/Safari\//, 'Safari']
];

export function deviceNameFrom(userAgent: string): string {
	const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1];
	const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
	return [platform, browser].filter(Boolean).join(' · ').slice(0, 40);
}
