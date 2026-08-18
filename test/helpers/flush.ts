/**
 * Waits long enough for the default scheduler to have dispatched.
 *
 * A macrotask is used rather than a single `await`, so the helper stays correct
 * whichever branch of the scheduler fallback chain is active.
 */
export function flush(): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
}

/** Collects the payloads a listener receives, in order. */
export function collector<T = unknown>(): { seen: T[]; listener: (payload: T) => void } {
	const seen: T[] = [];

	return {
		seen,
		listener: (payload: T) => {
			seen.push(payload);
		},
	};
}
