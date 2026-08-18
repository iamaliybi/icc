/**
 * The seams of a bus: how a deferred broadcast is scheduled, and where a
 * listener failure is reported.
 *
 * @packageDocumentation
 */

/**
 * Defers a broadcast to a later point in time.
 *
 * `send` never dispatches inside the calling stack, and this is the function
 * that decides when it does. The default implementation uses `queueMicrotask`,
 * falling back to the promise job queue and then to `setTimeout` on engines
 * that lack it.
 *
 * Replace it to align dispatch with the scheduler of a framework, or to make it
 * synchronous in tests.
 *
 * @param task - The dispatch to run. It never throws: listener failures are
 * caught and reported before they can reach the scheduler.
 *
 * @example Making `send` synchronous inside a test
 * ```ts
 * const bus = createIcc({ scheduler: (task) => task() });
 *
 * bus.on('ping', spy);
 * bus.send('ping');
 *
 * expect(spy).toHaveBeenCalled(); // no await needed
 * ```
 *
 * @example Dispatching on the animation frame instead of the microtask queue
 * ```ts
 * const bus = createIcc({ scheduler: (task) => { requestAnimationFrame(task); } });
 * ```
 */
export type Scheduler = (task: () => void) => void;

/**
 * Where a listener failure happened.
 *
 * Only listeners are reported this way. A handler failure has a caller waiting
 * on `invoke`, so it is forwarded there instead of being reported.
 */
export interface ErrorContext {
	/** The channel whose listener threw. */
	channel: string;

	/** Always `'listener'`, reserved for future sources of reported failures. */
	type: 'listener';
}

/**
 * Receives failures the bus has nowhere else to send.
 *
 * @param error - Whatever the listener threw.
 * @param context - Where the failure came from.
 *
 * @remarks
 * Dispatch always continues with the remaining listeners, whether the reporter
 * is called or not, and a reporter that throws is ignored.
 */
export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

/**
 * Construction options of a bus.
 *
 * @example
 * ```ts
 * const bus = createIcc({
 *   onError: (error, { channel }) => reportToSentry(error, { channel }),
 * });
 * ```
 */
export interface IccOptions {
	/**
	 * Called when a listener throws.
	 *
	 * @defaultValue A reporter that logs to `console.error`.
	 */
	onError?: ErrorReporter;

	/**
	 * Decides when a deferred broadcast runs.
	 *
	 * @defaultValue `queueMicrotask`, with a promise-job and `setTimeout` fallback.
	 */
	scheduler?: Scheduler;
}
