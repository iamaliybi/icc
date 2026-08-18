import { describe, expect, it, vi } from 'vitest';

import { createIcc } from '../src/index';

describe('introspection', () => {
	it('counts listeners per channel and across the bus', () => {
		const bus = createIcc();

		bus.on('a', () => {});
		bus.on('a', () => {});
		bus.on('b', () => {});

		expect(bus.listenerCount('a')).toBe(2);
		expect(bus.listenerCount('b')).toBe(1);
		expect(bus.listenerCount('never-used')).toBe(0);
		expect(bus.listenerCount()).toBe(3);
	});

	it('does not count handlers as listeners', () => {
		const bus = createIcc();

		bus.handle('a', () => 1);

		expect(bus.listenerCount('a')).toBe(0);
		expect(bus.listenerCount()).toBe(0);
		expect(bus.hasHandler('a')).toBe(true);
	});

	it('lists channel names in registration order', () => {
		const bus = createIcc();

		bus.on('second', () => {});
		bus.handle('first', () => 1);
		bus.on('third', () => {});

		expect(bus.channelNames()).toEqual(['second', 'first', 'third']);
	});

	it('starts out empty', () => {
		const bus = createIcc();

		expect(bus.channelNames()).toEqual([]);
		expect(bus.listenerCount()).toBe(0);
	});

	it('keeps a channel listed once it has been used, even after its listeners leave', () => {
		const bus = createIcc();

		bus.on('a', () => {})();

		expect(bus.channelNames()).toEqual(['a']);
		expect(bus.listenerCount('a')).toBe(0);
	});

	it('hands back a copy of the names, not the live registry', () => {
		const bus = createIcc();

		bus.on('a', () => {});

		const names = bus.channelNames();
		names.push('injected');

		expect(bus.channelNames()).toEqual(['a']);
	});
});

describe('teardown', () => {
	it('removes the listeners of one channel and keeps its handler', () => {
		const bus = createIcc();

		bus.on('a', () => {});
		bus.on('a', () => {});
		bus.handle('a', () => 1);
		bus.on('b', () => {});

		bus.removeAllListeners('a');

		expect(bus.listenerCount('a')).toBe(0);
		expect(bus.hasHandler('a')).toBe(true);
		expect(bus.listenerCount('b')).toBe(1);
	});

	it('removes every listener of the bus when no channel is given', () => {
		const bus = createIcc();

		bus.on('a', () => {});
		bus.on('b', () => {});
		bus.handle('c', () => 1);

		bus.removeAllListeners();

		expect(bus.listenerCount()).toBe(0);
		expect(bus.hasHandler('c')).toBe(true);
		expect(bus.channelNames()).toEqual(['a', 'b', 'c']);
	});

	it('tolerates clearing a channel that was never used', () => {
		const bus = createIcc();

		expect(() => bus.removeAllListeners('unknown')).not.toThrow();
	});

	it('drops channels entirely, listeners and handler alike', () => {
		const bus = createIcc();

		bus.on('a', () => {});
		bus.handle('a', () => 1);
		bus.on('b', () => {});

		bus.removeChannels('a');

		expect(bus.channelNames()).toEqual(['b']);
		expect(bus.hasHandler('a')).toBe(false);
		expect(bus.listenerCount('a')).toBe(0);
	});

	it('drops several channels at once and ignores unknown names', () => {
		const bus = createIcc();

		bus.on('a', () => {});
		bus.on('b', () => {});
		bus.on('c', () => {});

		bus.removeChannels('a', 'c', 'never-existed');

		expect(bus.channelNames()).toEqual(['b']);
	});

	it('resets the whole bus', () => {
		const bus = createIcc();

		bus.on('a', () => {});
		bus.handle('b', () => 1);

		bus.clear();

		expect(bus.channelNames()).toEqual([]);
		expect(bus.listenerCount()).toBe(0);
		expect(bus.hasHandler('b')).toBe(false);
	});

	it('leaves disposers created before a reset safe to call', () => {
		const bus = createIcc();
		const off = bus.on('a', () => {});
		const offHandler = bus.handle('b', () => 1);

		bus.clear();

		expect(off).not.toThrow();
		expect(offHandler).not.toThrow();
		expect(bus.channelNames()).toEqual([]);
	});

	it('keeps a listener from firing after its channel was dropped', () => {
		const bus = createIcc({ scheduler: (task) => task() });
		const listener = vi.fn();

		bus.on('a', listener);
		bus.removeChannels('a');
		bus.sendSync('a', 1);

		expect(listener).not.toHaveBeenCalled();
	});

	it('lets a channel be used again after it was dropped', () => {
		const bus = createIcc({ scheduler: (task) => task() });
		const listener = vi.fn();

		bus.on('a', () => {});
		bus.removeChannels('a');
		bus.on('a', listener);
		bus.sendSync('a', 'again');

		expect(listener).toHaveBeenCalledWith('again');
	});
});

describe('channel names the registry must not choke on', () => {
	const hostile = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];

	it.each(hostile)('treats %s as an ordinary channel', (name) => {
		const bus = createIcc({ scheduler: (task) => task() });
		const listener = vi.fn();

		expect(bus.listenerCount(name)).toBe(0);
		expect(bus.hasHandler(name)).toBe(false);

		bus.on(name, listener);
		bus.sendSync(name, 'payload');

		expect(listener).toHaveBeenCalledWith('payload');
		expect(bus.channelNames()).toEqual([name]);

		bus.removeChannels(name);

		expect(bus.channelNames()).toEqual([]);
	});

	it('does not let a hostile channel name corrupt the prototype chain', () => {
		const bus = createIcc({ scheduler: (task) => task() });

		bus.on('__proto__', () => {});
		bus.sendSync('__proto__', { polluted: true });

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.prototype).not.toHaveProperty('polluted');
	});

	it('accepts the empty string, unicode and very long names', () => {
		const bus = createIcc({ scheduler: (task) => task() });
		const long = 'x'.repeat(10_000);
		const names = ['', 'کانال:پیام', '🚌:ready', 'a b\tc\nd', long];

		for (const name of names) {
			const listener = vi.fn();

			bus.on(name, listener);
			bus.sendSync(name, name);

			expect(listener).toHaveBeenCalledWith(name);
		}

		expect(bus.channelNames()).toEqual(names);
	});
});

describe('isolation', () => {
	it('gives every created bus its own registry', () => {
		const first = createIcc({ scheduler: (task) => task() });
		const second = createIcc({ scheduler: (task) => task() });
		const listener = vi.fn();

		first.on('shared-name', listener);
		second.sendSync('shared-name', 'not yours');

		expect(listener).not.toHaveBeenCalled();
		expect(second.listenerCount('shared-name')).toBe(0);
		expect(first.listenerCount('shared-name')).toBe(1);
	});

	it('keeps handlers of two buses apart', async () => {
		const first = createIcc();
		const second = createIcc();

		first.handle('who', () => 'first');
		second.handle('who', () => 'second');

		await expect(first.invoke('who')).resolves.toBe('first');
		await expect(second.invoke('who')).resolves.toBe('second');
	});

	it('does not let clearing one bus disturb another', () => {
		const first = createIcc();
		const second = createIcc();

		first.on('a', () => {});
		second.on('a', () => {});

		first.clear();

		expect(second.listenerCount('a')).toBe(1);
	});
});
