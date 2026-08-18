/**
 * Stand-ins for `AbortSignal`, used to prove the bus works against the shapes it
 * may realistically meet: a modern signal, a signal it must not leak listeners
 * on, and the property-only signal of a legacy engine.
 */

/** A signal that records how many listeners were attached and detached. */
export interface TrackingSignal {
	/** The object handed to the bus. */
	signal: AbortSignal;

	/** Fires the abort, with an optional reason. */
	abort(reason?: unknown): void;

	/** How many abort listeners are attached right now. */
	attached(): number;

	/** How many listeners were attached over the lifetime of the signal. */
	totalAttached(): number;
}

/**
 * Builds a signal tracking its own listeners, so a test can assert the bus
 * detaches from a long-lived controller instead of piling registrations onto it.
 */
export function createTrackingSignal(): TrackingSignal {
	const listeners: Array<() => void> = [];
	let total = 0;

	const signal = {
		aborted: false,
		reason: undefined as unknown,
		addEventListener(_type: string, listener: () => void): void {
			listeners.push(listener);
			total += 1;
		},
		removeEventListener(_type: string, listener: () => void): void {
			const index = listeners.indexOf(listener);
			if (index !== -1) listeners.splice(index, 1);
		},
	};

	return {
		signal: signal as unknown as AbortSignal,
		abort(reason?: unknown): void {
			if (signal.aborted) return;

			signal.aborted = true;
			signal.reason = reason;

			for (const listener of listeners.slice()) listener();
		},
		attached: () => listeners.length,
		totalAttached: () => total,
	};
}

/** A signal exposing only the `onabort` property, as pre-2019 engines did. */
export interface LegacySignal {
	/** The object handed to the bus. */
	signal: AbortSignal;

	/** Fires the abort through the property handler. */
	abort(): void;

	/** Installs a handler before the bus does, to prove chaining. */
	presetOnAbort(handler: () => void): void;
}

/**
 * Builds a signal without `addEventListener`, forcing the bus down its
 * property-handler fallback.
 */
export function createLegacySignal(): LegacySignal {
	const signal = {
		aborted: false,
		onabort: null as ((this: unknown, event: unknown) => void) | null,
	};

	return {
		signal: signal as unknown as AbortSignal,
		abort(): void {
			signal.aborted = true;
			if (signal.onabort) signal.onabort.call(signal, { type: 'abort' });
		},
		presetOnAbort(handler: () => void): void {
			signal.onabort = handler;
		},
	};
}
