import type { AbortLike } from '../types/handlers';

/**
 * Stands in for a disposer when nothing was registered.
 *
 * @internal
 */
export const noop = (): void => {};

/**
 * Narrows an {@link AbortLike} down to the signal it carries.
 *
 * @internal
 */
export const toSignal = (source: AbortLike | undefined): AbortSignal | undefined => {
	if (!source) return undefined;

	return 'signal' in source ? source.signal : source;
};

/**
 * Wires `dispose` to the signal and returns a disposer that also detaches the
 * abort subscription, so unsubscribing by hand does not leave a listener behind
 * on a long-lived controller.
 *
 * `addEventListener` is used instead of the `onabort` property so several
 * registrations sharing one controller stay independent of each other; the
 * property is the fallback for engines without it, and is chained rather than
 * overwritten.
 *
 * @internal
 */
export const linkSignal = (signal: AbortSignal | undefined, dispose: () => void): (() => void) => {
	if (!signal) return dispose;

	if (typeof signal.addEventListener === 'function') {
		let disposeAndDetach: () => void = dispose;

		const onAbort = (): void => {
			disposeAndDetach();
		};

		signal.addEventListener('abort', onAbort);

		disposeAndDetach = (): void => {
			if (typeof signal.removeEventListener === 'function') {
				signal.removeEventListener('abort', onAbort);
			}

			dispose();
		};

		return disposeAndDetach;
	}

	const previous = signal.onabort;

	// The signal is closed over rather than read off `this`: an arrow function has
	// no own `this`, and the receiver of an `onabort` call is the signal anyway.
	signal.onabort = (event: Event): void => {
		if (typeof previous === 'function') previous.call(signal, event);
		dispose();
	};

	return dispose;
};
