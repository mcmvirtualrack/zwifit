// Random 128-bit ids as 26-char Crockford base32 (data-model.md).
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function newId() {
	let n = BigInt('0x' + crypto.randomBytes(16).toString('hex'));
	let out = '';
	for (let i = 0; i < 26; i++) {
		out = ALPHABET[Number(n & 31n)] + out;
		n >>= 5n;
	}
	return out;
}

function isId(value) {
	return typeof value === 'string' && ID_PATTERN.test(value);
}

module.exports = { ALPHABET, ID_PATTERN, newId, isId };
