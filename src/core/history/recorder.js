// Records a plan playback as a workout (FR-019a–e). Listens to the playback engine's `event` and
// `sample` emissions and writes through the workouts repository: one sample per second, marked
// with step/override/pause/resume/end events. Heart rate 0 is stored as null (FR-019c).
const { summarize, parseSamples } = require('./summarize');

function createRecorder({ repo, newId, now = () => Date.now(), onChanged = () => {}, log = { warn() {} } }) {
	let workout = null;
	let samples = [];
	let pendingEvent = null;
	let last = null;
	let queue = Promise.resolve();

	const enqueue = task => {
		queue = queue.then(task).catch(err => log.warn('Could not record the workout', { message: err.message }));
		return queue;
	};

	function onEvent(event) {
		if (event.type === 'start') {
			const header = {
				id: newId(),
				planId: event.plan.id || null,
				planName: event.plan.name,
				planSnapshot: event.plan,
				startedAt: new Date(now()).toISOString(),
				endedAt: null,
				endReason: null,
				totals: { seconds: 0, metres: 0 },
				steps: []
			};
			workout = header;
			samples = [];
			pendingEvent = 'step';
			last = null;
			enqueue(() => repo.create(header));
			return;
		}
		if (!workout) {
			return;
		}
		if (event.type === 'step' && event.flatIndex > 0) {
			pendingEvent = 'step';
		}
		else if (['override', 'pause', 'resume'].includes(event.type)) {
			pendingEvent = event.type;
		}
		else if (event.type === 'end') {
			const current = workout;
			const endSample = { ...(last || { kph: 0, incline: 0, metres: 0, hr: null, flatIndex: event.flatIndex }), t: new Date(now()).toISOString(), event: 'end' };
			delete endSample.estimated;
			samples.push(endSample);
			const finished = { ...current, endedAt: endSample.t, endReason: event.reason, ...summarize(current, samples) };
			workout = null;
			enqueue(async () => {
				await repo.appendSample(current.id, endSample);
				await repo.finish(finished);
				onChanged(finished.id);
			});
		}
	}

	function onSample(sample) {
		if (!workout) {
			return;
		}
		const entry = { t: sample.t, kph: sample.kph, incline: sample.incline, metres: sample.metres, hr: sample.hr > 0 ? sample.hr : null, flatIndex: sample.flatIndex };
		if (pendingEvent) {
			entry.event = pendingEvent;
			pendingEvent = null;
		}
		if (sample.estimated) {
			entry.estimated = true;
		}
		// Steps per minute, only from treadmills that report it.
		if (sample.cadence > 0) {
			entry.cadence = Math.round(sample.cadence);
		}
		// Watts, only while a power sensor (Stryd) reports.
		if (sample.power > 0) {
			entry.power = Math.round(sample.power);
		}
		last = entry;
		samples.push(entry);
		const id = workout.id;
		enqueue(() => repo.appendSample(id, entry));
	}

	function attach(engine) {
		engine.on('event', onEvent);
		engine.on('sample', onSample);
	}

	return { attach, onEvent, onSample, flush: () => queue, current: () => workout };
}

// Rebuilds a workout left running by a crash: summary from the samples on disk, ended appRestart.
function rebuildFromSamples(header, samplesText) {
	const samples = parseSamples(samplesText);
	const lastSample = samples[samples.length - 1];
	return {
		...header,
		endedAt: header.endedAt || (lastSample ? lastSample.t : header.startedAt),
		endReason: header.endReason || 'appRestart',
		...summarize(header, samples)
	};
}

module.exports = { createRecorder, rebuildFromSamples };
