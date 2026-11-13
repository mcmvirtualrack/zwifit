// Workout → Garmin FIT activity file (FIT protocol 2.0), for upload to Garmin Connect, Strava and
// others. A treadmill run: one record per sample (distance, speed, heart rate, cadence, power, incline
// as grade), one lap per plan step, one session, one activity. No dependencies; the encoding
// follows the FIT SDK ("FIT File Structure", "Profile.xlsx").
const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z in Unix seconds
const PROFILE_VERSION = 2132;
const PROTOCOL_VERSION = 0x20;

// Base types: [id, size, invalid value]
const ENUM = [0x00, 1, 0xff];
const UINT8 = [0x02, 1, 0xff];
const SINT16 = [0x83, 2, 0x7fff];
const UINT16 = [0x84, 2, 0xffff];
const UINT32 = [0x86, 4, 0xffffffff];
const UINT32Z = [0x8c, 4, 0];

const SPORT_RUNNING = 1;
const SUB_SPORT_TREADMILL = 1;
const MANUFACTURER_DEVELOPMENT = 255;

// Global message numbers and their fields: name → [field number, base type].
const MESSAGES = {
	fileId: [0, { type: [0, ENUM], manufacturer: [1, UINT16], product: [2, UINT16], serialNumber: [3, UINT32Z], timeCreated: [4, UINT32] }],
	event: [21, { timestamp: [253, UINT32], event: [0, ENUM], eventType: [1, ENUM] }],
	record: [20, { timestamp: [253, UINT32], heartRate: [3, UINT8], cadence: [4, UINT8], distance: [5, UINT32], speed: [6, UINT16], power: [7, UINT16], grade: [9, SINT16] }],
	lap: [19, {
		timestamp: [253, UINT32], messageIndex: [254, UINT16], event: [0, ENUM], eventType: [1, ENUM], startTime: [2, UINT32],
		totalElapsedTime: [7, UINT32], totalTimerTime: [8, UINT32], totalDistance: [9, UINT32], avgSpeed: [13, UINT16],
		avgHeartRate: [15, UINT8], maxHeartRate: [16, UINT8], avgCadence: [17, UINT8], avgPower: [19, UINT16], maxPower: [20, UINT16], lapTrigger: [24, ENUM], sport: [25, ENUM], subSport: [39, ENUM]
	}],
	session: [18, {
		timestamp: [253, UINT32], messageIndex: [254, UINT16], event: [0, ENUM], eventType: [1, ENUM], startTime: [2, UINT32],
		sport: [5, ENUM], subSport: [6, ENUM], totalElapsedTime: [7, UINT32], totalTimerTime: [8, UINT32], totalDistance: [9, UINT32],
		avgSpeed: [14, UINT16], maxSpeed: [15, UINT16], avgHeartRate: [16, UINT8], maxHeartRate: [17, UINT8], avgCadence: [18, UINT8], avgPower: [20, UINT16], maxPower: [21, UINT16],
		firstLapIndex: [25, UINT16], numLaps: [26, UINT16], trigger: [28, ENUM]
	}],
	activity: [34, { timestamp: [253, UINT32], totalTimerTime: [0, UINT32], numSessions: [1, UINT16], type: [2, ENUM], event: [3, ENUM], eventType: [4, ENUM], localTimestamp: [5, UINT32] }]
};

const EVENT = { timer: 0, session: 8, lap: 9, activity: 26 };
const EVENT_TYPE = { start: 0, stop: 1, stopAll: 4 };

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

function crc16(bytes, crc = 0) {
	for (const byte of bytes) {
		let tmp = CRC_TABLE[crc & 0xf];
		crc = (crc >> 4) & 0x0fff;
		crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
		tmp = CRC_TABLE[crc & 0xf];
		crc = (crc >> 4) & 0x0fff;
		crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
	}
	return crc;
}

const fitTime = iso => Math.max(0, Math.round(Date.parse(iso) / 1000) - FIT_EPOCH_S);

// Writes messages, defining each message type once (one local type per global message).
function createWriter() {
	const chunks = [];
	const locals = new Map();

	function write(name, values) {
		const [globalNumber, fields] = MESSAGES[name];
		const names = Object.keys(fields);
		let local = locals.get(name);
		if (local === undefined) {
			local = locals.size;
			locals.set(name, local);
			const def = Buffer.alloc(6 + names.length * 3);
			def.writeUInt8(0x40 | local, 0);
			def.writeUInt8(0, 1); // reserved
			def.writeUInt8(0, 2); // little endian
			def.writeUInt16LE(globalNumber, 3);
			def.writeUInt8(names.length, 5);
			names.forEach((field, i) => {
				const [number, [type, size]] = fields[field];
				def.writeUInt8(number, 6 + i * 3);
				def.writeUInt8(size, 7 + i * 3);
				def.writeUInt8(type, 8 + i * 3);
			});
			chunks.push(def);
		}
		const size = names.reduce((sum, field) => sum + fields[field][1][1], 1);
		const data = Buffer.alloc(size);
		data.writeUInt8(local, 0);
		let offset = 1;
		for (const field of names) {
			const [, [type, bytes, invalid]] = fields[field];
			const raw = values[field];
			const value = raw === undefined || raw === null || !Number.isFinite(raw) ? invalid : Math.round(raw);
			if (type === SINT16[0]) {
				data.writeInt16LE(Math.max(-0x7fff, Math.min(0x7ffe, value === invalid ? 0x7fff : value)), offset);
			}
			else if (bytes === 1) {
				data.writeUInt8(Math.max(0, Math.min(invalid, value)), offset);
			}
			else if (bytes === 2) {
				data.writeUInt16LE(Math.max(0, Math.min(invalid, value)), offset);
			}
			else {
				data.writeUInt32LE(Math.max(0, Math.min(invalid, value)), offset);
			}
			offset += bytes;
		}
		chunks.push(data);
	}

	function finish() {
		const body = Buffer.concat(chunks);
		const header = Buffer.alloc(14);
		header.writeUInt8(14, 0);
		header.writeUInt8(PROTOCOL_VERSION, 1);
		header.writeUInt16LE(PROFILE_VERSION, 2);
		header.writeUInt32LE(body.length, 4);
		header.write('.FIT', 8, 'ascii');
		header.writeUInt16LE(crc16(header.subarray(0, 12)), 12);
		const file = Buffer.concat([header, body]);
		const crc = Buffer.alloc(2);
		crc.writeUInt16LE(crc16(file));
		return Buffer.concat([file, crc]);
	}

	return { write, finish };
}

const average = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const positive = values => values.filter(v => typeof v === 'number' && v > 0);
const maxOf = values => (values.length ? Math.max(...values) : null);
const mps1000 = kph => (kph === null ? null : (kph / 3.6) * 1000);
// FIT running cadence counts strides (one per two steps); apps show it doubled as steps/min.
const strides = spm => (spm > 0 ? spm / 2 : null);

// Consecutive samples of the same plan step → one lap each.
function lapsFrom(samples) {
	const laps = [];
	for (const sample of samples) {
		const lap = laps[laps.length - 1];
		if (!lap || lap.flatIndex !== sample.flatIndex) {
			laps.push({ flatIndex: sample.flatIndex, samples: [sample] });
		}
		else {
			lap.samples.push(sample);
		}
	}
	return laps.map((lap, i) => {
		const next = laps[i + 1];
		const first = lap.samples[0];
		const end = next ? next.samples[0] : lap.samples[lap.samples.length - 1];
		const previousMetres = i > 0 ? laps[i - 1].samples[laps[i - 1].samples.length - 1].metres : 0;
		const hrs = positive(lap.samples.map(s => s.hr));
		const seconds = Math.max(0, (Date.parse(end.t) - Date.parse(first.t)) / 1000);
		const metres = Math.max(0, end.metres - previousMetres);
		return {
			start: first.t,
			end: end.t,
			seconds,
			metres,
			avgKph: seconds > 0 ? (metres / seconds) * 3.6 : null,
			avgHr: hrs.length ? average(hrs) : null,
			maxHr: hrs.length ? Math.max(...hrs) : null,
			avgCadence: average(positive(lap.samples.map(s => s.cadence))),
			avgPower: average(positive(lap.samples.map(s => s.power))),
			maxPower: maxOf(positive(lap.samples.map(s => s.power)))
		};
	});
}

function toFit(workout, samples) {
	const ordered = [...samples].filter(s => s && typeof s.t === 'string').sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
	const startIso = workout.startedAt;
	const endIso = ordered.length ? ordered[ordered.length - 1].t : (workout.endedAt || startIso);
	const start = fitTime(startIso);
	const end = Math.max(start, fitTime(endIso));
	const elapsedMs = (end - start) * 1000;
	const totalMetres = ordered.length ? ordered[ordered.length - 1].metres : 0;
	const hrs = positive(ordered.map(s => s.hr));
	const cadences = positive(ordered.map(s => s.cadence));
	const powers = positive(ordered.map(s => s.power));
	const speeds = ordered.map(s => s.kph || 0);
	const laps = lapsFrom(ordered);
	const w = createWriter();

	w.write('fileId', { type: 4, manufacturer: MANUFACTURER_DEVELOPMENT, product: 1, serialNumber: 1, timeCreated: start });
	w.write('event', { timestamp: start, event: EVENT.timer, eventType: EVENT_TYPE.start });
	for (const s of ordered) {
		w.write('record', {
			timestamp: fitTime(s.t),
			heartRate: s.hr > 0 ? s.hr : null,
			cadence: strides(s.cadence),
			distance: (s.metres || 0) * 100,
			speed: mps1000(s.kph || 0),
			power: s.power > 0 ? s.power : null,
			grade: (s.incline || 0) * 100
		});
	}
	w.write('event', { timestamp: end, event: EVENT.timer, eventType: EVENT_TYPE.stopAll });
	laps.forEach((lap, i) => {
		const lapStart = fitTime(lap.start);
		const lapEnd = Math.max(lapStart, fitTime(lap.end));
		w.write('lap', {
			timestamp: lapEnd,
			messageIndex: i,
			event: EVENT.lap,
			eventType: EVENT_TYPE.stop,
			startTime: lapStart,
			totalElapsedTime: lap.seconds * 1000,
			totalTimerTime: lap.seconds * 1000,
			totalDistance: lap.metres * 100,
			avgSpeed: mps1000(lap.avgKph),
			avgHeartRate: lap.avgHr,
			maxHeartRate: lap.maxHr,
			avgCadence: strides(lap.avgCadence),
			avgPower: lap.avgPower,
			maxPower: lap.maxPower,
			lapTrigger: 0,
			sport: SPORT_RUNNING,
			subSport: SUB_SPORT_TREADMILL
		});
	});
	w.write('session', {
		timestamp: end,
		messageIndex: 0,
		event: EVENT.session,
		eventType: EVENT_TYPE.stop,
		startTime: start,
		sport: SPORT_RUNNING,
		subSport: SUB_SPORT_TREADMILL,
		totalElapsedTime: elapsedMs,
		totalTimerTime: elapsedMs,
		totalDistance: totalMetres * 100,
		avgSpeed: elapsedMs > 0 ? mps1000((totalMetres / (elapsedMs / 1000)) * 3.6) : null,
		maxSpeed: mps1000(Math.max(0, ...speeds)),
		avgHeartRate: hrs.length ? average(hrs) : null,
		maxHeartRate: hrs.length ? Math.max(...hrs) : null,
		avgCadence: strides(average(cadences)),
		avgPower: average(powers),
		maxPower: maxOf(powers),
		firstLapIndex: 0,
		numLaps: laps.length,
		trigger: 0
	});
	const offsetS = -new Date(startIso).getTimezoneOffset() * 60;
	w.write('activity', {
		timestamp: end,
		totalTimerTime: elapsedMs,
		numSessions: 1,
		type: 0,
		event: EVENT.activity,
		eventType: EVENT_TYPE.stop,
		localTimestamp: end + offsetS
	});
	return w.finish();
}

function fitFileName(workout) {
	const date = workout.startedAt.slice(0, 10);
	const safe = String(workout.planName || 'workout').replace(/[^A-Za-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'workout';
	return `zwifit-${date}-${safe}`.slice(0, 60) + '.fit';
}

module.exports = { toFit, fitFileName, crc16, FIT_EPOCH_S };
