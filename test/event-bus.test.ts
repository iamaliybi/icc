import { describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';
import { collector, flush } from './helpers/flush';

/** A bus that dispatches synchronously, so ordering assertions stay readable. */
const syncBus = () => createIcc({ scheduler: (task) => task() });

describe('subscription', () => {
	it('delivers a payload to every listener, in registration order', async () => {
		const bus = createIcc();
		const seen: string[] = [];

		bus.on('greet', (payload) => seen.push(`a:${String(payload)}`));
		bus.on('greet', (payload) => seen.push(`b:${String(payload)}`));
		bus.on('greet', (payload) => seen.push(`c:${String(payload)}`));

		bus.send('greet', 'hi');
		await flush();

		expect(seen).toEqual(['a:hi', 'b:hi', 'c:hi']);
	});

	it('hands every listener the very same payload reference', () => {
		const bus = syncBus();
		const payload = { nested: { id: 1 } };
		const received: unknown[] = [];

		bus.on('x', (value) => received.push(value));
		bus.on('x', (value) => received.push(value));
		bus.sendSync('x', payload);

		expect(received[0]).toBe(payload);
		expect(received[1]).toBe(payload);
	});

	it('passes undefined to listeners of a channel sent without a payload', () => {
		const bus = syncBus();
		const { seen, listener } = collector();

		bus.on('ping', listener);
		bus.sendSync('ping');

		expect(seen).toEqual([undefined]);
	});

	it('calls the same function twice when it was registered twice', () => {
		const bus = syncBus();
		const listener = vi.fn();

		bus.on('x', listener);
		bus.on('x', listener);
		bus.sendSync('x', 1);

		expect(listener).toHaveBeenCalledTimes(2);
		expect(bus.listenerCount('x')).toBe(2);
	});

	it('does nothing when a channel has no listeners at all', () => {
		const bus = syncBus();

		expect(() => bus.sendSync('nobody', 1)).not.toThrow();
		expect(bus.listenerCount('nobody')).toBe(0);
	});

	it('handles a large number of listeners on one channel', () => {
		const bus = syncBus();
		let calls = 0;

		for (let i = 0; i < 1_000; i += 1) bus.on('many', () => { calls += 1; });
		bus.sendSync('many', null);

		expect(calls).toBe(1_000);
		expect(bus.listenerCount('many')).toBe(1_000);
	});
});

describe('timing', () => {
	it('defers send until the current call stack has unwound', async () => {
		const bus = createIcc();
		const { seen, listener } = collector();

		bus.on('x', listener);
		bus.send('x', 'deferred');

		expect(seen).toEqual([]);

		await flush();

		expect(seen).toEqual(['deferred']);
	});

	it('dispatches sendSync before the call returns', () => {
		const bus = createIcc();
		const { seen, listener } = collector();

		bus.on('x', listener);
		bus.sendSync('x', 'immediate');

		expect(seen).toEqual(['immediate']);
	});

	it('keeps the order of several deferred sends', async () => {
		const bus = createIcc();
		const { seen, listener } = collector();

		bus.on('x', listener);
		bus.send('x', 1);
		bus.send('x', 2);
		bus.send('x', 3);
		await flush();

		expect(seen).toEqual([1, 2, 3]);
	});

	it('dispatches on the microtask queue, ahead of a macrotask', async () => {
		const bus = createIcc();
		const order: string[] = [];

		bus.on('x', () => order.push('listener'));
		setTimeout(() => order.push('timeout'), 0);
		bus.send('x');

		await flush();

		expect(order).toEqual(['listener', 'timeout']);
	});
});

describe('removal', () => {
	it('removes exactly the listener its disposer belongs to', () => {
		const bus = syncBus();
		const seen: string[] = [];

		const offFirst = bus.on('x', () => seen.push('first'));
		const offSecond = bus.on('x', () => seen.push('second'));
		bus.on('x', () => seen.push('third'));

		// Removing in this order shifts the indices of everything behind them,
		// which is where a stored index would start deleting the wrong listener.
		offFirst();
		offSecond();
		bus.sendSync('x');

		expect(seen).toEqual(['third']);
	});

	it('is safe to call a disposer more than once', () => {
		const bus = syncBus();
		const off = bus.on('x', () => {});

		off();
		off();
		off();

		expect(bus.listenerCount('x')).toBe(0);
	});

	it('removes one registration at a time when a listener was added twice', () => {
		const bus = syncBus();
		const listener = vi.fn();

		bus.on('x', listener);
		bus.on('x', listener);

		expect(bus.off('x', listener)).toBe(true);
		expect(bus.listenerCount('x')).toBe(1);

		bus.sendSync('x');

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('reports an unsuccessful off on an unknown listener or channel', () => {
		const bus = syncBus();

		bus.on('x', () => {});

		expect(bus.off('x', () => {})).toBe(false);
		expect(bus.off('never-used', () => {})).toBe(false);
	});

	it('leaves no residue behind after repeated add and remove cycles', () => {
		const bus = syncBus();

		for (let i = 0; i < 100; i += 1) {
			const off = bus.on('x', () => {});
			off();
		}

		expect(bus.listenerCount('x')).toBe(0);
		expect(bus.listenerCount()).toBe(0);
	});
});

describe('once', () => {
	it('fires a single time and is then gone', () => {
		const bus = syncBus();
		const listener = vi.fn();

		bus.once('ping', listener);
		bus.sendSync('ping');
		bus.sendSync('ping');

		expect(listener).toHaveBeenCalledTimes(1);
		expect(bus.listenerCount('ping')).toBe(0);
	});

	it('behaves identically whether written as once() or as { once: true }', () => {
		const bus = syncBus();
		const viaMethod = vi.fn();
		const viaOption = vi.fn();

		bus.once('ping', viaMethod);
		bus.on('ping', viaOption, { once: true });

		bus.sendSync('ping');
		bus.sendSync('ping');

		expect(viaMethod).toHaveBeenCalledTimes(1);
		expect(viaOption).toHaveBeenCalledTimes(1);
	});

	it('is removed even when it throws on its only call', () => {
		const bus = createIcc({ scheduler: (task) => task(), onError: () => {} });

		bus.once('ping', () => { throw new Error('boom'); });
		bus.sendSync('ping');

		expect(bus.listenerCount('ping')).toBe(0);
	});

	it('can be disposed before it ever fires', () => {
		const bus = syncBus();
		const listener = vi.fn();

		bus.once('ping', listener)();
		bus.sendSync('ping');

		expect(listener).not.toHaveBeenCalled();
	});
});

describe('mutation during dispatch', () => {
	it('honours a listener removed by an earlier listener of the same emission', () => {
		const bus = syncBus();
		const seen: string[] = [];

		bus.on('x', () => {
			seen.push('first');
			offSecond();
		});

		const offSecond = bus.on('x', () => seen.push('second'));
		bus.on('x', () => seen.push('third'));

		bus.sendSync('x');

		expect(seen).toEqual(['first', 'third']);
	});

	it('does not run a listener that subscribed during the same emission', () => {
		const bus = syncBus();
		const late = vi.fn();

		bus.on('x', () => { bus.on('x', late); });
		bus.sendSync('x');

		expect(late).not.toHaveBeenCalled();

		bus.sendSync('x');

		expect(late).toHaveBeenCalledTimes(1);
	});

	it('lets a listener remove itself from inside its own call', () => {
		const bus = syncBus();
		let calls = 0;

		const off = bus.on('x', () => {
			calls += 1;
			off();
		});

		bus.sendSync('x');
		bus.sendSync('x');

		expect(calls).toBe(1);
		expect(bus.listenerCount('x')).toBe(0);
	});

	it('stops the remaining listeners when a listener clears the bus', () => {
		const bus = syncBus();
		const later = vi.fn();

		bus.on('x', () => bus.clear());
		bus.on('x', later);
		bus.sendSync('x');

		expect(later).not.toHaveBeenCalled();
	});

	it('supports a listener re-entering the same channel synchronously', () => {
		const bus = syncBus();
		const seen: number[] = [];

		bus.on('x', (depth) => {
			const level = depth as number;

			seen.push(level);
			if (level < 3) bus.sendSync('x', level + 1);
		});

		bus.sendSync('x', 1);

		expect(seen).toEqual([1, 2, 3]);
	});

	it('supports a listener publishing on another channel', async () => {
		const bus = createIcc();
		const { seen, listener } = collector();

		bus.on('a', () => bus.send('b', 'from-a'));
		bus.on('b', listener);
		bus.send('a');
		await flush();

		expect(seen).toEqual(['from-a']);
	});
});
