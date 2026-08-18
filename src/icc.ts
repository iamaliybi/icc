import { createError, linkSignal, noop, reportError, schedule, toSignal } from './internal';
import type {
	Channel,
	ErrorContext,
	EventArgs,
	EventMap,
	HandlerOptions,
	IccOptions,
	Listener,
	ListenerOptions,
	RequestArgs,
	RequestHandler,
	RequestMap,
	RequestResult,
	ResolvedEvents,
	ResolvedRequests,
	Unsubscribe,
} from './types';

interface Subscription {
	fn: (payload: any) => void;
	once: boolean;
	active: boolean;
}

interface HandlerEntry {
	fn: (...args: any[]) => any;
	once: boolean;
}

interface ChannelRecord {
	listeners: Subscription[];
	handler: HandlerEntry | null;
}

type Registry = Record<string, ChannelRecord | undefined>;

/**
 * A strongly typed publish/subscribe bus for the browser, modelled after the
 * Electron IPC surface.
 *
 * Two independent communication styles share the same channel registry:
 *
 * - **events** - `send` broadcasts a payload to every listener registered with
 *   `on` / `once`. Many listeners, no answer.
 * - **requests** - `invoke` calls the single handler registered with `handle`
 *   and resolves with its result. Exactly one responder, one answer.
 *
 * @typeParam E - Event map, channel name to payload type.
 * @typeParam R - Request map, channel name to `(request) => response`.
 */
export class Icc<E extends EventMap<E> = ResolvedEvents, R extends RequestMap<R> = ResolvedRequests> {
	/**
	 * Prototype-less registry: channel names come from user land, and a plain
	 * object literal would expose inherited members such as `__proto__` or
	 * `constructor` as if they were live channels.
	 */
	private readonly _channels: Registry = Object.create(null) as Registry;

	private readonly _onError: (error: unknown, context: ErrorContext) => void;

	constructor(options?: IccOptions) {
		const onError = options ? options.onError : undefined;

		this._onError = typeof onError === 'function'
			? onError
			: function (error: unknown, context: ErrorContext): void {
				reportError(error, context.channel);
			};
	}

	/**
	 * Subscribes to a channel.
	 *
	 * @returns A disposer that removes the listener. Calling it twice is a no-op.
	 */
	public on<C extends Channel<E>>(
		channel: C,
		listener: Listener<E[C]>,
		options?: ListenerOptions,
	): Unsubscribe {
		const once = options !== undefined && options.once === true;

		return this._addListener(channel, listener, once, options);
	}

	/** Subscribes to the next emission of a channel only. */
	public once<C extends Channel<E>>(
		channel: C,
		listener: Listener<E[C]>,
		options?: ListenerOptions,
	): Unsubscribe {
		return this._addListener(channel, listener, true, options);
	}

	/**
	 * Removes a previously registered listener by reference.
	 *
	 * @returns `true` when a matching listener was found.
	 */
	public off<C extends Channel<E>>(channel: C, listener: Listener<E[C]>): boolean {
		const record = this._channels[channel];
		if (record === undefined) return false;

		const listeners = record.listeners;

		for (let i = 0; i < listeners.length; i += 1) {
			const subscription = listeners[i];

			if (subscription.active && subscription.fn === listener) {
				subscription.active = false;
				listeners.splice(i, 1);

				return true;
			}
		}

		return false;
	}

	/**
	 * Broadcasts a payload to every listener of a channel.
	 *
	 * Dispatch is deferred to a microtask so a component never re-enters itself
	 * mid-render: the emitting call stack always unwinds first.
	 */
	public send<C extends Channel<E>>(channel: C, ...args: EventArgs<E[C]>): void {
		const payload = args[0] as E[C];
		const self = this;

		schedule(function (): void {
			self._emit(channel, payload);
		});
	}

	/**
	 * Broadcasts a payload synchronously, before this call returns.
	 *
	 * Prefer {@link Icc.send}; reach for this only when the listener has to run
	 * inside the current task, such as before a `beforeunload` handler returns.
	 */
	public sendSync<C extends Channel<E>>(channel: C, ...args: EventArgs<E[C]>): void {
		this._emit(channel, args[0] as E[C]);
	}

	/**
	 * Registers the responder of a request channel. A channel holds at most one
	 * handler, so registering again replaces the previous one.
	 *
	 * @returns A disposer that removes the handler. Calling it twice is a no-op,
	 * and it never removes a handler registered after it.
	 */
	public handle<C extends Channel<R>>(
		channel: C,
		handler: RequestHandler<R[C]>,
		options?: HandlerOptions,
	): Unsubscribe {
		const signal = toSignal(options ? options.signal : undefined);
		if (signal !== undefined && signal.aborted) return noop;

		const record = this._ensureChannel(channel);
		const entry: HandlerEntry = {
			fn: handler as (...args: any[]) => any,
			once: options !== undefined && options.once === true,
		};

		record.handler = entry;

		return linkSignal(signal, function (): void {
			// Identity check: a handler registered later must survive a stale disposer.
			if (record.handler === entry) record.handler = null;
		});
	}

	/**
	 * Sends a request to the handler of a channel and resolves with its answer.
	 *
	 * Rejects with an `IccError` (`code: 'ERR_ICC_NO_HANDLER'`) when the channel
	 * has no handler, and forwards whatever the handler throws or rejects with.
	 */
	public invoke<C extends Channel<R>>(
		channel: C,
		...args: RequestArgs<R[C]>
	): Promise<RequestResult<R[C]>> {
		const record = this._channels[channel];
		const entry = record !== undefined ? record.handler : null;

		if (record === undefined || entry === null) {
			return Promise.reject(createError(
				'ERR_ICC_NO_HANDLER',
				channel,
				'No handler registered for channel "' + channel + '".',
			));
		}

		if (entry.once) record.handler = null;

		try {
			return Promise.resolve(entry.fn.apply(null, args) as RequestResult<R[C]>);
		}
		catch (error) {
			return Promise.reject(error);
		}
	}

	/** Number of active listeners, for a single channel or for the whole bus. */
	public listenerCount(channel?: Channel<E>): number {
		if (channel !== undefined) {
			const record = this._channels[channel];

			return record === undefined ? 0 : record.listeners.length;
		}

		const names = Object.keys(this._channels);
		let total = 0;

		for (let i = 0; i < names.length; i += 1) {
			const record = this._channels[names[i]];
			if (record !== undefined) total += record.listeners.length;
		}

		return total;
	}

	/** Whether a request channel currently has a handler. */
	public hasHandler(channel: Channel<R>): boolean {
		const record = this._channels[channel];

		return record !== undefined && record.handler !== null;
	}

	/** Every channel name currently known to the bus. */
	public channelNames(): string[] {
		return Object.keys(this._channels);
	}

	/** Removes the handler of a request channel, keeping its listeners intact. */
	public removeHandler(channel: Channel<R>): void {
		const record = this._channels[channel];
		if (record !== undefined) record.handler = null;
	}

	/** Removes every listener of a channel, or of all channels when omitted. */
	public removeAllListeners(channel?: Channel<E>): void {
		if (channel !== undefined) {
			this._clearListeners(this._channels[channel]);

			return;
		}

		const names = Object.keys(this._channels);

		for (let i = 0; i < names.length; i += 1) {
			this._clearListeners(this._channels[names[i]]);
		}
	}

	/** Drops the given channels entirely, listeners and handler alike. */
	public removeChannel(...channels: Array<Channel<E> | Channel<R>>): void {
		for (let i = 0; i < channels.length; i += 1) {
			const channel = channels[i];
			const record = this._channels[channel];

			if (record !== undefined) {
				this._clearListeners(record);
				record.handler = null;
				delete this._channels[channel];
			}
		}
	}

	/** Resets the bus to its initial, empty state. */
	public clear(): void {
		const names = Object.keys(this._channels);

		for (let i = 0; i < names.length; i += 1) {
			const record = this._channels[names[i]];

			if (record !== undefined) {
				this._clearListeners(record);
				record.handler = null;
			}

			delete this._channels[names[i]];
		}
	}

	private _addListener(
		channel: string,
		listener: (payload: any) => void,
		once: boolean,
		options?: ListenerOptions,
	): Unsubscribe {
		const signal = toSignal(options ? options.signal : undefined);
		if (signal !== undefined && signal.aborted) return noop;

		const record = this._ensureChannel(channel);
		const subscription: Subscription = { fn: listener, once: once, active: true };

		record.listeners.push(subscription);

		return linkSignal(signal, function (): void {
			if (!subscription.active) return;

			subscription.active = false;

			// Looked up at removal time rather than reusing the index returned by
			// `push`: earlier removals shift every index that came after them.
			const index = record.listeners.indexOf(subscription);
			if (index !== -1) record.listeners.splice(index, 1);
		});
	}

	private _emit(channel: string, payload: unknown): void {
		const record = this._channels[channel];
		if (record === undefined || record.listeners.length === 0) return;

		// Iterating a copy keeps the dispatch stable while listeners subscribe or
		// unsubscribe from within their own callback; `active` is what makes a
		// removal during dispatch take effect immediately.
		const snapshot = record.listeners.slice();

		for (let i = 0; i < snapshot.length; i += 1) {
			const subscription = snapshot[i];
			if (!subscription.active) continue;

			if (subscription.once) {
				subscription.active = false;

				const index = record.listeners.indexOf(subscription);
				if (index !== -1) record.listeners.splice(index, 1);
			}

			try {
				subscription.fn(payload);
			}
			catch (error) {
				this._reportListenerError(error, channel);
			}
		}
	}

	private _reportListenerError(error: unknown, channel: string): void {
		try {
			this._onError(error, { channel: channel, type: 'listener' });
		}
		catch (_) {
			// A throwing error reporter must not abort the remaining listeners.
		}
	}

	private _ensureChannel(channel: string): ChannelRecord {
		let record = this._channels[channel];

		if (record === undefined) {
			record = { listeners: [], handler: null };
			this._channels[channel] = record;
		}

		return record;
	}

	private _clearListeners(record: ChannelRecord | undefined): void {
		if (record === undefined) return;

		for (let i = 0; i < record.listeners.length; i += 1) {
			record.listeners[i].active = false;
		}

		record.listeners.length = 0;
	}
}
