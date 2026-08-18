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
export const defaultScheduler: Scheduler = ((): Scheduler => {
	if (typeof queueMicrotask === 'function') {
		// Wrapped rather than passed by reference: an unbound `queueMicrotask`
		// throws an illegal invocation error in some browsers.
		return (task: () => void): void => {
			queueMicrotask(task);
		};
	}

	if (typeof Promise === 'function') {
		const resolved = Promise.resolve();

		return (task: () => void): void => {
			resolved.then(task);
		};
	}

	return (task: () => void): void => {
		setTimeout(task, 0);
	};
})();
