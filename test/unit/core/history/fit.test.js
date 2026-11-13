// The FIT file is checked with Garmin's own decoder (@garmin/fitsdk, an ES module, so it runs in a
// child process): integrity (header + file CRC) and the decoded records, laps, session, activity.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { toFit, fitFileName, crc16 } = require('../../../../src/core/history/fit');

const startedAt = '2026-11-01T06:00:00.000Z';
const at = s => new Date(Date.parse(startedAt) + s * 1000).toISOString();

// 2 steps: 60 s at 6 km/h, then 30 s at 9 km/h with cadence and power (240 W, 260 W at the end);
// heart rate drops out for 5 s.
function sampleWorkout() {
	const samples = [];
	let metres = 0;
	for (let s = 0; s <= 90; s++) {
		const flatIndex = s < 60 ? 0 : 1;
		const kph = flatIndex === 0 ? 6 : 9;
		if (s > 0) {
			metres += kph / 3.6;
		}
		samples.push({
			t: at(s), kph, incline: flatIndex === 0 ? 1 : 2.5, metres: Math.round(metres * 10) / 10,
			hr: s >= 20 && s < 25 ? null : 100 + flatIndex * 30, flatIndex,
			...(flatIndex === 1 ? { cadence: 160, power: s === 90 ? 260 : 240 } : {})
		});
	}
	return { workout: { id: 'W', planName: 'Demo / Run #1', startedAt, endedAt: at(90) }, samples };
}

function decode(buffer) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zwifit-fit-'));
	const file = path.join(dir, 'w.fit');
	fs.writeFileSync(file, buffer);
	const sdk = require.resolve('@garmin/fitsdk').replace(/\\/g, '/');
	const script = `
		import { Decoder, Stream } from 'file:///${sdk.replace(/^\//, '')}';
		import fs from 'fs';
		const decoder = new Decoder(Stream.fromBuffer(fs.readFileSync(process.argv[1])));
		const ok = { isFIT: decoder.isFIT(), integrity: decoder.checkIntegrity() };
		const { messages, errors } = decoder.read();
		console.log(JSON.stringify({ ...ok, errors: errors.map(e => e.message), messages }));
	`;
	try {
		return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, file], { encoding: 'utf8' }));
	}
	finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test('Garmin\'s decoder reads it as a valid treadmill run with records, laps per step, a session and an activity', () => {
	const { workout, samples } = sampleWorkout();
	const out = decode(toFit(workout, samples));
	expect(out).toMatchObject({ isFIT: true, integrity: true, errors: [] });
	const m = out.messages;

	expect(m.fileIdMesgs[0]).toMatchObject({ type: 'activity', manufacturer: 'development' });
	expect(m.recordMesgs).toHaveLength(91);
	expect(m.recordMesgs[0].timestamp).toBe(startedAt);
	expect(m.recordMesgs[10]).toMatchObject({ heartRate: 100, grade: 1 });
	expect(m.recordMesgs[10].speed).toBeCloseTo(6 / 3.6, 3);
	expect(m.recordMesgs[22].heartRate).toBeUndefined();
	// 160 steps/min is stored as 80 strides/min, which apps show as 160 spm.
	expect(m.recordMesgs[80].cadence).toBe(80);
	expect(m.recordMesgs[80].power).toBe(240);
	expect(m.recordMesgs[10].power).toBeUndefined();

	expect(m.lapMesgs).toHaveLength(2);
	expect(m.lapMesgs[0]).toMatchObject({ totalElapsedTime: 60, avgHeartRate: 100, maxHeartRate: 100, sport: 'running', subSport: 'treadmill' });
	// A lap ends where the next step's first sample is, as in the History steps table.
	expect(m.lapMesgs[0].totalDistance).toBeCloseTo(samples[60].metres, 1);
	expect(m.lapMesgs[1]).toMatchObject({ totalElapsedTime: 30, avgHeartRate: 130, avgCadence: 80, maxPower: 260 });
	expect(m.lapMesgs[1].avgPower).toBeGreaterThanOrEqual(240);
	expect(m.lapMesgs[0].avgPower).toBeUndefined();

	const session = m.sessionMesgs[0];
	expect(session).toMatchObject({ sport: 'running', subSport: 'treadmill', totalElapsedTime: 90, numLaps: 2, maxHeartRate: 130, maxPower: 260 });
	expect(session.avgPower).toBeGreaterThanOrEqual(240);
	expect(session.totalDistance).toBeCloseTo(samples[90].metres, 0);
	expect(session.maxSpeed).toBeCloseTo(2.5, 3);
	expect(m.activityMesgs[0]).toMatchObject({ numSessions: 1, totalTimerTime: 90 });
});

test('a workout without heart rate, cadence or power still decodes cleanly', () => {
	const { workout, samples } = sampleWorkout();
	const bare = samples.map(({ hr, cadence, power, ...rest }) => ({ ...rest, hr: null }));
	const out = decode(toFit(workout, bare));
	expect(out).toMatchObject({ isFIT: true, integrity: true, errors: [] });
	expect(out.messages.sessionMesgs[0].avgHeartRate).toBeUndefined();
	expect(out.messages.recordMesgs.every(r => r.heartRate === undefined && r.cadence === undefined && r.power === undefined)).toBe(true);
});

test('the CRC matches the FIT SDK check value and the file name is safe', () => {
	// FIT SDK: CRC of the ASCII digits "123456789" is 0xBB3D.
	expect(crc16(Buffer.from('123456789'))).toBe(0xbb3d);
	expect(fitFileName({ startedAt, planName: 'Demo / Run #1' })).toBe('zwifit-2026-11-01-Demo-Run-1.fit');
});
