// A readable name for a paired device from its browser's User-Agent, e.g. "iPhone · Safari".
// Same rules as the control page (web-src core/device-name.ts). Empty when nothing matches.
const PLATFORMS = [
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
const BROWSERS = [
	[/Edg(e|A|iOS)?\//, 'Edge'],
	[/OPR\/|Opera/, 'Opera'],
	[/Firefox\/|FxiOS\//, 'Firefox'],
	[/SamsungBrowser\//, 'Samsung Internet'],
	[/Chrome\/|CriOS\//, 'Chrome'],
	[/Safari\//, 'Safari']
];

function deviceNameFrom(userAgent) {
	const ua = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
	const find = list => (list.find(([pattern]) => pattern.test(ua)) || [])[1];
	return [find(PLATFORMS), find(BROWSERS)].filter(Boolean).join(' · ');
}

module.exports = { deviceNameFrom, DEFAULT_DEVICE_NAME: 'Device' };
