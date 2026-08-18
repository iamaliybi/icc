/**
 * **icc** — Inter-Component Communication.
 *
 * A strongly typed, zero-dependency bus letting components that have no direct
 * relationship talk to each other, with the API shape of the Electron IPC
 * module:
 *
 * - `send` / `on` broadcast a payload to any number of listeners;
 * - `invoke` / `handle` call the single responder of a channel and await its answer.
 *
 * Start from the shared {@link icc} instance, and reach for {@link createIcc}
 * when a feature or a test needs a registry of its own.
 *
 * @packageDocumentation
 */

import { Icc } from './icc';
import type { EventMap, RequestMap, ResolvedEvents, ResolvedRequests } from './types/channels';
import type { IccOptions } from './types/options';

export { Icc } from './icc';

export type {
	AbortLike,
	Awaitable,
	ErrorContext,
	ErrorReporter,
	EventChannel,
	EventMap,
	EventPayload,
	HandlerOptions,
	IccBus,
	IccChannelAdmin,
	IccError,
	IccErrorCode,
	IccEventBus,
	IccEvents,
	IccOptions,
	IccRequestBus,
	IccRequests,
	Listener,
	ListenerOptions,
	PayloadArgs,
	RegistrationOptions,
	RequestArgs,
	RequestChannel,
	RequestHandler,
	RequestMap,
	RequestResult,
	ResolvedEvents,
	ResolvedRequests,
	Scheduler,
	Unsubscribe,
	Unwrap,
	WaitForOptions,
} from './types';

/**
 * Creates a bus with its own channel registry.
 *
 * Use it to scope channels to a feature, a widget or a single test, instead of
 * sharing the application-wide {@link icc} instance — two buses never see each
 * other's channels, even under the same names.
 *
 * @typeParam E - The event map. Defaults to the augmented {@link IccEvents}.
 * @typeParam R - The request map. Defaults to the augmented {@link IccRequests}.
 * @param options - `onError` to route listener failures somewhere other than
 * the console, `scheduler` to decide when a deferred broadcast runs.
 * @returns A bus that shares nothing with any other instance.
 *
 * @example A bus scoped to one feature, typed inline
 * ```ts
 * import { createIcc } from 'icc-js';
 *
 * interface CheckoutEvents { 'step:changed': number }
 * interface CheckoutRequests { 'cart:total': () => number }
 *
 * const checkout = createIcc<CheckoutEvents, CheckoutRequests>();
 *
 * checkout.handle('cart:total', () => 42);
 * checkout.send('step:changed', 2);
 * ```
 *
 * @example A bus that dispatches synchronously, for tests
 * ```ts
 * const bus = createIcc({ scheduler: (task) => task() });
 * ```
 *
 * @see {@link icc} for the shared instance.
 */
export const createIcc = <
	E extends EventMap<E> = ResolvedEvents,
	R extends RequestMap<R> = ResolvedRequests,
>(options?: IccOptions): Icc<E, R> => new Icc<E, R>(options);

/**
 * Version tag is part of the key on purpose: two majors loaded side by side get
 * a bus each, instead of silently sharing an incompatible registry.
 */
const GLOBAL_KEY = '__ICC_DEFAULT_BUS_V1__';

/** The global object of whichever environment the bundle ended up in. */
const getGlobalScope = (): Record<string, unknown> | undefined => {
	if (typeof globalThis !== 'undefined') return globalThis as unknown as Record<string, unknown>;
	if (typeof self !== 'undefined') return self as unknown as Record<string, unknown>;
	if (typeof window !== 'undefined') return window as unknown as Record<string, unknown>;

	return undefined;
};

/** Returns the shared bus, creating and publishing it on first use. */
const resolveDefaultBus = (): Icc => {
	const scope = getGlobalScope();
	if (scope === undefined) return new Icc();

	const existing = scope[GLOBAL_KEY];

	// Duck-typed rather than `instanceof`: an application pulling in both the ESM
	// and the CJS build would otherwise end up with two buses unable to talk.
	if (existing !== null && typeof existing === 'object') return existing as Icc;

	const created = new Icc();
	scope[GLOBAL_KEY] = created;

	return created;
};

/**
 * The application-wide bus, shared by every module that imports it.
 *
 * Also the default export, so `import icc from 'icc-js'` and
 * `import { icc } from 'icc-js'` give you the same instance.
 *
 * @example
 * ```ts
 * import icc from 'icc-js';
 *
 * const off = icc.on('cart:item-added', (item) => badge.increment(item.qty));
 * icc.send('cart:item-added', { id: 'sku-1', qty: 2 });
 * off();
 * ```
 *
 * @remarks
 * Resolved through a versioned key on the global object, so a single instance
 * survives an application loading both the ESM and the CommonJS build.
 *
 * @see {@link createIcc} for an isolated bus.
 */
export const icc: Icc = resolveDefaultBus();

export default icc;
