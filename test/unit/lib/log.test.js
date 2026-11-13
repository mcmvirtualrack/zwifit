const log = require('../../../src/lib/log');
const { AppError } = require('../../../src/lib/errors');

let lines;
beforeEach(() => {
	lines = [];
	log.setSink((level, text) => lines.push({ level, text }));
});
afterEach(() => log.setSink(null));

test('redacts sensitive keys at any depth', () => {
	const out = log.redact({
		token: 'abc',
		nested: { code: 'ABCD1234', tokenHash: 'ff', codeHash: 'ee', list: [{ cookie: 'x' }] },
		hr: 150,
		samples: [{ hr: 1 }],
		speed: 10
	});
	expect(out).toEqual({
		token: '[redacted]',
		nested: { code: '[redacted]', tokenHash: '[redacted]', codeHash: '[redacted]', list: [{ cookie: '[redacted]' }] },
		hr: '[redacted]',
		samples: '[redacted]',
		speed: 10
	});
});

test('masks device cookies inside strings', () => {
	expect(log.redact('Cookie: zwifit_device=s3cr3t; other=1')).toBe('Cookie: zwifit_device=[redacted]; other=1');
});

test('does not mutate the input and survives cycles', () => {
	const input = { token: 'x' };
	input.self = input;
	const out = log.redact(input);
	expect(input.token).toBe('x');
	expect(out.token).toBe('[redacted]');
	expect(out.self).toBe('[circular]');
});

test('info/warn/error write redacted lines to the sink', () => {
	log.info('paired', { token: 'abc', deviceName: 'Phone' });
	log.warn('slow', { ms: 5 });
	log.error('bad zwifit_device=zzz');
	expect(lines.map(l => l.level)).toEqual(['info', 'warn', 'error']);
	expect(lines[0].text).toContain('"deviceName":"Phone"');
	expect(lines[0].text).not.toContain('abc');
	expect(lines[2].text).not.toContain('zzz');
});

test('safeError exposes AppError code/message/details only', () => {
	const err = new AppError('OUT_OF_RANGE', 'Speed above maximum', [{ path: 'kph', code: 'ABOVE_MAX_SPEED', message: 'x' }]);
	expect(log.safeError(err)).toEqual({
		code: 'OUT_OF_RANGE',
		message: 'Speed above maximum',
		details: [{ path: 'kph', code: 'ABOVE_MAX_SPEED', message: 'x' }]
	});
});

test('safeError hides unexpected errors, stacks and file paths', () => {
	const err = new Error('ENOENT: no such file, open \'/home/u/.local/share/zwifit/x.json\'');
	const safe = log.safeError(err);
	expect(safe).toEqual({ code: 'INTERNAL', message: 'Something went wrong.' });
	expect(JSON.stringify(safe)).not.toContain('/home');
	expect(safe.stack).toBeUndefined();
});
