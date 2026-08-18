/**
 * Type-level suite. Nothing here runs: every assertion is checked by the
 * compiler through `vitest --typecheck`, which also verifies that each
 * `@ts-expect-error` really is an error.
 */

import { assertType, describe, expectTypeOf, it } from 'vitest';

import icc, { createIcc, Icc } from '../src/index';
import type { IccBus, IccChannelAdmin, IccError, IccEventBus, IccRequestBus, Unsubscribe } from '../src/index';

interface Events {
	'cart:add': { id: string; qty: number };
	'theme:change': 'dark' | 'light';
	'modal:close': void;
}

interface Requests {
	'user:fetch': (id: string) => { name: string };
	'app:version': () => string;
	'report:build': (from: Date, to: Date) => Promise<Blob>;
}

const bus = createIcc<Events, Requests>();

describe('event channels', () => {
	it('infers the payload of a listener', () => {
		bus.on('cart:add', (payload) => {
			expectTypeOf(payload).toEqualTypeOf<{ id: string; qty: number }>();
		});

		bus.on('theme:change', (payload) => {
			expectTypeOf(payload).toEqualTypeOf<'dark' | 'light'>();
		});
	});

	it('returns a disposer from every registration', () => {
		expectTypeOf(bus.on('modal:close', () => {})).toEqualTypeOf<Unsubscribe>();
		expectTypeOf(bus.once('modal:close', () => {})).toEqualTypeOf<Unsubscribe>();
		expectTypeOf(bus.handle('app:version', () => '1')).toEqualTypeOf<Unsubscribe>();
	});

	it('requires the declared payload and refuses anything else', () => {
		bus.send('cart:add', { id: 'a', qty: 1 });
		bus.sendSync('theme:change', 'dark');

		// @ts-expect-error the payload is required
		bus.send('cart:add');
		// @ts-expect-error qty is a number
		bus.send('cart:add', { id: 'a', qty: '1' });
		// @ts-expect-error 'blue' is outside the declared union
		bus.send('theme:change', 'blue');
		// @ts-expect-error the channel is not declared
		bus.send('cart:remove', { id: 'a' });
	});

	it('takes no payload at all on a void channel', () => {
		bus.send('modal:close');
		bus.sendSync('modal:close');

		// @ts-expect-error a void channel carries nothing
		bus.send('modal:close', 'something');
	});

	it('returns nothing from a broadcast', () => {
		expectTypeOf(bus.send('modal:close')).toBeVoid();
		expectTypeOf(bus.sendSync('modal:close')).toBeVoid();
	});

	it('resolves waitFor with the payload of the channel', () => {
		expectTypeOf(bus.waitFor('cart:add')).resolves.toEqualTypeOf<{ id: string; qty: number }>();
		expectTypeOf(bus.waitFor('theme:change', { timeout: 10 })).resolves.toEqualTypeOf<'dark' | 'light'>();

		// @ts-expect-error the channel is not declared
		void bus.waitFor('nope');
	});

	it('keeps the one-shot option off the dedicated one-shot method', () => {
		bus.on('modal:close', () => {}, { once: true });

		// @ts-expect-error `once` is the method, not an option of it
		bus.once('modal:close', () => {}, { once: true });
	});
});

describe('request channels', () => {
	it('derives the request arguments from the declared signature', () => {
		bus.handle('user:fetch', (id) => {
			expectTypeOf(id).toEqualTypeOf<string>();

			return { name: id };
		});

		bus.handle('report:build', (from, to) => {
			expectTypeOf(from).toEqualTypeOf<Date>();
			expectTypeOf(to).toEqualTypeOf<Date>();

			return new Blob();
		});
	});

	it('accepts a synchronous or an asynchronous handler for the same channel', () => {
		bus.handle('user:fetch', (id) => ({ name: id }));
		bus.handle('user:fetch', async (id) => ({ name: id }));
		bus.handleOnce('app:version', async () => '1.0.0');
	});

	it('always resolves invoke with the plain response type', () => {
		expectTypeOf(bus.invoke('user:fetch', 'u1')).resolves.toEqualTypeOf<{ name: string }>();
		expectTypeOf(bus.invoke('app:version')).resolves.toEqualTypeOf<string>();
		// A handler declared as async still resolves to the unwrapped value.
		expectTypeOf(bus.invoke('report:build', new Date(), new Date())).resolves.toEqualTypeOf<Blob>();
	});

	it('refuses a wrong request or a wrong response', () => {
		// @ts-expect-error the id argument is required
		void bus.invoke('user:fetch');
		// @ts-expect-error the id is a string
		void bus.invoke('user:fetch', 42);
		// @ts-expect-error the response must match the declaration
		bus.handle('app:version', () => 42);
		// @ts-expect-error the channel is not declared
		bus.handle('nope', () => 1);
	});
});

describe('the role interfaces', () => {
	it('are all satisfied by a bus', () => {
		assertType<IccEventBus<Events>>(bus);
		assertType<IccRequestBus<Requests>>(bus);
		assertType<IccChannelAdmin<Events, Requests>>(bus);
		assertType<IccBus<Events, Requests>>(bus);
		assertType<Icc<Events, Requests>>(bus);
	});

	it('expose only their own half', () => {
		const events: IccEventBus<Events> = bus;
		const requests: IccRequestBus<Requests> = bus;

		events.send('modal:close');
		void requests.invoke('app:version');

		// @ts-expect-error requests are not part of the event half
		events.invoke('app:version');
		// @ts-expect-error broadcasts are not part of the request half
		requests.send('modal:close');
		// @ts-expect-error administration is its own role
		events.clear();
	});
});

describe('the registry half', () => {
	it('accepts channels of both maps where it should', () => {
		bus.removeChannels('cart:add', 'user:fetch');
		bus.removeAllListeners('theme:change');
		bus.removeHandler('app:version');

		expectTypeOf(bus.listenerCount()).toEqualTypeOf<number>();
		expectTypeOf(bus.hasHandler('app:version')).toEqualTypeOf<boolean>();
		expectTypeOf(bus.channelNames()).toEqualTypeOf<string[]>();

		// @ts-expect-error a request channel has no listeners to remove
		bus.removeAllListeners('user:fetch');
		// @ts-expect-error an event channel has no handler to remove
		bus.removeHandler('cart:add');
	});
});

describe('the undeclared default bus', () => {
	it('accepts any channel with an unknown payload', () => {
		icc.on('anything', (payload) => {
			expectTypeOf(payload).toBeUnknown();
		});

		icc.send('anything', 123);
		icc.send('anything');
		void icc.invoke('whatever');
	});
});

describe('errors', () => {
	it('describe the failures the bus produces', () => {
		expectTypeOf<IccError>().toExtend<Error>();
		expectTypeOf<IccError['code']>().toEqualTypeOf<'ERR_ICC_NO_HANDLER' | 'ERR_ICC_TIMEOUT' | 'ERR_ICC_ABORTED'>();
		expectTypeOf<IccError['channel']>().toEqualTypeOf<string>();
	});
});
