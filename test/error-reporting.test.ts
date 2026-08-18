import { afterEach, describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';

const syncBus = (onError?: (error: unknown, context: { channel: string; type: 'listener' }) => void) =>
	createIcc({ scheduler: (task) => task(), onError });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a listener that throws', () => {
	it('does not stop the listeners that come after it', () => {
		const bus = syncBus(() => {});
		const later = vi.fn();

		bus.on('x', () => { throw new Error('boom'); });
		bus.on('x', later);
		bus.sendSync('x');

		expect(later).toHaveBeenCalledTimes(1);
	});

	it('is reported with the channel it happened on', () => {
		const onError = vi.fn();
		const bus = syncBus(onError);
		const thrown = new Error('boom');

		bus.on('theme:change', () => { throw thrown; });
		bus.sendSync('theme:change', 'dark');

		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(thrown, { channel: 'theme:change', type: 'listener' });
	});

	it('is reported once per failing listener', () => {
		const onError = vi.fn();
		const bus = syncBus(onError);

		bus.on('x', () => { throw new Error('a'); });
		bus.on('x', () => { throw new Error('b'); });
		bus.sendSync('x');

		expect(onError).toHaveBeenCalledTimes(2);
	});

	it('is reported even when it threw something that is not an error', () => {
		const onError = vi.fn();
		const bus = syncBus(onError);

		bus.on('x', () => { throw 'a string'; });
		bus.sendSync('x');

		expect(onError.mock.calls[0][0]).toBe('a string');
	});

	it('never reaches the caller of send', async () => {
		const bus = createIcc({ onError: () => {} });

		bus.on('x', () => { throw new Error('boom'); });

		expect(() => bus.send('x')).not.toThrow();
		await expect(Promise.resolve()).resolves.toBeUndefined();
	});

	it('never reaches the scheduler', () => {
		const scheduler = vi.fn((task: () => void) => {
			expect(task).not.toThrow();
		});
		const bus = createIcc({ scheduler, onError: () => {} });

		bus.on('x', () => { throw new Error('boom'); });
		bus.send('x');

		expect(scheduler).toHaveBeenCalledTimes(1);
	});
});

describe('the reporter itself', () => {
	it('cannot break the dispatch by throwing', () => {
		const later = vi.fn();
		const bus = syncBus(() => { throw new Error('the reporter is broken too'); });

		bus.on('x', () => { throw new Error('boom'); });
		bus.on('x', later);

		expect(() => bus.sendSync('x')).not.toThrow();
		expect(later).toHaveBeenCalledTimes(1);
	});

	it('defaults to console.error, tagged with the library name', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const bus = createIcc({ scheduler: (task) => task() });
		const thrown = new Error('boom');

		bus.on('x', () => { throw thrown; });
		bus.sendSync('x');

		expect(spy).toHaveBeenCalledTimes(1);
		expect(String(spy.mock.calls[0][0])).toContain('[icc]');
		expect(spy.mock.calls[0][1]).toBe(thrown);
	});

	it('stays silent in an environment whose console has no error method', () => {
		vi.stubGlobal('console', {});

		const bus = createIcc({ scheduler: (task) => task() });
		const later = vi.fn();

		bus.on('x', () => { throw new Error('boom'); });
		bus.on('x', later);

		expect(() => bus.sendSync('x')).not.toThrow();
		expect(later).toHaveBeenCalledTimes(1);
	});

	it('is not used at all when a listener behaves', () => {
		const onError = vi.fn();
		const bus = syncBus(onError);

		bus.on('x', () => {});
		bus.sendSync('x');

		expect(onError).not.toHaveBeenCalled();
	});

	it('is ignored when it is not a function', () => {
		const bus = createIcc({
			scheduler: (task) => task(),
			onError: 'not a function' as unknown as () => void,
		});
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		bus.on('x', () => { throw new Error('boom'); });

		expect(() => bus.sendSync('x')).not.toThrow();
		expect(spy, 'it falls back to the default reporter').toHaveBeenCalledTimes(1);
	});
});
