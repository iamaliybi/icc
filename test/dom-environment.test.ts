/**
 * @vitest-environment jsdom
 *
 * The same core, in a browser-shaped environment. Nothing here is a framework
 * test: it checks that a real DOM, real DOM events and a real `AbortController`
 * change nothing about how the bus behaves, and that the shared instance lands
 * on the window exactly once.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import icc, { createIcc } from '../src/index';
import { flush } from './helpers/flush';

afterEach(() => {
	icc.clear();
	document.body.innerHTML = '';
});

describe('the environment', () => {
	it('really is a DOM', () => {
		expect(typeof window).toBe('object');
		expect(typeof document).toBe('object');
		expect(globalThis).toBe(window);
	});

	it('behaves exactly as it does without a DOM', async () => {
		const bus = createIcc();
		const listener = vi.fn();

		bus.on('x', listener);
		bus.send('x', 'browser');

		expect(listener).not.toHaveBeenCalled();

		await flush();

		expect(listener).toHaveBeenCalledWith('browser');

		bus.handle('y', () => 'answered');

		await expect(bus.invoke('y')).resolves.toBe('answered');
	});
});

describe('working with real DOM plumbing', () => {
	it('shares one controller with a DOM event listener', () => {
		const bus = createIcc({ scheduler: (task) => task() });
		const controller = new AbortController();
		const button = document.createElement('button');
		const onBusEvent = vi.fn();
		const onClick = vi.fn();

		document.body.appendChild(button);
		button.addEventListener('click', onClick, { signal: controller.signal });
		bus.on('button:clicked', onBusEvent, { signal: controller });

		button.click();
		bus.sendSync('button:clicked');

		expect(onClick).toHaveBeenCalledTimes(1);
		expect(onBusEvent).toHaveBeenCalledTimes(1);

		controller.abort();

		button.click();
		bus.sendSync('button:clicked');

		expect(onClick, 'the DOM listener is gone').toHaveBeenCalledTimes(1);
		expect(onBusEvent, 'and so is the bus listener').toHaveBeenCalledTimes(1);
	});

	it('carries a payload from a DOM handler to an unrelated element', async () => {
		const bus = createIcc();
		const button = document.createElement('button');
		const badge = document.createElement('span');

		document.body.append(button, badge);
		button.addEventListener('click', () => bus.send('cart:item-added', { qty: 2 }));
		bus.on('cart:item-added', (item) => {
			badge.textContent = String((item as { qty: number }).qty);
		});

		button.click();

		expect(badge.textContent, 'dispatch is deferred, so nothing has happened yet').toBe('');

		await flush();

		expect(badge.textContent).toBe('2');
	});

	it('delivers synchronously inside an unload handler, where a microtask is too late', () => {
		const bus = createIcc();
		const saved: string[] = [];

		bus.on('app:teardown', () => saved.push('draft'));
		window.addEventListener('beforeunload', () => bus.sendSync('app:teardown'));
		window.dispatchEvent(new window.Event('beforeunload'));

		expect(saved).toEqual(['draft']);
	});

	it('lets a listener touch the DOM without the bus knowing anything about it', () => {
		const bus = createIcc({ scheduler: (task) => task() });
		const list = document.createElement('ul');

		document.body.appendChild(list);
		bus.on('item:add', (label) => {
			const item = document.createElement('li');

			item.textContent = String(label);
			list.appendChild(item);
		});

		bus.sendSync('item:add', 'first');
		bus.sendSync('item:add', 'second');

		expect(list.children).toHaveLength(2);
		expect(list.textContent).toBe('firstsecond');
	});
});

describe('the shared instance in a browser', () => {
	it('is published on the window under a single versioned key', () => {
		const key = '__ICC_DEFAULT_BUS_V1__';

		expect((window as unknown as Record<string, unknown>)[key]).toBe(icc);
		expect(Object.keys(window).filter((name) => name.startsWith('__ICC'))).toEqual([key]);
	});

	it('is the same instance for every importer of the module', async () => {
		const again = await import('../src/index');

		expect(again.default).toBe(icc);
		expect(again.icc).toBe(icc);
	});

	it('is not the instance handed out by createIcc', () => {
		expect(createIcc()).not.toBe(icc);
	});
});
