import type { ErrorReporter, Scheduler } from '../types/options';
import type { Unsubscribe } from '../types/handlers';
import type { ChannelRegistry } from './channel-registry';
import type { ChannelRecord, Subscription } from './types';
import { linkSignal, noop } from './signals';

/**
 * The broadcast half of the bus: subscription bookkeeping and dispatch.
 *
 * Its collaborators are injected rather than reached for — storage through
 * {@link ChannelRegistry}, timing through a `Scheduler`, failure reporting
 * through an `ErrorReporter` — so the deferral strategy or the reporter can be
 * replaced without touching this class.
 *
 * @internal
 */
export class EventDispatcher {
	public constructor(
		private readonly _registry: ChannelRegistry,
		private readonly _scheduler: Scheduler,
		private readonly _report: ErrorReporter,
	) {}

	/**
	 * Registers a listener and returns its disposer.
	 *
	 * An already aborted signal registers nothing at all.
	 */
	public add(
		channel: string,
		listener: (payload: any) => void,
		once: boolean,
		signal: AbortSignal | undefined,
	): Unsubscribe {
		if (signal !== undefined && signal.aborted) return noop;

		const record = this._registry.ensure(channel);
		const subscription: Subscription = { fn: listener, once: once, active: true };

		record.listeners.push(subscription);

		return linkSignal(signal, (): void => {
			remove(record, subscription);
		});
	}

	/** Removes the first active listener matching a function reference. */
	public remove(channel: string, listener: (payload: any) => void): boolean {
		const record = this._registry.peek(channel);
		if (record === undefined) return false;

		for (let i = 0; i < record.listeners.length; i += 1) {
			const subscription = record.listeners[i];

			if (subscription.active && subscription.fn === listener) {
				remove(record, subscription);

				return true;
			}
		}

		return false;
	}

	/** Hands the payload to every listener, before this call returns. */
	public emit(channel: string, payload: unknown): void {
		const record = this._registry.peek(channel);
		if (record === undefined || record.listeners.length === 0) return;

		// Iterating a copy keeps the dispatch stable while listeners subscribe or
		// unsubscribe from within their own callback; the `active` flag is what
		// makes a removal during dispatch take effect immediately.
		const snapshot = record.listeners.slice();

		for (let i = 0; i < snapshot.length; i += 1) {
			const subscription = snapshot[i];
			if (!subscription.active) continue;

			if (subscription.once) remove(record, subscription);

			try {
				subscription.fn(payload);
			}
			catch (error) {
				this._reportFailure(error, channel);
			}
		}
	}

	/** Hands the payload to every listener once the current call stack unwinds. */
	public defer(channel: string, payload: unknown): void {
		this._scheduler((): void => {
			this.emit(channel, payload);
		});
	}

	/** Counts active listeners on one channel, or across every channel. */
	public count(channel?: string): number {
		if (channel !== undefined) {
			const record = this._registry.peek(channel);

			return record === undefined ? 0 : record.listeners.length;
		}

		let total = 0;

		this._registry.each((record): void => {
			total += record.listeners.length;
		});

		return total;
	}

	/** Removes every listener of one channel, or of every channel. */
	public clear(channel?: string): void {
		if (channel !== undefined) {
			clearRecord(this._registry.peek(channel));

			return;
		}

		this._registry.each((record): void => {
			clearRecord(record);
		});
	}

	/** Reports a listener failure without ever letting the reporter break dispatch. */
	private _reportFailure(error: unknown, channel: string): void {
		try {
			this._report(error, { channel: channel, type: 'listener' });
		}
		catch (_) {
			// A throwing reporter must not abort the remaining listeners.
		}
	}
}

/**
 * Deactivates a subscription and takes it out of its record.
 *
 * The position is looked up at removal time rather than captured when the
 * listener was added: every earlier removal shifts the indices that follow it,
 * so a stored index would eventually point at somebody else's listener.
 */
const remove = (record: ChannelRecord, subscription: Subscription): void => {
	if (!subscription.active) return;

	subscription.active = false;

	const index = record.listeners.indexOf(subscription);
	if (index !== -1) record.listeners.splice(index, 1);
};

/** Deactivates and drops every listener of a record. */
const clearRecord = (record: ChannelRecord | undefined): void => {
	if (record === undefined) return;

	for (let i = 0; i < record.listeners.length; i += 1) {
		record.listeners[i].active = false;
	}

	record.listeners.length = 0;
};
