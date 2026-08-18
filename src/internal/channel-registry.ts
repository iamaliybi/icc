import type { ChannelRecord } from './types';

/**
 * Storage of the bus, and nothing else.
 *
 * It knows which channels exist and what is stored under each of them; it has
 * no opinion on what a listener or a handler means. Dispatch semantics live in
 * {@link EventDispatcher}, request semantics in {@link RequestBroker} — both of
 * which read and write records through this one owner.
 *
 * @internal
 */
export class ChannelRegistry {
	/**
	 * Prototype-less on purpose: channel names come from user land, and a plain
	 * object literal would report inherited members such as `__proto__` or
	 * `constructor` as if they were live channels.
	 *
	 * A plain object is also what keeps the runtime free of ES2015 collections,
	 * so the bundle needs no polyfill on legacy targets.
	 */
	private readonly _records: Record<string, ChannelRecord | undefined> =
		Object.create(null) as Record<string, ChannelRecord | undefined>;

	/**
	 * Returns the record of a channel, creating an empty one when the channel is
	 * seen for the first time.
	 */
	public ensure(channel: string): ChannelRecord {
		let record = this._records[channel];

		if (record === undefined) {
			record = { listeners: [], handler: null };
			this._records[channel] = record;
		}

		return record;
	}

	/** Returns the record of a channel without creating one. */
	public peek(channel: string): ChannelRecord | undefined {
		return this._records[channel];
	}

	/** Every known channel name, in registration order. */
	public names(): string[] {
		return Object.keys(this._records);
	}

	/** Hands every existing record to a visitor. */
	public each(visit: (record: ChannelRecord, channel: string) => void): void {
		const names = this.names();

		for (let i = 0; i < names.length; i += 1) {
			const record = this._records[names[i]];
			if (record !== undefined) visit(record, names[i]);
		}
	}

	/** Forgets a channel entirely. */
	public drop(channel: string): void {
		delete this._records[channel];
	}

	/** Forgets every channel. */
	public reset(): void {
		const names = this.names();

		for (let i = 0; i < names.length; i += 1) {
			delete this._records[names[i]];
		}
	}
}
