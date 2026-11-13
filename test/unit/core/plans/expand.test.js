const fs = require('fs');
const path = require('path');
const { expand, expandedCount } = require('../../../../src/core/plans/expand');

const intervals = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fixtures', 'plans', 'intervals-6x.json'), 'utf8'));

test('a ×6 block of two steps expands to 12 steps with repetition numbers', () => {
	const flat = expand(intervals);
	expect(flat).toHaveLength(14);
	expect(expandedCount(intervals)).toBe(14);
	const block = flat.slice(1, 13);
	expect(block.map(s => s.step.id)).toEqual(Array.from({ length: 6 }, () => ['fast', 'recover']).flat());
	expect(block.map(s => s.repetition)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
	expect(block.every(s => s.repeatOf === 6 && s.itemIndex === 1)).toBe(true);
	expect(flat.map(s => s.flatIndex)).toEqual([...Array(14).keys()]);
	expect(flat[0]).toMatchObject({ itemIndex: 0, stepIndex: null, repetition: 1, repeatOf: 1 });
	expect(flat[13].step.id).toBe('cooldown');
});
