/**
 * The error shape the bus produces, and the codes it can carry.
 *
 * @packageDocumentation
 */

/**
 * Machine-readable reasons an operation can fail.
 *
 * - `ERR_ICC_NO_HANDLER` — `invoke` was called on a channel nothing responds to.
 * - `ERR_ICC_TIMEOUT` — `waitFor` gave up before the event arrived.
 * - `ERR_ICC_ABORTED` — `waitFor` was cancelled through its signal, and the
 *   signal carried no reason of its own.
 */
export type IccErrorCode = 'ERR_ICC_NO_HANDLER' | 'ERR_ICC_TIMEOUT' | 'ERR_ICC_ABORTED';

/**
 * The error the bus itself rejects with, carrying the channel it happened on.
 *
 * Errors coming from your own listeners and handlers are forwarded untouched;
 * only failures produced by the bus have this shape.
 *
 * @example Telling a missing handler apart from a failing one
 * ```ts
 * try {
 *   const user = await icc.invoke('user:fetch', 'u_42');
 * }
 * catch (error) {
 *   const code = (error as Partial<IccError>).code;
 *
 *   if (code === 'ERR_ICC_NO_HANDLER') {
 *     // Nobody is answering this channel yet.
 *   }
 *   else {
 *     // The handler ran and threw; `error` is whatever it threw.
 *   }
 * }
 * ```
 *
 * @remarks
 * Produced with `name: 'IccError'` on a plain `Error` rather than through a
 * subclass, because native subclasses lose their prototype chain — and with it
 * `instanceof` — once a bundle is down-levelled to ES5. Test `error.code`.
 */
export interface IccError extends Error {
	/** Always `'IccError'`. */
	name: string;

	/** Why the operation failed. */
	code: IccErrorCode;

	/** The channel the failing operation was aimed at. */
	channel: string;
}
