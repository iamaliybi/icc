import { ChannelRegistry } from './internal/channel-registry';
import { EventDispatcher } from './internal/event-dispatcher';
import { RequestBroker } from './internal/request-broker';
import { createIccError, defaultErrorReporter } from './internal/errors';
import { defaultScheduler } from './internal/scheduler';
import { noop, toSignal } from './internal/signals';
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
} from './types/channels';
import type {
	HandlerOptions,
	Listener,
	ListenerOptions,
	RequestHandler,
	Unsubscribe,
	WaitForOptions,
} from './types/handlers';
import type { IccBus } from './types/contracts';
import type { IccOptions } from './types/options';

/**
 * A strongly typed communication bus for components that have no direct
 * relationship, modelled after the Electron IPC API.
 *
 * Pick the half that matches the conversation:
 *
 * | Need | Use | Shape |
 * | --- | --- | --- |
 * | Tell everyone something happened | `send` + `on` | many listeners, no answer |
 * | Ask someone for a value | `invoke` + `handle` | one responder, one answer |
 *
 * Both halves share one channel registry, so a channel name is either an event
 * or a request — never quietly both.
 *
 * @typeParam E - The event map, mapping each channel to its payload. Defaults to
 * the augmented {@link IccEvents}.
 * @typeParam R - The request map, mapping each channel to a `(request) =>
 * response` signature. Defaults to the augmented {@link IccRequests}.
 *
 * @example Broadcasting between two unrelated components
 * ```ts
 * import icc from 'icc';
 *
 * // In the product card
 * icc.send('cart:item-added', { id: 'sku-1', qty: 2 });
 *
 * // In the header, which knows nothing about the card
 * const off = icc.on('cart:item-added', (item) => badge.increment(item.qty));
 * ```
 *
 * @example Asking a component that owns the data
 * ```ts
 * icc.handle('user:fetch', (id) => api.fetchUser(id));
 *
 * const user = await icc.invoke('user:fetch', 'u_42');
 * ```
 *
 * @example An isolated bus, scoped to a feature or a test
 * ```ts
 * import { createIcc } from 'icc';
 *
 * const bus = createIcc<CheckoutEvents, CheckoutRequests>();
 * ```
 *
 * @remarks
 * The class composes three collaborators, each owning one concern: a registry
 * that stores channels, a dispatcher that broadcasts, and a broker that answers
 * requests. Timing and failure reporting are injected through `options`, so the
 * bus never reaches for `queueMicrotask` or `console` on its own.
 *
 * @see {@link IccBus} for the contract, and {@link IccEventBus} /
 * {@link IccRequestBus} for the narrower halves of it.
 */
export class Icc<
	E extends EventMap<E> = ResolvedEvents,
	R extends RequestMap<R> = ResolvedRequests,
> implements IccBus<E, R> {
	private readonly _registry: ChannelRegistry;

	private readonly _events: EventDispatcher;

	private readonly _requests: RequestBroker;

	/**
	 * Creates a bus with its own, empty channel registry.
	 *
	 * @param options - `onError` to route listener failures somewhere other than
	 * the console, `scheduler` to decide when a deferred broadcast runs.
	 *
	 * @example
	 * ```ts
	 * const bus = new Icc({
	 *   onError: (error, { channel }) => reportToSentry(error, { channel }),
	 *   scheduler: (task) => task(), // synchronous dispatch, handy in tests
	 * });
	 * ```
	 */
	public constructor(options?: IccOptions) {
		const onError = options !== undefined && typeof options.onError === 'function'
			? options.onError
			: defaultErrorReporter;

		const scheduler = options !== undefined && typeof options.scheduler === 'function'
			? options.scheduler
			: defaultScheduler;

		this._registry = new ChannelRegistry();
		this._events = new EventDispatcher(this._registry, scheduler, onError);
		this._requests = new RequestBroker(this._registry);
	}

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
	 * const off = icc.on('theme:change', (theme) => applyTheme(theme));
	 * off();
	 * ```
	 *
	 * @example Tying the subscription to a component lifetime
	 * ```ts
	 * icc.on('theme:change', applyTheme, { signal: controller });
	 * ```
	 *
	 * @remarks
	 * Subscribing or unsubscribing from inside a listener is safe: the running
	 * dispatch keeps its own snapshot, and a removal takes effect immediately.
	 *
	 * @see {@link Icc.once} for a one-shot subscription.
	 */
	public on<C extends EventChannel<E>>(
		channel: C,
		listener: Listener<E[C]>,
		options?: ListenerOptions,
	): Unsubscribe {
		const once = options !== undefined && options.once === true;

		return this._events.add(channel, listener, once, toSignal(options && options.signal));
	}

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
	 * icc.once('app:ready', () => hideSplashScreen());
	 * ```
	 *
	 * @see {@link Icc.waitFor} to await the next emission instead of handling it.
	 */
	public once<C extends EventChannel<E>>(
		channel: C,
		listener: Listener<E[C]>,
		options?: Omit<ListenerOptions, 'once'>,
	): Unsubscribe {
		return this._events.add(channel, listener, true, toSignal(options && options.signal));
	}

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
	 * icc.on('theme:change', applyTheme);
	 * icc.off('theme:change', applyTheme); // true
	 * ```
	 */
	public off<C extends EventChannel<E>>(channel: C, listener: Listener<E[C]>): boolean {
		return this._events.remove(channel, listener);
	}

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
	 * icc.send('cart:item-added', { id: 'sku-1', qty: 2 });
	 * icc.send('modal:close'); // declared as `void`
	 * ```
	 *
	 * @remarks
	 * Returns nothing, on purpose: a broadcast has no result and no failure to
	 * report. A listener that throws is sent to `onError` and the remaining
	 * listeners still run.
	 *
	 * @see {@link Icc.sendSync} to dispatch before this call returns.
	 * @see {@link Icc.invoke} when an answer is needed.
	 */
	public send<C extends EventChannel<E>>(channel: C, ...payload: PayloadArgs<E[C]>): void {
		this._events.defer(channel, payload[0]);
	}

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
	 *   icc.sendSync('app:teardown');
	 * });
	 * ```
	 *
	 * @see {@link Icc.send} for the deferred default.
	 */
	public sendSync<C extends EventChannel<E>>(channel: C, ...payload: PayloadArgs<E[C]>): void {
		this._events.emit(channel, payload[0]);
	}

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
	 * await icc.waitFor('app:ready', { timeout: 5_000 });
	 * const theme = await icc.waitFor('theme:change');
	 * ```
	 *
	 * @remarks
	 * The underlying listener is always removed, whether the promise settles,
	 * times out or is aborted.
	 */
	public waitFor<C extends EventChannel<E>>(channel: C, options?: WaitForOptions): Promise<E[C]> {
		const signal = toSignal(options && options.signal);
		const timeout = options !== undefined ? options.timeout : undefined;

		return new Promise<E[C]>((resolve, reject): void => {
			if (signal !== undefined && signal.aborted) {
				reject(abortReason(signal, channel));

				return;
			}

			let timer: ReturnType<typeof setTimeout> | undefined;
			let stopListening: () => void = noop;
			let stopWatchingSignal: () => void = noop;

			const cleanUp = (): void => {
				if (timer !== undefined) clearTimeout(timer);

				stopListening();
				stopWatchingSignal();
			};

			stopListening = this._events.add(channel, (payload: unknown): void => {
				cleanUp();
				resolve(payload as E[C]);
			}, true, undefined);

			if (signal !== undefined) {
				stopWatchingSignal = watchAbort(signal, (): void => {
					cleanUp();
					reject(abortReason(signal, channel));
				});
			}

			if (typeof timeout === 'number' && isFinite(timeout)) {
				timer = setTimeout((): void => {
					cleanUp();
					reject(createIccError(
						'ERR_ICC_TIMEOUT',
						channel,
						'Timed out after ' + timeout + 'ms waiting for channel "' + channel + '".',
					));
				}, timeout);
			}
		});
	}

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
	 * icc.handle('app:version', () => '1.4.0');
	 * icc.handle('user:fetch', async (id) => (await fetch(`/users/${id}`)).json());
	 * ```
	 *
	 * @remarks
	 * A handler that throws or rejects hands the failure to the caller of
	 * `invoke` untouched; it is never swallowed into the console.
	 *
	 * @see {@link Icc.handleOnce} for a one-shot responder.
	 */
	public handle<C extends RequestChannel<R>>(
		channel: C,
		handler: RequestHandler<R[C]>,
		options?: HandlerOptions,
	): Unsubscribe {
		const once = options !== undefined && options.once === true;

		return this._requests.set(
			channel,
			handler as (...args: any[]) => any,
			once,
			toSignal(options && options.signal),
		);
	}

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
	 * icc.handleOnce('auth:token', () => readTokenFromUrl());
	 * ```
	 */
	public handleOnce<C extends RequestChannel<R>>(
		channel: C,
		handler: RequestHandler<R[C]>,
		options?: Omit<HandlerOptions, 'once'>,
	): Unsubscribe {
		return this._requests.set(
			channel,
			handler as (...args: any[]) => any,
			true,
			toSignal(options && options.signal),
		);
	}

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
	 * const user = await icc.invoke('user:fetch', 'u_42');
	 * const version = await icc.invoke('app:version'); // no request payload
	 * ```
	 *
	 * @example Reacting to a channel nobody answers
	 * ```ts
	 * if (icc.hasHandler('user:fetch')) {
	 *   const user = await icc.invoke('user:fetch', 'u_42');
	 * }
	 * ```
	 *
	 * @see {@link Icc.send} when no answer is needed.
	 */
	public invoke<C extends RequestChannel<R>>(
		channel: C,
		...request: RequestArgs<R[C]>
	): Promise<RequestResult<R[C]>> {
		return this._requests.request(channel, request) as Promise<RequestResult<R[C]>>;
	}

	/**
	 * Whether a channel currently has a handler.
	 *
	 * @param channel - Channel to check.
	 * @returns `true` when an `invoke` on this channel would reach a handler.
	 *
	 * @example
	 * ```ts
	 * if (!icc.hasHandler('user:fetch')) renderOfflinePlaceholder();
	 * ```
	 */
	public hasHandler(channel: RequestChannel<R>): boolean {
		return this._requests.has(channel);
	}

	/**
	 * Removes the handler of a channel, leaving its listeners untouched.
	 *
	 * @param channel - Channel to leave unanswered.
	 *
	 * @example
	 * ```ts
	 * icc.removeHandler('user:fetch');
	 * icc.hasHandler('user:fetch'); // false
	 * ```
	 */
	public removeHandler(channel: RequestChannel<R>): void {
		this._requests.remove(channel);
	}

	/**
	 * Counts active listeners.
	 *
	 * @param channel - Channel to count on. Counts every channel when omitted.
	 * @returns The number of listeners currently registered.
	 *
	 * @example
	 * ```ts
	 * icc.listenerCount('theme:change'); // 2
	 * icc.listenerCount();               // 7, across the whole bus
	 * ```
	 *
	 * @remarks Handlers are not listeners; use `hasHandler` for those.
	 */
	public listenerCount(channel?: EventChannel<E>): number {
		return this._events.count(channel);
	}

	/**
	 * Lists every channel the bus knows about, whether it holds listeners, a
	 * handler, or has simply been used before.
	 *
	 * @returns The channel names, in registration order.
	 *
	 * @example
	 * ```ts
	 * console.table(icc.channelNames().map((name) => ({
	 *   name,
	 *   listeners: icc.listenerCount(name),
	 * })));
	 * ```
	 */
	public channelNames(): string[] {
		return this._registry.names();
	}

	/**
	 * Removes listeners without touching handlers.
	 *
	 * @param channel - Channel to clear. Clears every channel when omitted.
	 *
	 * @example
	 * ```ts
	 * icc.removeAllListeners('theme:change');
	 * icc.removeAllListeners();
	 * ```
	 */
	public removeAllListeners(channel?: EventChannel<E>): void {
		this._events.clear(channel);
	}

	/**
	 * Drops one or more channels entirely — listeners, handler and registration.
	 *
	 * @param channels - Channels to drop. Unknown names are ignored.
	 *
	 * @example
	 * ```ts
	 * icc.removeChannels('cart:item-added', 'cart:item-removed');
	 * ```
	 */
	public removeChannels(...channels: Array<EventChannel<E> | RequestChannel<R>>): void {
		for (let i = 0; i < channels.length; i += 1) {
			const channel = channels[i];

			this._events.clear(channel);
			this._requests.remove(channel);
			this._registry.drop(channel);
		}
	}

	/**
	 * Resets the bus to its initial, empty state.
	 *
	 * @example
	 * ```ts
	 * afterEach(() => icc.clear());
	 * ```
	 *
	 * @remarks
	 * Disposers created before the reset stay safe to call; they simply have
	 * nothing left to remove.
	 */
	public clear(): void {
		this._events.clear();
		this._requests.clear();
		this._registry.reset();
	}
}

/**
 * Subscribes to an abort signal and returns a disposer detaching the listener.
 *
 * Kept local to `waitFor`, which needs to react to the abort rather than simply
 * be removed by it.
 */
const watchAbort = (signal: AbortSignal, onAbort: () => void): (() => void) => {
	if (typeof signal.addEventListener !== 'function') {
		const previous = signal.onabort;

		// The signal is closed over rather than read off `this`: an arrow function
		// has no own `this`, and the receiver of an `onabort` call is the signal.
		signal.onabort = (event: Event): void => {
			if (typeof previous === 'function') previous.call(signal, event);
			onAbort();
		};

		return noop;
	}

	signal.addEventListener('abort', onAbort);

	return (): void => {
		if (typeof signal.removeEventListener === 'function') {
			signal.removeEventListener('abort', onAbort);
		}
	};
};

/** The reason a signal was aborted with, or a tagged error when it carries none. */
const abortReason = (signal: AbortSignal, channel: string): unknown => {
	const reason = (signal as { reason?: unknown }).reason;

	if (reason !== undefined) return reason;

	return createIccError(
		'ERR_ICC_ABORTED',
		channel,
		'Aborted while waiting for channel "' + channel + '".',
	);
};
