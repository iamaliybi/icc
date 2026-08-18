/**
 * Callables the bus accepts, the disposer it hands back, and the options that
 * control how long a registration lives.
 *
 * @packageDocumentation
 */

import type { Awaitable, RequestArgs, RequestResult } from './channels';

/**
 * Callback invoked on every emission of an event channel.
 *
 * Listeners answer nothing: a returned value is ignored, and a returned promise
 * is neither awaited nor tracked. Use a request channel when the sender needs
 * an answer.
 *
 * @typeParam P - The payload declared by the channel.
 * @param payload - The value passed to `send`.
 *
 * @example
 * ```ts
 * const onItemAdded: Listener<CartItem> = (item) => console.log(item.id);
 * ```
 *
 * @see {@link RequestHandler} when the caller expects a result.
 */
export type Listener<P> = (payload: P) => void;

/**
 * The single responder of a request channel.
 *
 * May be synchronous or asynchronous: returning `T` and returning `Promise<T>`
 * are equally valid, because `invoke` resolves both the same way.
 *
 * @typeParam F - The `(request) => response` signature declared for the channel.
 *
 * @example Synchronous and asynchronous handlers of the same channel
 * ```ts
 * const sync: RequestHandler<(id: string) => User> = (id) => cache.get(id)!;
 * const async: RequestHandler<(id: string) => User> = (id) => api.fetchUser(id);
 * ```
 */
export type RequestHandler<F> = (...args: RequestArgs<F>) => Awaitable<RequestResult<F>>;

/**
 * Removes the registration it was returned from.
 *
 * Always safe to call more than once, and it only ever removes its own
 * registration — never one made afterwards on the same channel.
 *
 * @example
 * ```ts
 * const off = icc.on('theme:change', applyTheme);
 * off();
 * off(); // no-op
 * ```
 */
export type Unsubscribe = () => void;

/**
 * An `AbortSignal`, or the `AbortController` that owns it.
 *
 * Both are accepted so a teardown scope can be passed around as whichever of
 * the two the surrounding code already holds.
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 *
 * icc.on('a', onA, { signal: controller });        // the controller
 * icc.on('b', onB, { signal: controller.signal }); // or its signal
 * ```
 */
export type AbortLike = AbortSignal | AbortController;

/**
 * Options shared by every registration: how long it lives, and what tears it
 * down.
 */
export interface RegistrationOptions {
	/**
	 * Removes the registration as soon as the signal is aborted, which makes one
	 * controller enough to unregister an entire component.
	 *
	 * An already aborted signal registers nothing at all.
	 *
	 * @example
	 * ```ts
	 * const controller = new AbortController();
	 *
	 * icc.on('theme:change', applyTheme, { signal: controller });
	 * icc.handle('form:validate', validate, { signal: controller });
	 *
	 * controller.abort(); // both are gone
	 * ```
	 */
	signal?: AbortLike;
}

/**
 * Options accepted by `on`.
 *
 * @see {@link IccEventBus.once} for the dedicated one-shot method.
 */
export interface ListenerOptions extends RegistrationOptions {
	/**
	 * Removes the listener right after its first call.
	 *
	 * `on(channel, listener, { once: true })` and `once(channel, listener)` are
	 * exactly equivalent; prefer whichever reads better at the call site.
	 *
	 * @defaultValue `false`
	 */
	once?: boolean;
}

/**
 * Options accepted by `handle`.
 *
 * @see {@link IccRequestBus.handleOnce} for the dedicated one-shot method.
 */
export interface HandlerOptions extends RegistrationOptions {
	/**
	 * Removes the handler right after it has answered a single `invoke`.
	 *
	 * `handle(channel, handler, { once: true })` and `handleOnce(channel,
	 * handler)` are exactly equivalent.
	 *
	 * @defaultValue `false`
	 */
	once?: boolean;
}

/**
 * Options accepted by `waitFor`.
 */
export interface WaitForOptions extends RegistrationOptions {
	/**
	 * Milliseconds to wait before giving up. The returned promise then rejects
	 * with an `IccError` carrying `code: 'ERR_ICC_TIMEOUT'`.
	 *
	 * @defaultValue No timeout: the promise waits indefinitely.
	 *
	 * @example
	 * ```ts
	 * await icc.waitFor('app:ready', { timeout: 5_000 });
	 * ```
	 */
	timeout?: number;
}
