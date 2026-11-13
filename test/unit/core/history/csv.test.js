const { toCsv, csvFileName, columns } = require('../../../../src/core/history/csv');

const workout = {
	id: '01HZX3K9V7Q8R2M4N6P0S1T3WA',
	planName: '=HYPERLINK("http://evil","click")',
	startedAt: '2026-11-01T10:00:00.000Z',
	endedAt: '2026-11-01T10:00:03.000Z',
	endReason: 'completed',
	totals: { seconds: 3, metres: 1609.344, avgHr: 130, maxHr: 140 },
	steps: [{
		flatIndex: 0, label: '+fast, "really"', repetition: 1, target: { kph: 9.656064, incline: 1 },
		actual: { avgKph: 9.656064, avgIncline: 1 }, seconds: 3, metres: 1609.344, avgHr: 130, maxHr: 140, overridden: true, skipped: false
	}]
};
const samples = [
	{ t: '2026-11-01T10:00:01.000Z', kph: 9.656064, incline: 1, metres: 500, hr: 120, flatIndex: 0, event: 'step' },
	{ t: '2026-11-01T10:00:02.000Z', kph: 9.656064, incline: -1, metres: 1000, hr: null, flatIndex: 0, estimated: true },
	{ t: '2026-11-01T10:00:03.000Z', kph: 9.656064, incline: 1, metres: 1609.344, hr: 140, flatIndex: 0, event: 'end' }
];

// Splits one CSV row, respecting RFC 4180 quotes.
const cells = line => {
	const out = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"' && line[i + 1] === '"') {
				cell += c;
				i++;
			}
			else if (c === '"') {
				quoted = false;
			}
			else {
				cell += c;
			}
		}
		else if (c === '"') {
			quoted = true;
		}
		else if (c === ',') {
			out.push(cell);
			cell = '';
		}
		else {
			cell += c;
		}
	}
	out.push(cell);
	return out;
};

const parse = text => {
	expect(text.startsWith('﻿')).toBe(true);
	expect(text.includes('\n') && !/[^\r]\n/.test(text)).toBe(true);
	return text.slice(1).trimEnd().split('\r\n');
};

test('UTF-8 BOM, CRLF, one header with every column, rows summary → steps → samples', () => {
	const lines = parse(toCsv(workout, samples, { metric: false }));
	expect(lines[0]).toBe(columns(false).join(','));
	expect(lines).toHaveLength(1 + 1 + 1 + 3);
	expect(lines.slice(1).map(l => cells(l)[0])).toEqual(['summary', 'step', 'sample', 'sample', 'sample']);
});

test('imperial and metric column names and values', () => {
	expect(columns(false)).toEqual(expect.arrayContaining(['speed_mph', 'target_mph', 'distance_mi']));
	expect(columns(true)).toEqual(expect.arrayContaining(['speed_kph', 'target_kph', 'distance_km']));
	const imperial = parse(toCsv(workout, samples, { metric: false }));
	const metric = parse(toCsv(workout, samples, { metric: true }));
	const header = cells(imperial[0]);
	const sampleRow = cells(imperial[3]);
	expect(sampleRow[header.indexOf('speed_mph')]).toBe('6');
	expect(sampleRow[header.indexOf('distance_mi')]).toBe('0.311');
	const metricHeader = cells(metric[0]);
	expect(cells(metric[3])[metricHeader.indexOf('speed_kph')]).toBe('9.66');
});

test('null heart rate is an empty cell; negative incline stays a number', () => {
	const lines = parse(toCsv(workout, samples, { metric: true }));
	const header = cells(lines[0]);
	const row = cells(lines[4]);
	expect(row[header.indexOf('hr_bpm')]).toBe('');
	expect(row[header.indexOf('incline_pct')]).toBe('-1');
	expect(row[header.indexOf('estimated')]).toBe('true');
});

test('text cells that start a formula are prefixed and RFC 4180 quoted', () => {
	const text = toCsv(workout, samples, { metric: true });
	expect(text).toContain('"\'=HYPERLINK(""http://evil"",""click"")"');
	expect(text).toContain('"\'+fast, ""really"""');
	for (const lead of ['-', '@', '\t', '\r']) {
		const out = toCsv({ ...workout, planName: `${lead}x` }, [], { metric: true });
		expect(out).toContain(`'${lead}x`);
	}
});

test('step rows mark overridden/skipped in event', () => {
	const lines = parse(toCsv(workout, samples, { metric: true }));
	const header = cells(lines[0]);
	expect(cells(lines[2])[header.indexOf('event')]).toBe('overridden');
});

test('file name is zwifit-<date>-<safe name>.csv, only [A-Za-z0-9-_], max 60 chars', () => {
	expect(csvFileName({ startedAt: '2026-11-01T10:00:00Z', planName: 'Intervals 6× / hills' })).toBe('zwifit-2026-11-01-Intervals-6-hills.csv');
	const long = csvFileName({ startedAt: '2026-11-01T10:00:00Z', planName: 'x'.repeat(200) });
	expect(long.replace(/\.csv$/, '').length).toBeLessThanOrEqual(60);
	expect(csvFileName({ startedAt: '2026-11-01T10:00:00Z', planName: '=evil()' })).toBe('zwifit-2026-11-01-evil.csv');
});
