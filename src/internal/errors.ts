import type { IccError, IccErrorCode } from '../types/errors';
import type { ErrorReporter } from '../types/options';

/**
 * Builds a tagged error.
 *
 * `Error` is annotated rather than subclassed on purpose: a native subclass
 * loses its prototype chain once a bundle is down-levelled to ES5, which would
 * silently break `instanceof` for consumers on legacy targets. Callers are
 * expected to test `error.code`.
 *
 * @internal
 */
export const createIccError = (code: IccErrorCode, channel: string, message: string): IccError => {
	const error = new Error(message) as IccError;

	error.name = 'IccError';
	error.code = code;
	error.channel = channel;

	return error;
};

/**
 * The reporter used when none is supplied.
 *
 * Presence of a console is checked rather than assumed, so the bus stays usable
 * in a worker or an embedded runtime that ships without one.
 *
 * @internal
 */
export const defaultErrorReporter: ErrorReporter = (error, context): void => {
	if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
		console.error('[icc] listener for channel "' + context.channel + '" threw:', error);
	}
};
