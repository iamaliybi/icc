import { Icc } from './icc';
import type { EventMap, IccOptions, RequestMap, ResolvedEvents, ResolvedRequests } from './types';

export { Icc } from './icc';
export type { IccError } from './internal';
export type {
	AbortLike,
	Awaitable,
	Channel,
	ErrorContext,
	EventArgs,
	EventMap,
	HandlerOptions,
	IccEvents,
	IccOptions,
	IccRequests,
	Listener,
	ListenerOptions,
	RequestArgs,
	RequestHandler,
	RequestMap,
	RequestResult,
	ResolvedEvents,
	ResolvedRequests,
	Unsubscribe,
	Unwrap,
} from './types';

/**
 * Creates an isolated bus. Use it to scope channels to a feature, a widget or a
 * single test, instead of sharing the application-wide {@link icc} instance.
 */
export function createIcc<E extends EventMap<E> = ResolvedEvents, R extends RequestMap<R> = ResolvedRequests>(
	options?: IccOptions,
): Icc<E, R> {
	return new Icc<E, R>(options);
}

/**
 * Version tag is part of the key on purpose: two majors loaded side by side get
 * their own bus instead of silently sharing an incompatible registry.
 */
const GLOBAL_KEY = '__ICC_DEFAULT_BUS_V1__';

function getGlobalScope(): Record<string, unknown> | undefined {
	if (typeof globalThis !== 'undefined') return globalThis as unknown as Record<string, unknown>;
	if (typeof self !== 'undefined') return self as unknown as Record<string, unknown>;
	if (typeof window !== 'undefined') return window as unknown as Record<string, unknown>;

	return undefined;
}

function resolveDefaultBus(): Icc {
	const scope = getGlobalScope();
	if (scope === undefined) return new Icc();

	const existing = scope[GLOBAL_KEY];

	// Duck-typed rather than `instanceof`: a bundle shipping both the ESM and the
	// CJS build would otherwise end up with two buses that cannot talk to each other.
	if (existing !== null && typeof existing === 'object') return existing as Icc;

	const created = new Icc();
	scope[GLOBAL_KEY] = created;

	return created;
}

/**
 * The application-wide bus, shared by every module that imports it.
 *
 * ```ts
 * import icc from 'icc';
 *
 * const off = icc.on('cart:item-added', (item) => console.log(item));
 * icc.send('cart:item-added', { id: 'sku-1', qty: 2 });
 * off();
 * ```
 */
export const icc: Icc = resolveDefaultBus();

export default icc;
