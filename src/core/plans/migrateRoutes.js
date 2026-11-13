// Turns legacy routes.conf routes into training plans. Each route line is
//   "<point in the run>: <change>[, <change>]"    e.g. "2.6 Miles: 6.2 MPH", "0:30:00: 10% Incline"
// meaning "up to this point, run at these settings". Points are cumulative; speed and incline
// carry forward from the line before. Unparseable lines are reported with their line number.
const { mphToKph, milesToMetres, kmToMetres } = require('../units');
const { validatePlan } = require('./validate');

const DISTANCE_UNITS = [
	[/^(mi|miles?)$/i, milesToMetres],
	[/^(km|kilomet(er|re)s?)$/i, kmToMetres],
	[/^(m|met(er|re)s?)$/i, m => m]
];

function parsePoint(text) {
	const time = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(text);
	if (time) {
		return { type: 'time', value: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) };
	}
	const distance = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/.exec(text);
	if (distance) {
		for (const [pattern, toMetres] of DISTANCE_UNITS) {
			if (pattern.test(distance[2])) {
				return { type: 'distance', value: toMetres(Number(distance[1])) };
			}
		}
	}
	return null;
}

// "4 MPH" | "6.5 KPH" | "6.5 km/h" | "2% Incline" | "2 %"
function parseChange(text) {
	const speed = /^(\d+(?:\.\d+)?)\s*(mph|kph|km\/h)$/i.exec(text);
	if (speed) {
		const value = Number(speed[1]);
		return /mph/i.test(speed[2])
			? { kph: mphToKph(value), entered: { form: 'speed', unit: 'mph', value } }
			: { kph: value, entered: { form: 'speed', unit: 'kph', value } };
	}
	const incline = /^(-?\d+(?:\.\d+)?)\s*%(\s*incline)?$/i.exec(text);
	if (incline) {
		return { incline: Math.round(Number(incline[1]) * 2) / 2 };
	}
	return null;
}

function parseLine(line) {
	// A time point has colons of its own ("0:30:00: 10% Incline"), so match the two shapes.
	const match = /^(\d+:[0-5]\d:[0-5]\d)\s*:\s*(.+)$/.exec(line) || /^([^:]+):\s*(.+)$/.exec(line);
	if (!match) {
		return null;
	}
	const point = parsePoint(match[1].trim());
	const changes = match[2].split(',').map(part => parseChange(part.trim()));
	if (!point || !changes.length || changes.some(c => c === null)) {
		return null;
	}
	return { point, changes };
}

const round = (n, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

function migrateRoute(route, { index = 0 } = {}) {
	const problems = [];
	const lines = String(route.steps || '').split(/\r?\n/);
	const parsed = [];
	lines.forEach((raw, i) => {
		const line = raw.trim();
		if (!line) {
			return;
		}
		const result = parseLine(line);
		if (result) {
			parsed.push({ ...result, lineNumber: i + 1 });
		}
		else {
			problems.push({ line: i + 1, text: line.slice(0, 80), message: 'Could not understand this line.' });
		}
	});

	// Speed before the first speed change: the first speed the route mentions.
	const firstSpeed = parsed.flatMap(p => p.changes).find(c => c.kph !== undefined);
	if (!firstSpeed) {
		problems.push({ line: null, text: '', message: 'The route never sets a speed.' });
		return { plan: null, problems };
	}

	let speed = firstSpeed;
	let incline = 0;
	let elapsed = { seconds: 0, metres: 0 };
	const items = [];
	for (const entry of parsed) {
		for (const change of entry.changes) {
			if (change.kph !== undefined) {
				speed = change;
			}
			if (change.incline !== undefined) {
				incline = change.incline;
			}
		}
		const metresPerSecond = speed.kph / 3.6;
		const length = entry.point.type === 'time' ? entry.point.value - elapsed.seconds : entry.point.value - elapsed.metres;
		const minimum = entry.point.type === 'time' ? 1 : 10;
		if (!(length >= minimum)) {
			problems.push({ line: entry.lineNumber, text: lines[entry.lineNumber - 1].trim().slice(0, 80), message: 'This point is not after the previous one.' });
			continue;
		}
		const end = entry.point.type === 'time'
			? { type: 'time', seconds: Math.round(length) }
			: { type: 'distance', metres: round(length, 1) };
		items.push({
			kind: 'step',
			id: `s${items.length + 1}`,
			label: `Line ${entry.lineNumber}`,
			targetKph: round(speed.kph),
			entered: speed.entered,
			targetIncline: incline,
			end
		});
		// Keep both running totals so the next line can use either kind of point.
		if (entry.point.type === 'time') {
			elapsed = { seconds: entry.point.value, metres: elapsed.metres + metresPerSecond * length };
		}
		else {
			elapsed = { seconds: elapsed.seconds + length / metresPerSecond, metres: entry.point.value };
		}
	}

	if (!items.length) {
		return { plan: null, problems };
	}
	const name = String(route.name || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80) || `Imported route ${index + 1}`;
	const plan = {
		schemaVersion: 1,
		name,
		description: 'Imported from the old routes.conf.',
		authoredUnits: firstSpeed.entered.unit === 'mph' ? 'imperial' : 'metric',
		items: items.slice(0, 200)
	};
	const errors = validatePlan(plan);
	if (errors.length) {
		return { plan: null, problems: [...problems, ...errors.map(e => ({ line: null, text: e.path, message: e.message }))] };
	}
	return { plan, problems };
}

// routes.conf contents (already parsed YAML) → { plans, problems: [{ route, line, text, message }] }
function migrateRoutes(routesFile) {
	const list = routesFile && Array.isArray(routesFile.list) ? routesFile.list : [];
	const plans = [];
	const problems = [];
	list.forEach((route, index) => {
		if (!route) {
			return;
		}
		const result = migrateRoute(route, { index });
		const routeName = String(route.name || `#${index + 1}`).slice(0, 80);
		problems.push(...result.problems.map(p => ({ route: routeName, ...p })));
		if (result.plan) {
			plans.push(result.plan);
		}
	});
	return { plans, problems };
}

module.exports = { migrateRoutes, migrateRoute, parseLine };
