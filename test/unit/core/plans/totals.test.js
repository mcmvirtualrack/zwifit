const fs = require('fs');
const path = require('path');
const { totals } = require('../../../../src/core/plans/totals');
const { metresToMiles } = require('../../../../src/core/units');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'plans', name), 'utf8'));

test('quickstart "Intervals 6×" totals exactly 1830 s and 3.1 mi', () => {
	const t = totals(fixture('intervals-6x.json'));
	expect(t.seconds).toBe(1830);
	expect(metresToMiles(t.metres)).toBeCloseTo(3.1, 2);
	expect(t.estimated).toBe(true);
});

test('time steps estimate distance; distance steps estimate time', () => {
	const timeOnly = { items: [{ kind: 'step', targetKph: 12, end: { type: 'time', seconds: 600 } }] };
	expect(totals(timeOnly)).toMatchObject({ seconds: 600, metres: 2000, estimatedMetres: true, estimatedSeconds: false });
	const distanceOnly = { items: [{ kind: 'step', targetKph: 12, end: { type: 'distance', metres: 1000 } }] };
	expect(totals(distanceOnly)).toMatchObject({ seconds: 300, metres: 1000, estimatedMetres: false, estimatedSeconds: true });
});
