/**
 * The core has to behave the same wherever it runs, so nothing here touches a
 * framework or a DOM. This file runs in a bare Node environment — there is no
 * `window`, no `document`, no renderer — and drives the bus through the teardown
 * shape of each major framework instead of through the framework itself.
 */

import { describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';
import type { Unsubscribe } from '../src/index';

const syncBus = () => createIcc({ scheduler: (task) => task() });

describe('environment independence', () => {
	it('runs with no DOM in sight', () => {
		expect(typeof window, 'this suite must not silently gain a DOM').toBe('undefined');
		expect(typeof document).toBe('undefined');

		const bus = syncBus();
		const listener = vi.fn();

		bus.on('x', listener);
		bus.sendSync('x', 'no dom needed');

		expect(listener).toHaveBeenCalledWith('no dom needed');
	});

	it('needs neither AbortController nor a scheduler to be usable', async () => {
		const bus = createIcc();
		const listener = vi.fn();

		const off = bus.on('x', listener);
		bus.handle('y', () => 'answer');

		await expect(bus.invoke('y')).resolves.toBe('answer');

		off();

		expect(bus.listenerCount('x')).toBe(0);
	});

	it('keeps payloads opaque, whatever they are', () => {
		const bus = syncBus();
		const received: unknown[] = [];
		const payloads: unknown[] = [
			undefined,
			null,
			0,
			'',
			false,
			Symbol.for('icc.test'),
			{ nested: { deep: true } },
			[1, 2, 3],
			new Date(0),
			() => 'a function',
			new Map([['k', 'v']]),
		];

		bus.on('x', (payload) => received.push(payload));

		for (const payload of payloads) bus.sendSync('x', payload);

		expect(received).toEqual(payloads);
	});
});

describe('React-shaped lifetimes', () => {
	/** Stands in for `useEffect(() => { ...; return cleanup }, [])`. */
	function mountEffect(setUp: (signal: AbortController) => void): () => void {
		const controller = new AbortController();

		setUp(controller);

		return () => controller.abort();
	}

	it('leaves nothing behind after an effect is cleaned up', () => {
		const bus = syncBus();
		const listener = vi.fn();

		const unmount = mountEffect((controller) => {
			bus.on('cart:item-added', listener, { signal: controller });
			bus.handle('cart:total', () => 0, { signal: controller });
		});

		bus.sendSync('cart:item-added', { qty: 1 });
		expect(listener).toHaveBeenCalledTimes(1);

		unmount();

		bus.sendSync('cart:item-added', { qty: 2 });
		expect(listener).toHaveBeenCalledTimes(1);
		expect(bus.listenerCount()).toBe(0);
		expect(bus.hasHandler('cart:total')).toBe(false);
	});

	it('survives the double mount of React strict mode', () => {
		const bus = syncBus();
		const listener = vi.fn();
		const setUp = (controller: AbortController) => {
			bus.on('x', listener, { signal: controller });
		};

		// Mount, unmount, mount again — exactly what strict mode does in development.
		mountEffect(setUp)();

		const unmount = mountEffect(setUp);

		bus.sendSync('x');

		expect(listener, 'the discarded first mount must not double-deliver').toHaveBeenCalledTimes(1);

		unmount();

		expect(bus.listenerCount('x')).toBe(0);
	});

	it('does not accumulate registrations over many mount cycles', () => {
		const bus = syncBus();

		for (let i = 0; i < 100; i += 1) {
			mountEffect((controller) => {
				bus.on('x', () => {}, { signal: controller });
			})();
		}

		expect(bus.listenerCount('x')).toBe(0);
	});
});

describe('Vue-shaped lifetimes', () => {
	/** Stands in for `onScopeDispose(off)` inside a composable. */
	function useScope(): { collect: (off: Unsubscribe) => void; dispose: () => void } {
		const disposers: Unsubscribe[] = [];

		return {
			collect: (off) => { disposers.push(off); },
			dispose: () => {
				for (const off of disposers.splice(0)) off();
			},
		};
	}

	it('cleans up through returned disposers rather than a signal', () => {
		const bus = syncBus();
		const scope = useScope();
		let count = 0;

		scope.collect(bus.on('cart:item-added', () => { count += 1; }));
		scope.collect(bus.on('cart:cleared', () => { count = 0; }));

		bus.sendSync('cart:item-added');
		expect(count).toBe(1);

		scope.dispose();

		bus.sendSync('cart:item-added');
		expect(count).toBe(1);
		expect(bus.listenerCount()).toBe(0);
	});

	it('tolerates a scope being disposed twice', () => {
		const bus = syncBus();
		const scope = useScope();

		scope.collect(bus.on('x', () => {}));
		scope.dispose();

		expect(() => scope.dispose()).not.toThrow();
	});
});

describe('Angular-shaped lifetimes', () => {
	class CartBadgeComponent {
		private readonly controller = new AbortController();

		public count = 0;

		public constructor(private readonly bus: ReturnType<typeof syncBus>) {}

		public ngOnInit(): void {
			this.bus.on(
				'cart:item-added',
				(item) => { this.count += (item as { qty: number }).qty; },
				{ signal: this.controller },
			);
		}

		public ngOnDestroy(): void {
			this.controller.abort();
		}
	}

	it('binds to the component instance and unbinds on destroy', () => {
		const bus = syncBus();
		const component = new CartBadgeComponent(bus);

		component.ngOnInit();
		bus.sendSync('cart:item-added', { qty: 3 });

		expect(component.count).toBe(3);

		component.ngOnDestroy();
		bus.sendSync('cart:item-added', { qty: 5 });

		expect(component.count).toBe(3);
		expect(bus.listenerCount()).toBe(0);
	});

	it('keeps two instances of the same component independent', () => {
		const bus = syncBus();
		const first = new CartBadgeComponent(bus);
		const second = new CartBadgeComponent(bus);

		first.ngOnInit();
		second.ngOnInit();
		bus.sendSync('cart:item-added', { qty: 1 });

		first.ngOnDestroy();
		bus.sendSync('cart:item-added', { qty: 1 });

		expect(first.count).toBe(1);
		expect(second.count).toBe(2);
	});
});

describe('components talking to each other', () => {
	it('carries a broadcast from one unit to another that knows nothing about it', () => {
		const bus = syncBus();
		const header = { badge: 0 };
		const productCard = {
			addToCart: (qty: number) => bus.sendSync('cart:item-added', { qty }),
		};

		bus.on('cart:item-added', (item) => { header.badge += (item as { qty: number }).qty; });

		productCard.addToCart(2);
		productCard.addToCart(3);

		expect(header.badge).toBe(5);
	});

	it('lets one unit ask another for a value it owns', async () => {
		const bus = createIcc();
		const store = { items: [{ price: 10 }, { price: 32 }] };

		bus.handle('cart:total', () => store.items.reduce((sum, item) => sum + item.price, 0));

		await expect(bus.invoke('cart:total')).resolves.toBe(42);
	});

	it('keeps working when a listening component tears itself down mid-dispatch', () => {
		const bus = syncBus();
		const survivor = vi.fn();

		const controller = new AbortController();

		bus.on('x', () => controller.abort(), { signal: controller });
		bus.on('x', survivor);
		bus.sendSync('x');

		expect(survivor).toHaveBeenCalledTimes(1);
		expect(bus.listenerCount('x')).toBe(1);
	});
});
