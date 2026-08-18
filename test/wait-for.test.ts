import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';
import type { IccError } from '../src/index';
import { createLegacySignal, createTrackingSignal } from './helpers/signals';

afterEach(() => {
	vi.useRealTimers();
});

describe('resolution', () => {
	it('resolves with the payload of the next emission', async () => {
		const bus = createIcc();

		bus.send('app:ready', { at: 1 });

		await expect(bus.waitFor('app:ready')).resolves.toEqual({ at: 1 });
	});

	it('resolves from a synchronous emission too', async () => {
		const bus = createIcc();
		const pending = bus.waitFor('x');

		bus.sendSync('x', 'sync');

		await expect(pending).resolves.toBe('sync');
	});

	it('ignores emissions that happened before the wait started', async () => {
		const bus = createIcc();

		bus.sendSync('x', 'too early');

		const pending = bus.waitFor('x');
		bus.sendSync('x', 'the one');

		await expect(pending).resolves.toBe('the one');
	});

	it('resolves every concurrent waiter of the same channel', async () => {
		const bus = createIcc();
		const first = bus.waitFor('x');
		const second = bus.waitFor('x');

		bus.sendSync('x', 'shared');

		await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared']);
	});

	it('removes its listener once it has resolved', async () => {
		const bus = createIcc();
		const pending = bus.waitFor('x');

		expect(bus.listenerCount('x')).toBe(1);

		bus.sendSync('x', 1);
		await pending;

		expect(bus.listenerCount('x')).toBe(0);
	});

	it('resolves with undefined on a channel carrying no payload', async () => {
		const bus = createIcc();
		const pending = bus.waitFor('modal:close');

		bus.sendSync('modal:close');

		await expect(pending).resolves.toBeUndefined();
	});
});

describe('timeout', () => {
	it('rejects with a tagged error once the timeout elapses', async () => {
		const bus = createIcc();
		const error = (await bus
			.waitFor('never', { timeout: 5 })
			.catch((reason: unknown) => reason)) as IccError;

		expect(error.name).toBe('IccError');
		expect(error.code).toBe('ERR_ICC_TIMEOUT');
		expect(error.channel).toBe('never');
		expect(error.message).toContain('5ms');
	});

	it('stops listening after it has timed out', async () => {
		const bus = createIcc();

		await bus.waitFor('never', { timeout: 5 }).catch(() => undefined);

		expect(bus.listenerCount('never')).toBe(0);
	});

	it('leaves no pending timer behind once it resolves in time', async () => {
		vi.useFakeTimers();

		const bus = createIcc();
		const pending = bus.waitFor('x', { timeout: 10_000 });

		bus.sendSync('x', 'in time');
		await pending;

		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not reject after having resolved, even once the delay passes', async () => {
		vi.useFakeTimers();

		const bus = createIcc();
		const settled = vi.fn();
		const pending = bus.waitFor('x', { timeout: 10 }).then(settled, settled);

		bus.sendSync('x', 'first');
		await pending;
		vi.advanceTimersByTime(100);

		expect(settled).toHaveBeenCalledTimes(1);
		expect(settled).toHaveBeenCalledWith('first');
	});

	it('waits indefinitely when the timeout is absent or not a finite number', async () => {
		vi.useFakeTimers();

		const bus = createIcc();

		void bus.waitFor('a');
		void bus.waitFor('b', {});
		void bus.waitFor('c', { timeout: Number.POSITIVE_INFINITY });
		void bus.waitFor('d', { timeout: Number.NaN });

		expect(vi.getTimerCount()).toBe(0);
		expect(bus.listenerCount()).toBe(4);
	});
});

describe('cancellation', () => {
	it('rejects with the reason the signal was aborted with', async () => {
		const bus = createIcc();
		const controller = new AbortController();
		const reason = new Error('component unmounted');
		const pending = bus.waitFor('never', { signal: controller });

		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(bus.listenerCount('never')).toBe(0);
	});

	it('rejects with a tagged error when the signal carries no reason', async () => {
		const bus = createIcc();
		const tracking = createTrackingSignal();
		const pending = bus.waitFor('never', { signal: tracking.signal });

		tracking.abort();

		const error = (await pending.catch((reason: unknown) => reason)) as IccError;

		expect(error.code).toBe('ERR_ICC_ABORTED');
		expect(error.channel).toBe('never');
	});

	it('rejects immediately when handed an already aborted signal', async () => {
		const bus = createIcc();
		const controller = new AbortController();

		controller.abort();

		await expect(bus.waitFor('never', { signal: controller })).rejects.toBeDefined();
		expect(bus.listenerCount('never')).toBe(0);
	});

	it('detaches from the signal once it has resolved', async () => {
		const bus = createIcc();
		const tracking = createTrackingSignal();
		const pending = bus.waitFor('x', { signal: tracking.signal });

		expect(tracking.attached()).toBe(1);

		bus.sendSync('x', 1);
		await pending;

		expect(tracking.attached()).toBe(0);
	});

	it('detaches from the signal once it has timed out', async () => {
		const bus = createIcc();
		const tracking = createTrackingSignal();

		await bus
			.waitFor('never', { signal: tracking.signal, timeout: 5 })
			.catch(() => undefined);

		expect(tracking.attached()).toBe(0);
	});

	it('resolves normally when handed a signal that only exposes onabort', async () => {
		const bus = createIcc();
		const legacy = createLegacySignal();
		const pending = bus.waitFor('x', { signal: legacy.signal });

		bus.sendSync('x', 'resolved before any abort');

		await expect(pending).resolves.toBe('resolved before any abort');
		expect(bus.listenerCount('x')).toBe(0);
	});

	it('works with a signal that only exposes the onabort property', async () => {
		const bus = createIcc();
		const legacy = createLegacySignal();
		const previous = vi.fn();

		legacy.presetOnAbort(previous);

		const pending = bus.waitFor('never', { signal: legacy.signal });

		legacy.abort();

		await expect(pending).rejects.toMatchObject({ code: 'ERR_ICC_ABORTED' });
		expect(previous, 'a handler installed earlier must still run').toHaveBeenCalledTimes(1);
		expect(bus.listenerCount('never')).toBe(0);
	});
});
