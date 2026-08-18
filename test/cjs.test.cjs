const assert = require('node:assert/strict');
const { test } = require('node:test');

const icc = require('../dist/index.cjs');

test('the CommonJS build exposes the same surface', async () => {
	const bus = icc.createIcc();

	assert.equal(typeof icc.Icc, 'function');
	assert.equal(typeof icc.createIcc, 'function');
	assert.ok(icc.icc instanceof icc.Icc);
	assert.equal(icc.default, icc.icc);

	bus.handle('ping', () => 'pong');
	assert.equal(await bus.invoke('ping'), 'pong');
});
