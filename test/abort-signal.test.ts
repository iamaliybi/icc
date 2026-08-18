import { describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';
import { createLegacySignal, createTrackingSignal } from './helpers/signals';

describe('accepted shapes', () => {
	it('accepts an AbortController and its signal interchangeably', () => {
		const bus = createIcc();
		const controller = new AbortController();

		bus.on('a', () => {}, { signal: controller });
		bus.on('b', () => {}, { signal: controller.signal });

		expect(bus.listenerCount()).toBe(2);

		controller.abort();

		expect(bus.listenerCount()).toBe(0);
	});

	it('works with a signal that only exposes the onabort property', () => {
		const bus = createIcc();
		const legacy = createLegacySignal();

		bus.on('a', () => {}, { signal: legacy.signal });
		expect(bus.listenerCount('a')).toBe(1);

		legacy.abort();
		expect(bus.listenerCount('a')).toBe(0);
	});

	it('chains onto an onabort handler that was installed earlier', () => {
		const bus = createIcc();
		const legacy = createLegacySignal();
		const previous = vi.fn();

		legacy.presetOnAbort(previous);
		bus.on('a', () => {}, { signal: legacy.signal });
		legacy.abort();

		expect(previous).toHaveBeenCalledTimes(1);
		expect(bus.listenerCount('a')).toBe(0);
	});
});

describe('one controller, many registrations', () => {
	it('removes every listener and handler tied to it', () => {
		const bus = createIcc();
		const controller = new AbortController();

		bus.on('a', () => {}, { signal: controller });
		bus.once('b', () => {}, { signal: controller });
		bus.on('c', () => {}, { signal: controller });
		bus.handle('d', () => 1, { signal: controller });
		bus.handleOnce('e', () => 1, { signal: controller });

		expect(bus.listenerCount()).toBe(3);
		expect(bus.hasHandler('d')).toBe(true);
		expect(bus.hasHandler('e')).toBe(true);

		controller.abort();

		expect(bus.listenerCount()).toBe(0);
		expect(bus.hasHandler('d')).toBe(false);
		expect(bus.hasHandler('e')).toBe(false);
	});

	it('scales to many registrations without dropping any of them', () => {
		const bus = createIcc();
		const controller = new AbortController();

		for (let i = 0; i < 200; i += 1) {
			bus.on('bulk', () => {}, { signal: controller });
		}

		expect(bus.listenerCount('bulk')).toBe(200);

		controller.abort();

		expect(bus.listenerCount('bulk')).toBe(0);
	});

	it('leaves registrations made with another controller alone', () => {
		const bus = createIcc();
		const mine = new AbortController();
		const yours = new AbortController();

		bus.on('x', () => {}, { signal: mine });
		bus.on('x', () => {}, { signal: yours });

		mine.abort();

		expect(bus.listenerCount('x')).toBe(1);
	});
});

describe('already aborted signals', () => {
	it('registers no listener at all', () => {
		const bus = createIcc();
		const controller = new AbortController();

		controller.abort();

		const off = bus.on('a', () => {}, { signal: controller });

		expect(bus.listenerCount('a')).toBe(0);
		expect(bus.channelNames()).toEqual([]);
		expect(off).not.toThrow();
	});

	it('registers no handler at all', () => {
		const bus = createIcc();
		const controller = new AbortController();

		controller.abort();

		const off = bus.handle('a', () => 1, { signal: controller });

		expect(bus.hasHandler('a')).toBe(false);
		expect(off).not.toThrow();
	});
});

describe('no leaks on the signal', () => {
	it('detaches its abort listener when the disposer is called first', () => {
		const bus = createIcc();
		const tracking = createTrackingSignal();

		const off = bus.on('a', () => {}, { signal: tracking.signal });

		expect(tracking.attached()).toBe(1);

		off();

		expect(tracking.attached()).toBe(0);
		expect(bus.listenerCount('a')).toBe(0);
	});

	it('detaches the abort listener of a handler disposed by hand', () => {
		const bus = createIcc();
		const tracking = createTrackingSignal();

		bus.handle('a', () => 1, { signal: tracking.signal })();

		expect(tracking.attached()).toBe(0);
	});

	it('keeps a long-lived controller from accumulating listeners', () => {
		const bus = createIcc();
		const tracking = createTrackingSignal();

		for (let i = 0; i < 50; i += 1) {
			bus.on('churn', () => {}, { signal: tracking.signal })();
		}

		expect(tracking.totalAttached()).toBe(50);
		expect(tracking.attached()).toBe(0);
	});

	it('tolerates a signal that can attach a listener but not detach one', () => {
		const bus = createIcc();
		const attached: Array<() => void> = [];
		const oddSignal = {
			aborted: false,
			addEventListener: (_type: string, listener: () => void) => { attached.push(listener); },
		} as unknown as AbortSignal;

		const off = bus.on('a', () => {}, { signal: oddSignal });

		expect(off).not.toThrow();
		expect(bus.listenerCount('a')).toBe(0);

		// The abort still arrives, because there was no way to detach from it.
		expect(() => attached[0]()).not.toThrow();
	});

	it('is safe to abort after everything was disposed by hand', () => {
		const bus = createIcc();
		const controller = new AbortController();

		bus.on('a', () => {}, { signal: controller })();
		bus.handle('b', () => 1, { signal: controller })();

		expect(() => controller.abort()).not.toThrow();
		expect(bus.listenerCount()).toBe(0);
	});

	it('does not let a disposed registration take a later one down with it', () => {
		const bus = createIcc();
		const controller = new AbortController();

		bus.handle('b', () => 'first', { signal: controller })();
		bus.handle('b', () => 'second');

		controller.abort();

		expect(bus.hasHandler('b'), 'the second handler has nothing to do with the signal').toBe(true);
	});
});
