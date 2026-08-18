import { describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';
import type { IccError } from '../src/index';

/** Reads the `code` of a rejection without asserting it is an `IccError` first. */
const codeOf = (error: unknown): string | undefined => (error as Partial<IccError>).code;

describe('answering a request', () => {
	it('resolves with the result of a synchronous handler', async () => {
		const bus = createIcc();

		bus.handle('sum', (payload) => (payload as { a: number; b: number }).a + (payload as { a: number; b: number }).b);

		await expect(bus.invoke('sum', { a: 2, b: 3 })).resolves.toBe(5);
	});

	it('resolves with the result of an asynchronous handler', async () => {
		const bus = createIcc();

		bus.handle('later', async () => 'done');

		await expect(bus.invoke('later')).resolves.toBe('done');
	});

	it('returns a promise even when the handler is synchronous', () => {
		const bus = createIcc();

		bus.handle('now', () => 1);

		expect(bus.invoke('now')).toBeInstanceOf(Promise);
	});

	it('adopts a thenable that is not a native promise', async () => {
		const bus = createIcc();

		bus.handle('thenable', () => ({
			then: (resolve: (value: string) => void) => resolve('adopted'),
		}) as unknown as string);

		await expect(bus.invoke('thenable')).resolves.toBe('adopted');
	});

	it('resolves with falsy results untouched', async () => {
		const bus = createIcc();

		bus.handle('undefined', () => undefined);
		bus.handle('null', () => null);
		bus.handle('zero', () => 0);
		bus.handle('empty', () => '');
		bus.handle('false', () => false);

		await expect(bus.invoke('undefined')).resolves.toBeUndefined();
		await expect(bus.invoke('null')).resolves.toBeNull();
		await expect(bus.invoke('zero')).resolves.toBe(0);
		await expect(bus.invoke('empty')).resolves.toBe('');
		await expect(bus.invoke('false')).resolves.toBe(false);
	});

	it('forwards every declared argument to the handler', async () => {
		const bus = createIcc<Record<string, unknown>, { many: (a: number, b: string, c: boolean) => unknown[] }>();

		bus.handle('many', (...args) => args);

		await expect(bus.invoke('many', 1, 'two', true)).resolves.toEqual([1, 'two', true]);
	});

	it('calls a handler with no arguments when none are declared', async () => {
		const bus = createIcc();
		const handler = vi.fn(() => 'ok');

		bus.handle('none', handler);
		await bus.invoke('none');

		expect(handler).toHaveBeenCalledWith();
	});
});

describe('failures', () => {
	it('rejects with a tagged error when nothing answers the channel', async () => {
		const bus = createIcc();
		const error = (await bus.invoke('missing').catch((reason: unknown) => reason)) as IccError;

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('IccError');
		expect(error.code).toBe('ERR_ICC_NO_HANDLER');
		expect(error.channel).toBe('missing');
		expect(error.message).toContain('missing');
	});

	it('rejects when the channel exists but only carries listeners', async () => {
		const bus = createIcc();

		bus.on('mixed', () => {});

		await expect(bus.invoke('mixed')).rejects.toMatchObject({ code: 'ERR_ICC_NO_HANDLER' });
	});

	it('forwards the exact error a synchronous handler throws', async () => {
		const bus = createIcc();
		const thrown = new Error('sync failure');

		bus.handle('sync', () => { throw thrown; });

		await expect(bus.invoke('sync')).rejects.toBe(thrown);
	});

	it('forwards the exact reason an asynchronous handler rejects with', async () => {
		const bus = createIcc();
		const reason = new Error('async failure');

		bus.handle('async', () => Promise.reject(reason));

		await expect(bus.invoke('async')).rejects.toBe(reason);
	});

	it('forwards values that are not errors at all', async () => {
		const bus = createIcc();

		bus.handle('string', () => { throw 'just a string'; });
		bus.handle('undefined', () => { throw undefined; });

		await expect(bus.invoke('string')).rejects.toBe('just a string');
		await expect(bus.invoke('undefined')).rejects.toBeUndefined();
	});

	it('never routes a handler failure to onError, because the caller owns it', async () => {
		const onError = vi.fn();
		const bus = createIcc({ onError });

		bus.handle('boom', () => { throw new Error('boom'); });

		await expect(bus.invoke('boom')).rejects.toThrow('boom');
		expect(onError).not.toHaveBeenCalled();
	});

	it('keeps the channel answerable after a failure', async () => {
		const bus = createIcc();
		let shouldFail = true;

		bus.handle('flaky', () => {
			if (shouldFail) throw new Error('nope');

			return 'recovered';
		});

		await expect(bus.invoke('flaky')).rejects.toThrow('nope');
		shouldFail = false;
		await expect(bus.invoke('flaky')).resolves.toBe('recovered');
	});
});

describe('one responder per channel', () => {
	it('replaces the previous handler', async () => {
		const bus = createIcc();

		bus.handle('who', () => 'old');
		bus.handle('who', () => 'new');

		await expect(bus.invoke('who')).resolves.toBe('new');
	});

	it('ignores the disposer of a handler that was already replaced', async () => {
		const bus = createIcc();

		const offOld = bus.handle('who', () => 'old');
		bus.handle('who', () => 'new');
		offOld();

		expect(bus.hasHandler('who')).toBe(true);
		await expect(bus.invoke('who')).resolves.toBe('new');
	});

	it('is safe to dispose a handler twice', () => {
		const bus = createIcc();
		const off = bus.handle('who', () => 1);

		off();
		off();

		expect(bus.hasHandler('who')).toBe(false);
	});

	it('reports and removes handlers independently of listeners', () => {
		const bus = createIcc();

		bus.on('shared', () => {});
		bus.handle('shared', () => 1);

		expect(bus.hasHandler('shared')).toBe(true);

		bus.removeHandler('shared');

		expect(bus.hasHandler('shared')).toBe(false);
		expect(bus.listenerCount('shared')).toBe(1);
	});

	it('tolerates removing a handler from a channel that never had one', () => {
		const bus = createIcc();

		expect(() => bus.removeHandler('unknown')).not.toThrow();
		expect(bus.hasHandler('unknown')).toBe(false);
	});
});

describe('one-shot responders', () => {
	it('answers a single request and then steps down', async () => {
		const bus = createIcc();

		bus.handleOnce('who', () => 'once');

		await expect(bus.invoke('who')).resolves.toBe('once');
		expect(bus.hasHandler('who')).toBe(false);
		expect(codeOf(await bus.invoke('who').catch((error: unknown) => error as unknown))).toBe('ERR_ICC_NO_HANDLER');
	});

	it('behaves identically whether written as handleOnce() or as { once: true }', async () => {
		const bus = createIcc();

		bus.handleOnce('a', () => 'a');
		bus.handle('b', () => 'b', { once: true });

		await Promise.all([bus.invoke('a'), bus.invoke('b')]);

		expect(bus.hasHandler('a')).toBe(false);
		expect(bus.hasHandler('b')).toBe(false);
	});

	it('steps down before the handler runs, so a concurrent request finds nothing', async () => {
		const bus = createIcc();

		bus.handleOnce('who', async () => 'first');

		const first = bus.invoke('who');
		const second = bus.invoke('who');

		await expect(first).resolves.toBe('first');
		await expect(second).rejects.toMatchObject({ code: 'ERR_ICC_NO_HANDLER' });
	});

	it('steps down even when the single answer fails', async () => {
		const bus = createIcc();

		bus.handleOnce('who', () => { throw new Error('boom'); });

		await expect(bus.invoke('who')).rejects.toThrow('boom');
		expect(bus.hasHandler('who')).toBe(false);
	});

	it('can be disposed before it ever answers', () => {
		const bus = createIcc();

		bus.handleOnce('who', () => 1)();

		expect(bus.hasHandler('who')).toBe(false);
	});
});
