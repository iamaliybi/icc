/**
 * Internal data model of the registry. Not part of the public API: it describes
 * how registrations are stored, not how they are used.
 *
 * @packageDocumentation
 * @internal
 */

/**
 * One listener registration.
 *
 * @internal
 */
export interface Subscription {
	/** The callback to invoke. */
	fn: (payload: any) => void;

	/** Whether it is removed right after its first call. */
	once: boolean;

	/**
	 * Cleared the moment the subscription is removed.
	 *
	 * A dispatch already in flight reads this flag to skip a listener that was
	 * unregistered by an earlier listener of the same emission.
	 */
	active: boolean;
}

/**
 * The single handler registration of a request channel.
 *
 * @internal
 */
export interface HandlerEntry {
	/** The responder to call. */
	fn: (...args: any[]) => any;

	/** Whether it is removed right after answering one request. */
	once: boolean;
}

/**
 * Everything stored for one channel name.
 *
 * @internal
 */
export interface ChannelRecord {
	/** Listeners, in registration order. */
	listeners: Subscription[];

	/** The responder, or `null` while nobody answers this channel. */
	handler: HandlerEntry | null;
}
