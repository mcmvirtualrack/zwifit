// Which page each ANT+ profile sends next (contracts/ant-pages.md "Order"). Pure: takes the
// schedule state and the current values, returns the page bytes and the next state.
const pages = require('./pages');

// Positions within every 64 messages that carry the common pages 80 and 81 (twice each).
const COMMON = { 30: pages.commonPage80, 31: pages.commonPage80, 62: pages.commonPage81, 63: pages.commonPage81 };
// Heart rate: background pages in the last 4 of every 64, page 2 and page 3 in turn.
const HR_BACKGROUND_FROM = 60;
const FE_CYCLE = [pages.fePage16, pages.fePage17, pages.fePage16, pages.fePage19];

const createSchedule = () => ({ n: 0 });

const DATA = {
	footpod: (n, v) => (n % 2 === 1 && typeof v.cadence === 'number' ? pages.sdmPage2(v) : pages.sdmPage1(v)),
	power: (n, v) => pages.powerPage16({ events: v.events, accumulated: v.accumulatedPower, power: v.power }),
	treadmill: (n, v) => FE_CYCLE[n % 4](v)
};

function hrPage(n, v) {
	const slot = n % 64;
	const page = slot >= HR_BACKGROUND_FROM ? (Math.floor(n / 64) % 2 ? 3 : 2) : 4;
	return pages.hrmPage({ ...v, page, toggle: Math.floor(n / 4) % 2 === 1 });
}

function nextPage(kind, state, values) {
	const n = state.n;
	let page;
	if (kind === 'hr') {
		page = hrPage(n, values);
	}
	else if (DATA[kind]) {
		page = COMMON[n % 64] ? COMMON[n % 64]() : DATA[kind](n, values);
	}
	else {
		throw new Error(`Unknown ANT+ broadcast kind: ${kind}`);
	}
	// Wraps at a multiple of 128 so the 64-message cycles and the HR background alternation carry on.
	return { page, state: { n: (n + 1) % (64 * 1024) } };
}

module.exports = { nextPage, createSchedule };
