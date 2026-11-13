#!/usr/bin/env node
// Listens on the ANT+ USB stick for 30 s and prints heart rate, footpod cadence and running power
// (Stryd) as they arrive,
// e.g. to check that a Garmin watch with "Broadcast Heart Rate" on is heard. Stop Zwifit first:
// only one program can use the stick at a time.
//   node scripts/find-ant-sensors.js [seconds]
const { AntSensors } = require('../src/adapters/sensors/ant');

const seconds = Number(process.argv[2]) || 30;
const sensors = new AntSensors();
let heard = 0;
const LABELS = { hr: ['heart rate', 'bpm'], cadence: ['cadence   ', 'spm'], power: ['power     ', 'W'] };

sensors.on('status', status => {
	console.log(status.available ? 'ANT+ stick open. Listening…' : `ANT+: ${status.reason}`);
});
sensors.on('reading', ({ kind, value, deviceId }) => {
	heard++;
	const [name, unit] = LABELS[kind];
	console.log(`${new Date().toISOString().slice(11, 19)}  ${name} ${String(value).padStart(3)} ${unit}  (device ${deviceId})`);
});

sensors.start().then(() => setTimeout(async () => {
	await sensors.stop();
	console.log(heard ? `Done: ${heard} readings.` : 'Nothing heard. Is the watch broadcasting heart rate (or the Stryd awake), and within a few metres?');
	process.exit(0);
}, seconds * 1000));
