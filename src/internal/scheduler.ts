import type { Scheduler } from '../types/options';

/**
 * The scheduler used when none is supplied.
 *
 * Resolved once at module scope, so the feature detection is paid a single time
 * instead of on every `send`:
 *
 * 1. `queueMicrotask` where it exists;
 * 2. the promise job queue, for engines that predate it (Safari below 12.1,
 *    legacy Edge);
 * 3. `setTimeout`, which shifts dispatch to a macrotask but keeps the bus
 *    working on anything older still.
 *
 * @internal
 */
export const defaultScheduler: Scheduler = (function (): Scheduler {
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
