import type { AbortLike } from './types';

/** No-op used whenever a registration is rejected before it is stored. */
export function noop(): void {}

/**
 * Schedules a task on the microtask queue.
 *
 * `queueMicrotask` is unavailable on older engines (Safari < 12.1, legacy
 * Edge), so the resolved promise job queue is used as the first fallback and a
 * macrotask as the last resort. Resolved once at module scope: the branch cost
 * is paid a single time instead of on every `send`.
 */
export const schedule: (task: () => void) => void = (function (): (task: () => void) => void {
	if (typeof queueMicrotask === 'function') {
		return function (task: () => void): void {
			// Wrapped rather than passed by reference: an unbound `queueMicrotask`
			// throws an illegal invocation error in some browsers.
			queueMicrotask(task);
		};
	}

	if (typeof Promise === 'function') {
		const resolved = Promise.resolve();

		return function (task: () => void): void {
			resolved.then(task);
		};
	}

	return function (task: () => void): void {
		setTimeout(task, 0);
	};
})();

/** Reports an error without assuming a console is present. */
export function reportError(error: unknown, channel: string): void {
	if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
		console.error('[icc] listener for channel "' + channel + '" threw:', error);
	}
}

export interface IccError extends Error {
	code: string;
	channel: string;
}

/**
 * Builds a tagged error without subclassing `Error`: native subclasses lose
 * their prototype chain once the bundle is down-levelled to ES5, which would
 * silently break `instanceof` for consumers on legacy targets.
 */
export function createError(code: string, channel: string, message: string): IccError {
	const error = new Error(message) as IccError;
	error.name = 'IccError';
	error.code = code;
	error.channel = channel;

	return error;
}

/** Accepts an `AbortController` as well as a bare `AbortSignal`. */
export function toSignal(source: AbortLike | undefined): AbortSignal | undefined {
	if (!source) return undefined;

	return 'signal' in source ? source.signal : source;
}

/**
 * Wires `dispose` to the signal and returns a disposer that also detaches the
 * abort subscription, so unsubscribing manually does not leak into the signal.
 *
 * `addEventListener` is used instead of the `onabort` property to keep several
 * registrations sharing one controller independent from each other.
 */
export function linkSignal(signal: AbortSignal | undefined, dispose: () => void): () => void {
	if (!signal) return dispose;

	if (typeof signal.addEventListener === 'function') {
		let disposeAndDetach: () => void = dispose;

		const onAbort = function (): void {
			disposeAndDetach();
		};

		signal.addEventListener('abort', onAbort);

		disposeAndDetach = function (): void {
			if (typeof signal.removeEventListener === 'function') {
				signal.removeEventListener('abort', onAbort);
			}

			dispose();
		};

		return disposeAndDetach;
	}

	// Legacy engines expose the property handler only. Chain onto whatever is
	// already registered instead of overwriting it.
	const previous = signal.onabort;

	signal.onabort = function (this: AbortSignal, event: Event): void {
		if (typeof previous === 'function') previous.call(this, event);
		dispose();
	};

	return dispose;
}
