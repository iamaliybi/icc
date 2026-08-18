/**
 * The contracts a bus fulfils, split by role so a consumer can depend on the
 * narrow slice it actually uses:
 *
 * - {@link IccEventBus} — broadcasting, for many listeners and no answer.
 * - {@link IccRequestBus} — calling, for one responder and one answer.
 * - {@link IccChannelAdmin} — introspection and teardown of the registry.
 * - {@link IccBus} — all three, which is what {@link Icc} implements.
 *
 * A component that only publishes should accept an `IccEventBus`, not the whole
 * bus: the narrower the parameter, the easier it is to substitute in a test.
 *
 * @packageDocumentation
 */

import type {
	EventChannel,
	EventMap,
	PayloadArgs,
	RequestArgs,
	RequestChannel,
	RequestMap,
	RequestResult,
	ResolvedEvents,
	ResolvedRequests,
} from './channels';
import type {
	HandlerOptions,
	Listener,
	ListenerOptions,
	RequestHandler,
	Unsubscribe,
	WaitForOptions,
} from './handlers';

/**
 * The broadcast half of a bus: **many listeners, no answer**.
 *
 * Nothing travels back to the sender, so a payload is all a channel carries.
 * When the sender needs a result, use {@link IccRequestBus} instead.
 *
 * @typeParam E - The event map, mapping each channel to its payload.
 *
 * @example
 * ```ts
 * const subscribe = (bus: IccEventBus): Unsubscribe =>
 *   bus.on('cart:item-added', (item) => render(item));
 * ```
 */
export interface IccEventBus<E extends EventMap<E> = ResolvedEvents> {
	/**
	 * Subscribes to every emission of a channel.
	 *
	 * @typeParam C - The channel being subscribed to.
	 * @param channel - Channel to listen on.
	 * @param listener - Called with the payload of each emission.
	 * @param options - `once` to stop after the first call, `signal` to tie the
	 * subscription to an `AbortController`.
	 * @returns A disposer removing this listener. Calling it twice is a no-op.
	 *
	 * @example
	 * ```ts
	 * const off = bus.on('theme:change', (theme) => applyTheme(theme));
	 * off();
	 * ```
	 *
	 * @example Tying the subscription to a component lifetime
	 * ```ts
	 * bus.on('theme:change', applyTheme, { signal: controller });
	 * ```
	 *
	 * @remarks
	 * Subscribing or unsubscribing from inside a listener is safe: the running
	 * dispatch keeps its own snapshot, and a removal takes effect immediately.
	 */
	on<C extends EventChannel<E>>(
		channel: C,
		listener: Listener<E[C]>,
		options?: ListenerOptions,
	): Unsubscribe;

	/**
	 * Subscribes to the next emission of a channel only.
	 *
	 * Identical to `on(channel, listener, { once: true })`.
	 *
	 * @typeParam C - The channel being subscribed to.
	 * @param channel - Channel to listen on.
	 * @param listener - Called once, then removed.
	 * @param options - `signal` to drop the subscription before it ever fires.
	 * @returns A disposer removing the listener if it has not fired yet.
	 *
	 * @example
	 * ```ts
	 * bus.once('app:ready', () => hideSplashScreen());
	 * ```
	 *
	 * @see {@link IccEventBus.waitFor} to await the next emission instead.
	 */
	once<C extends EventChannel<E>>(
		channel: C,
		listener: Listener<E[C]>,
		options?: Omit<ListenerOptions, 'once'>,
	): Unsubscribe;

	/**
	 * Removes a listener by reference.
	 *
	 * Prefer the disposer returned by `on`; this exists for the cases where the
	 * function is easier to reach than its disposer.
	 *
	 * @typeParam C - The channel to remove from.
	 * @param channel - Channel the listener was registered on.
	 * @param listener - The exact function reference passed to `on` or `once`.
	 * @returns `true` when a matching listener was found and removed.
	 *
	 * @example
	 * ```ts
	 * bus.on('theme:change', applyTheme);
	 * bus.off('theme:change', applyTheme); // true
	 * ```
	 */
	off<C extends EventChannel<E>>(channel: C, listener: Listener<E[C]>): boolean;

	/**
	 * Broadcasts a payload to every listener of a channel, **after the current
	 * call stack unwinds**.
	 *
	 * Deferring is what keeps an emit from re-entering the emitting component
	 * mid-render, so this is the form to reach for by default.
	 *
	 * @typeParam C - The channel being broadcast on.
	 * @param channel - Channel to broadcast on.
	 * @param payload - The value handed to every listener. Omitted entirely on a
	 * channel declared as `void`.
	 *
	 * @example
	 * ```ts
	 * bus.send('cart:item-added', { id: 'sku-1', qty: 2 });
	 * bus.send('modal:close'); // declared as `void`
	 * ```
	 *
	 * @remarks
	 * Returns nothing, on purpose: a broadcast has no result and no failure to
	 * report. A listener that throws is sent to `onError` and the remaining
	 * listeners still run.
	 *
	 * @see {@link IccEventBus.sendSync} to dispatch before this call returns.
	 * @see {@link IccRequestBus.invoke} when an answer is needed.
	 */
	send<C extends EventChannel<E>>(channel: C, ...payload: PayloadArgs<E[C]>): void;

	/**
	 * Broadcasts a payload **before this call returns**.
	 *
	 * Reach for it only when a listener has to run inside the current task —
	 * inside a `beforeunload` handler, for instance, where a deferred dispatch
	 * would never happen.
	 *
	 * @typeParam C - The channel being broadcast on.
	 * @param channel - Channel to broadcast on.
	 * @param payload - The value handed to every listener. Omitted entirely on a
	 * channel declared as `void`.
	 *
	 * @example
	 * ```ts
	 * window.addEventListener('beforeunload', () => {
	 *   bus.sendSync('app:teardown');
	 * });
	 * ```
	 */
	sendSync<C extends EventChannel<E>>(channel: C, ...payload: PayloadArgs<E[C]>): void;

	/**
	 * Waits for the next emission of a channel and resolves with its payload.
	 *
	 * The promise-shaped counterpart of `once`, for code that reads better as a
	 * sequence of awaits than as a callback.
	 *
	 * @typeParam C - The channel being awaited.
	 * @param channel - Channel to wait on.
	 * @param options - `timeout` in milliseconds, `signal` to cancel the wait.
	 * @returns A promise resolving with the payload of the next emission.
	 *
	 * @throws An `IccError` with `code: 'ERR_ICC_TIMEOUT'` when `timeout` elapses
	 * first; the reason of the `signal` when the wait is aborted, or an `IccError`
	 * with `code: 'ERR_ICC_ABORTED'` when the signal carries none.
	 *
	 * @example
	 * ```ts
	 * await bus.waitFor('app:ready', { timeout: 5_000 });
	 * const theme = await bus.waitFor('theme:change');
	 * ```
	 *
	 * @remarks
	 * The underlying listener is always removed, whether the promise settles,
	 * times out or is aborted.
	 */
	waitFor<C extends EventChannel<E>>(channel: C, options?: WaitForOptions): Promise<E[C]>;
}

/**
 * The request half of a bus: **one responder, one answer**.
 *
 * A channel holds at most one handler, and `invoke` always answers through a
 * promise — whether the handler is synchronous or not.
 *
 * @typeParam R - The request map, mapping each channel to a
 * `(request) => response` signature.
 *
 * @example
 * ```ts
 * bus.handle('user:fetch', (id) => api.fetchUser(id));
 * const user = await bus.invoke('user:fetch', 'u_42');
 * ```
 */
export interface IccRequestBus<R extends RequestMap<R> = ResolvedRequests> {
	/**
	 * Registers the single responder of a request channel.
	 *
	 * The handler may be synchronous or asynchronous; `invoke` resolves both the
	 * same way. Registering again replaces the previous handler.
	 *
	 * @typeParam C - The channel being answered.
	 * @param channel - Channel to answer.
	 * @param handler - Receives the request, returns the response or a promise of it.
	 * @param options - `once` to answer a single request, `signal` to tie the
	 * handler to an `AbortController`.
	 * @returns A disposer removing this handler. It never removes a handler
	 * registered after it.
	 *
	 * @example Synchronous and asynchronous handlers
	 * ```ts
	 * bus.handle('app:version', () => '1.4.0');
	 * bus.handle('user:fetch', async (id) => (await fetch(`/users/${id}`)).json());
	 * ```
	 *
	 * @remarks
	 * A handler that throws or rejects hands the failure to the caller of
	 * `invoke` untouched; it is never swallowed into the console.
	 */
	handle<C extends RequestChannel<R>>(
		channel: C,
		handler: RequestHandler<R[C]>,
		options?: HandlerOptions,
	): Unsubscribe;

	/**
	 * Registers a responder that answers a single request, then steps down.
	 *
	 * Identical to `handle(channel, handler, { once: true })`.
	 *
	 * @typeParam C - The channel being answered.
	 * @param channel - Channel to answer.
	 * @param handler - Answers exactly one `invoke`, then is removed.
	 * @param options - `signal` to drop the handler before it is ever called.
	 * @returns A disposer removing the handler if it has not answered yet.
	 *
	 * @example
	 * ```ts
	 * bus.handleOnce('auth:token', () => readTokenFromUrl());
	 * ```
	 */
	handleOnce<C extends RequestChannel<R>>(
		channel: C,
		handler: RequestHandler<R[C]>,
		options?: Omit<HandlerOptions, 'once'>,
	): Unsubscribe;

	/**
	 * Sends a request to the handler of a channel and resolves with its answer.
	 *
	 * Always returns a promise, even when the handler is synchronous, so a call
	 * site never has to know how the other side is implemented.
	 *
	 * @typeParam C - The channel being called.
	 * @param channel - Channel to call.
	 * @param request - The arguments declared by the channel signature.
	 * @returns A promise resolving with the declared response.
	 *
	 * @throws An `IccError` with `code: 'ERR_ICC_NO_HANDLER'` when no handler is
	 * registered, or whatever the handler threw or rejected with.
	 *
	 * @example
	 * ```ts
	 * const user = await bus.invoke('user:fetch', 'u_42');
	 * const version = await bus.invoke('app:version'); // no request payload
	 * ```
	 *
	 * @example Reacting to a channel nobody answers
	 * ```ts
	 * if (bus.hasHandler('user:fetch')) {
	 *   const user = await bus.invoke('user:fetch', 'u_42');
	 * }
	 * ```
	 */
	invoke<C extends RequestChannel<R>>(
		channel: C,
		...request: RequestArgs<R[C]>
	): Promise<RequestResult<R[C]>>;

	/**
	 * Whether a channel currently has a handler.
	 *
	 * @param channel - Channel to check.
	 * @returns `true` when an `invoke` on this channel would reach a handler.
	 *
	 * @example
	 * ```ts
	 * if (!bus.hasHandler('user:fetch')) renderOfflinePlaceholder();
	 * ```
	 */
	hasHandler(channel: RequestChannel<R>): boolean;

	/**
	 * Removes the handler of a channel, leaving its listeners untouched.
	 *
	 * @param channel - Channel to leave unanswered.
	 *
	 * @example
	 * ```ts
	 * bus.removeHandler('user:fetch');
	 * bus.hasHandler('user:fetch'); // false
	 * ```
	 */
	removeHandler(channel: RequestChannel<R>): void;
}

/**
 * Introspection and teardown of the channel registry.
 *
 * Useful in tests, in devtools panels, and anywhere a scope has to be reset
 * without holding on to every disposer it created.
 *
 * @typeParam E - The event map.
 * @typeParam R - The request map.
 *
 * @example Resetting the shared bus between tests
 * ```ts
 * afterEach(() => icc.clear());
 * ```
 */
export interface IccChannelAdmin<
	E extends EventMap<E> = ResolvedEvents,
	R extends RequestMap<R> = ResolvedRequests,
> {
	/**
	 * Counts active listeners.
	 *
	 * @param channel - Channel to count on. Counts every channel when omitted.
	 * @returns The number of listeners currently registered.
	 *
	 * @example
	 * ```ts
	 * bus.listenerCount('theme:change'); // 2
	 * bus.listenerCount();               // 7, across the whole bus
	 * ```
	 *
	 * @remarks Handlers are not listeners; use `hasHandler` for those.
	 */
	listenerCount(channel?: EventChannel<E>): number;

	/**
	 * Lists every channel the bus knows about, whether it holds listeners, a
	 * handler, or has simply been used before.
	 *
	 * @returns The channel names, in registration order.
	 *
	 * @example
	 * ```ts
	 * console.table(bus.channelNames().map((name) => ({
	 *   name,
	 *   listeners: bus.listenerCount(name),
	 * })));
	 * ```
	 */
	channelNames(): string[];

	/**
	 * Removes listeners without touching handlers.
	 *
	 * @param channel - Channel to clear. Clears every channel when omitted.
	 *
	 * @example
	 * ```ts
	 * bus.removeAllListeners('theme:change');
	 * bus.removeAllListeners();
	 * ```
	 */
	removeAllListeners(channel?: EventChannel<E>): void;

	/**
	 * Drops one or more channels entirely — listeners, handler and registration.
	 *
	 * @param channels - Channels to drop. Unknown names are ignored.
	 *
	 * @example
	 * ```ts
	 * bus.removeChannels('cart:item-added', 'cart:item-removed');
	 * ```
	 */
	removeChannels(...channels: Array<EventChannel<E> | RequestChannel<R>>): void;

	/**
	 * Resets the bus to its initial, empty state.
	 *
	 * @example
	 * ```ts
	 * afterEach(() => bus.clear());
	 * ```
	 *
	 * @remarks
	 * Disposers created before the reset stay safe to call; they simply have
	 * nothing left to remove.
	 */
	clear(): void;
}

/**
 * A complete bus: broadcasting, calling and registry administration.
 *
 * This is the type of the shared `icc` instance and of anything `createIcc`
 * returns. Depend on it when a unit needs both halves; depend on
 * {@link IccEventBus} or {@link IccRequestBus} when it needs one.
 *
 * @typeParam E - The event map, mapping each channel to its payload.
 * @typeParam R - The request map, mapping each channel to a `(request) => response`.
 *
 * @example
 * ```ts
 * const wire = (bus: IccBus): void => {
 *   bus.handle('app:version', () => VERSION);
 *   bus.on('app:ready', () => bus.send('analytics:track', { name: 'ready' }));
 * };
 * ```
 */
export interface IccBus<
	E extends EventMap<E> = ResolvedEvents,
	R extends RequestMap<R> = ResolvedRequests,
> extends IccEventBus<E>, IccRequestBus<R>, IccChannelAdmin<E, R> {}
