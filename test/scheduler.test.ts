import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';
import { flush } from './helpers/flush';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('an injected scheduler', () => {
	it('decides when a deferred broadcast runs', () => {
		const queue: Array<() => void> = [];
		const bus = createIcc({ scheduler: (task) => { queue.push(task); } });
		const listener = vi.fn();

		bus.on('x', listener);
		bus.send('x', 'queued');

		expect(listener).not.toHaveBeenCalled();
		expect(queue).toHaveLength(1);

		queue.shift()!();

		expect(listener).toHaveBeenCalledWith('queued');
	});

	it('makes send synchronous when it runs the task straight away', () => {
		const bus = createIcc({ scheduler: (task) => task() });
		const listener = vi.fn();

		bus.on('x', listener);
		bus.send('x', 'now');

		expect(listener).toHaveBeenCalledWith('now');
	});

	it('receives one task per send, in order', () => {
		const queue: Array<() => void> = [];
		const bus = createIcc({ scheduler: (task) => { queue.push(task); } });
		const seen: unknown[] = [];

		bus.on('x', (payload) => seen.push(payload));
		bus.send('x', 1);
		bus.send('x', 2);
		bus.send('x', 3);

		expect(queue).toHaveLength(3);

		for (const task of queue) task();

		expect(seen).toEqual([1, 2, 3]);
	});

	it('is never asked to schedule a synchronous broadcast', () => {
		const scheduler = vi.fn((task: () => void) => task());
		const bus = createIcc({ scheduler });

		bus.on('x', () => {});
		bus.sendSync('x');

		expect(scheduler).not.toHaveBeenCalled();
	});

	it('sees the payload captured at send time, not at dispatch time', () => {
		const queue: Array<() => void> = [];
		const bus = createIcc({ scheduler: (task) => { queue.push(task); } });
		const payload = { value: 'original' };
		let seen: unknown;

		bus.on('x', (received) => { seen = received; });
		bus.send('x', payload);

		queue.shift()!();

		expect(seen).toBe(payload);
	});

	it('is ignored when it is not a function', async () => {
		const bus = createIcc({ scheduler: 'nope' as unknown as () => void });
		const listener = vi.fn();

		bus.on('x', listener);
		bus.send('x');

		expect(listener, 'it falls back to the default deferral').not.toHaveBeenCalled();

		await flush();

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe('the default scheduler', () => {
	it('uses queueMicrotask when the engine provides it', async () => {
		const spy = vi.fn((task: () => void) => { void Promise.resolve().then(task); });

		vi.stubGlobal('queueMicrotask', spy);
		vi.resetModules();

		const { createIcc: create } = await import('../src/index');
		const bus = create();
		const listener = vi.fn();

		bus.on('x', listener);
		bus.send('x');

		expect(spy).toHaveBeenCalledTimes(1);

		await flush();

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('falls back to the promise job queue on an engine without queueMicrotask', async () => {
		vi.stubGlobal('queueMicrotask', undefined);
		vi.resetModules();

		const { createIcc: create } = await import('../src/index');
		const bus = create();
		const order: string[] = [];

		bus.on('x', () => order.push('listener'));
		setTimeout(() => order.push('timeout'), 0);
		bus.send('x');

		expect(order, 'still deferred, never synchronous').toEqual([]);

		await flush();

		expect(order, 'still a microtask, so ahead of the timeout').toEqual(['listener', 'timeout']);
	});

	// The last-resort `setTimeout` branch is exercised in `bare-realm.test.ts`:
	// stubbing away the global `Promise` inside the runner would take the test
	// framework down with it, so that branch is checked in a fresh JS realm.
});
