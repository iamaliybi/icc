import type { Unsubscribe } from '../types/handlers';
import type { ChannelRegistry } from './channel-registry';
import type { HandlerEntry } from './types';
import { createIccError } from './errors';
import { linkSignal, noop } from './signals';

/**
 * The request half of the bus: one responder per channel, one answer per call.
 *
 * Failures are deliberately not reported here. A request has a caller waiting
 * on a promise, so everything a handler throws or rejects with belongs to that
 * caller — unlike a broadcast, where nobody is listening for a failure.
 *
 * @internal
 */
export class RequestBroker {
	public constructor(private readonly _registry: ChannelRegistry) {}

	/**
	 * Installs the responder of a channel, replacing any previous one, and
	 * returns its disposer.
	 *
	 * An already aborted signal registers nothing at all.
	 */
	public set(
		channel: string,
		handler: (...args: any[]) => any,
		once: boolean,
		signal: AbortSignal | undefined,
	): Unsubscribe {
		if (signal !== undefined && signal.aborted) return noop;

		const record = this._registry.ensure(channel);
		const entry: HandlerEntry = { fn: handler, once: once };

		record.handler = entry;

		return linkSignal(signal, (): void => {
			// Identity check: a handler installed later has to survive the disposer
			// of the one it replaced.
			if (record.handler === entry) record.handler = null;
		});
	}

	/** Calls the responder of a channel and resolves with its answer. */
	public request(channel: string, args: any[]): Promise<any> {
		const record = this._registry.peek(channel);
		const entry = record !== undefined ? record.handler : null;

		if (record === undefined || entry === null) {
			return Promise.reject(createIccError(
				'ERR_ICC_NO_HANDLER',
				channel,
				'No handler is registered for channel "' + channel + '". '
				+ 'Call handle("' + channel + '", ...) before invoking it.',
			));
		}

		if (entry.once) record.handler = null;

		try {
			// `Promise.resolve` adopts a promise and wraps a plain value, so a
			// synchronous and an asynchronous handler answer through the same shape.
			return Promise.resolve(entry.fn.apply(null, args));
		}
		catch (error) {
			return Promise.reject(error);
		}
	}

	/** Whether a channel currently has a responder. */
	public has(channel: string): boolean {
		const record = this._registry.peek(channel);

		return record !== undefined && record.handler !== null;
	}

	/** Removes the responder of a channel. */
	public remove(channel: string): void {
		const record = this._registry.peek(channel);
		if (record !== undefined) record.handler = null;
	}

	/** Removes every responder of the bus. */
	public clear(): void {
		this._registry.each((record): void => {
			record.handler = null;
		});
	}
}
