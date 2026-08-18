import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createIcc, Icc, icc as defaultBus } from '../dist/index.mjs';

/** Lets the deferred dispatch of `send` run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('send delivers the payload to every listener, after the current task', async () => {
	const bus = createIcc();
	const seen = [];

	bus.on('greet', (payload) => seen.push('a:' + payload));
	bus.on('greet', (payload) => seen.push('b:' + payload));
	bus.send('greet', 'hi');

	assert.deepEqual(seen, [], 'dispatch must not be synchronous');

	await tick();

	assert.deepEqual(seen, ['a:hi', 'b:hi']);
});

test('sendSync delivers before returning', () => {
	const bus = createIcc();
	let seen = null;

	bus.on('greet', (payload) => { seen = payload; });
	bus.sendSync('greet', 'now');

	assert.equal(seen, 'now');
});

test('once fires a single time and is dropped afterwards', async () => {
	const bus = createIcc();
	let calls = 0;

	bus.once('ping', () => { calls += 1; });

	bus.send('ping');
	bus.send('ping');
	await tick();

	assert.equal(calls, 1);
	assert.equal(bus.listenerCount('ping'), 0);
});

test('the returned disposer removes the right listener even after earlier removals', async () => {
	const bus = createIcc();
	const seen = [];

	const offFirst = bus.on('x', () => seen.push('first'));
	const offSecond = bus.on('x', () => seen.push('second'));
	bus.on('x', () => seen.push('third'));

	offFirst();
	offSecond();

	bus.send('x');
	await tick();

	assert.deepEqual(seen, ['third']);
});

test('unsubscribing from inside a listener takes effect during the same dispatch', () => {
	const bus = createIcc();
	const seen = [];

	bus.on('x', () => {
		seen.push('first');
		offSecond();
	});

	const offSecond = bus.on('x', () => seen.push('second'));
	bus.on('x', () => seen.push('third'));

	bus.sendSync('x');

	assert.deepEqual(seen, ['first', 'third']);
});

test('one AbortController removes every listener registered with it', async () => {
	const bus = createIcc();
	const controller = new AbortController();
	const seen = [];

	bus.on('a', () => seen.push('a'), { signal: controller });
	bus.on('b', () => seen.push('b'), { signal: controller.signal });

	controller.abort();

	bus.send('a');
	bus.send('b');
	await tick();

	assert.deepEqual(seen, []);
	assert.equal(bus.listenerCount(), 0);
});

test('an already aborted signal never registers the listener', () => {
	const bus = createIcc();
	const controller = new AbortController();

	controller.abort();
	const off = bus.on('a', () => {}, { signal: controller });

	assert.equal(bus.listenerCount('a'), 0);
	assert.doesNotThrow(off);
});

test('a throwing listener is reported and does not stop the rest', () => {
	const errors = [];
	const bus = createIcc({ onError: (error, context) => errors.push([error.message, context.channel]) });
	let reached = false;

	bus.on('x', () => { throw new Error('boom'); });
	bus.on('x', () => { reached = true; });

	bus.sendSync('x');

	assert.ok(reached);
	assert.deepEqual(errors, [['boom', 'x']]);
});

test('invoke resolves with the answer of the handler', async () => {
	const bus = createIcc();

	bus.handle('sum', (payload) => payload.a + payload.b);
	bus.handle('later', async () => 'done');

	assert.equal(await bus.invoke('sum', { a: 2, b: 3 }), 5);
	assert.equal(await bus.invoke('later'), 'done');
	assert.ok(bus.hasHandler('sum'));
});

test('invoke rejects when the channel has no handler', async () => {
	const bus = createIcc();

	await assert.rejects(
		() => bus.invoke('missing'),
		(error) => error.code === 'ERR_ICC_NO_HANDLER' && error.channel === 'missing',
	);
});

test('invoke forwards a thrown and a rejected handler failure', async () => {
	const bus = createIcc();

	bus.handle('sync', () => { throw new Error('sync failure'); });
	await assert.rejects(() => bus.invoke('sync'), /sync failure/);

	bus.handle('async', () => Promise.reject(new Error('async failure')));
	await assert.rejects(() => bus.invoke('async'), /async failure/);
});

test('handle replaces the previous handler and a stale disposer keeps the new one', async () => {
	const bus = createIcc();

	const offOld = bus.handle('who', () => 'old');
	bus.handle('who', () => 'new');
	offOld();

	assert.equal(await bus.invoke('who'), 'new');
});

test('a once handler answers a single request', async () => {
	const bus = createIcc();

	bus.handle('who', () => 'once', { once: true });

	assert.equal(await bus.invoke('who'), 'once');
	assert.equal(bus.hasHandler('who'), false);
});

test('removal helpers clean up listeners, handlers and channels', async () => {
	const bus = createIcc();

	bus.on('a', () => {});
	bus.on('a', () => {});
	bus.on('b', () => {});
	bus.handle('a', () => 1);

	assert.equal(bus.listenerCount(), 3);
	assert.deepEqual(bus.channelNames().sort(), ['a', 'b']);

	bus.removeAllListeners('a');
	assert.equal(bus.listenerCount('a'), 0);
	assert.ok(bus.hasHandler('a'), 'listeners and handler are independent');

	bus.removeHandler('a');
	assert.equal(bus.hasHandler('a'), false);

	bus.removeChannel('a');
	assert.deepEqual(bus.channelNames(), ['b']);

	bus.clear();
	assert.deepEqual(bus.channelNames(), []);
	assert.equal(bus.listenerCount(), 0);
});

test('inherited object members are not mistaken for channels', async () => {
	const bus = createIcc();
	let seen = null;

	bus.on('__proto__', (payload) => { seen = payload; });
	bus.sendSync('__proto__', 'safe');

	assert.equal(seen, 'safe');
	assert.deepEqual(bus.channelNames(), ['__proto__']);
	assert.equal(bus.listenerCount('constructor'), 0);
});

test('the default export is a shared instance of the exported class', () => {
	assert.ok(defaultBus instanceof Icc);
	assert.notEqual(defaultBus, createIcc());
});
