// Checks shared by the ANT+ and Bluetooth sensors: readings outside these are noise.
const KINDS = ['hr', 'cadence', 'power'];
const MAX_VALUE = { hr: 250, cadence: 250, power: 2500 };

const validReading = (kind, value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_VALUE[kind];

module.exports = { KINDS, MAX_VALUE, validReading };
