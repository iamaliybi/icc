/**
 * The published bundle has to survive environments the test runner cannot
 * pretend to be: an engine without `queueMicrotask`, without `Promise`, without
 * a console, and with nothing to `require`.
 *
 * Stubbing those globals inside the runner would take the runner down with them,
 * so the bundle is evaluated in a fresh JS realm through `node:vm` instead. That
 * realm doubles as the strictest possible framework-agnosticism check: no DOM,
 * no module loader, no host objects at all.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const BUNDLE = resolve(__dirname, '../dist/index.cjs');

let source = '';

beforeAll(() => {
	expect(
		existsSync(BUNDLE),
		'run `npm run build` before the suite; `npm test` does it for you',
	).toBe(true);

	source = readFileSync(BUNDLE, 'utf8');
});

interface Realm {
	exports: Record<string, any>;
	globals: Record<string, any>;
	timers: Array<() => void>;
	/** Global names present before the bundle was evaluated. */
	initialKeys: string[];
}

/** Evaluates the bundle in a fresh realm carrying only the globals given to it. */
function evaluateInRealm(globals: Record<string, unknown> = {}): Realm {
	const timers: Array<() => void> = [];
	const module = { exports: {} as Record<string, any> };

	const sandbox: Record<string, any> = {
		module,
		exports: module.exports,
		setTimeout: (task: () => void) => {
			timers.push(task);

			return timers.length;
		},
		clearTimeout: () => {},
		...globals,
	};

	const context = createContext(sandbox);
	const initialKeys = Object.keys(sandbox);

	// Wrapped exactly the way a CommonJS loader wraps a module, so the top-level
	// declarations of the bundle stay module-scoped instead of becoming globals
	// of the realm — otherwise the "what did it publish" assertion is meaningless.
	const load = runInContext(`(function (exports, require, module) {${source}\n})`, context) as (
		exports: Record<string, unknown>,
		require: undefined,
		module: { exports: Record<string, unknown> },
	) => void;

	load(module.exports, undefined, module);

	return { exports: module.exports, globals: sandbox, timers, initialKeys };
}

describe('an engine without the modern globals', () => {
	it('loads the bundle with no queueMicrotask, no Promise and no console', () => {
		const realm = evaluateInRealm({ queueMicrotask: undefined, Promise: undefined, console: undefined });

		expect(typeof realm.exports.createIcc).toBe('function');
		expect(typeof realm.exports.Icc).toBe('function');
		expect(realm.exports.icc).toBeTypeOf('object');
	});

	it('falls back to setTimeout for deferred broadcasts', () => {
		const realm = evaluateInRealm({ queueMicrotask: undefined, Promise: undefined, console: undefined });
		const bus = realm.exports.createIcc();
		const seen: unknown[] = [];

		bus.on('x', (payload: unknown) => seen.push(payload));
		bus.send('x', 'deferred');

		expect(seen, 'still deferred, never synchronous').toEqual([]);
		expect(realm.timers).toHaveLength(1);

		realm.timers[0]();

		expect(seen).toEqual(['deferred']);
	});

	it('still delivers synchronous broadcasts and removes listeners', () => {
		const realm = evaluateInRealm({ queueMicrotask: undefined, Promise: undefined, console: undefined });
		const bus = realm.exports.createIcc();
		const seen: unknown[] = [];

		const off = bus.on('x', (payload: unknown) => seen.push(payload));

		bus.sendSync('x', 1);
		off();
		bus.sendSync('x', 2);

		expect(seen).toEqual([1]);
		expect(bus.listenerCount('x')).toBe(0);
	});

	it('swallows a listener failure when there is no console to report it to', () => {
		const realm = evaluateInRealm({ queueMicrotask: undefined, Promise: undefined, console: undefined });
		const bus = realm.exports.createIcc();
		let reached = false;

		bus.on('x', () => { throw new realm.globals.Error('boom'); });
		bus.on('x', () => { reached = true; });

		expect(() => bus.sendSync('x')).not.toThrow();
		expect(reached).toBe(true);
	});

	it('prefers queueMicrotask as soon as the engine provides one', () => {
		const microtasks: Array<() => void> = [];
		const realm = evaluateInRealm({
			queueMicrotask: (task: () => void) => { microtasks.push(task); },
		});
		const bus = realm.exports.createIcc();
		const seen: unknown[] = [];

		bus.on('x', (payload: unknown) => seen.push(payload));
		bus.send('x', 'micro');

		expect(realm.timers).toHaveLength(0);
		expect(microtasks).toHaveLength(1);

		microtasks[0]();

		expect(seen).toEqual(['micro']);
	});
});

describe('what the bundle depends on', () => {
	it('needs nothing to require: the loader hands it an undefined require', () => {
		// The module wrapper receives `undefined` where a loader would pass
		// `require`, so any external import would have thrown while loading.
		const realm = evaluateInRealm();

		expect(realm.globals.require).toBeUndefined();
		expect(typeof realm.exports.createIcc).toBe('function');
	});

	it('needs no DOM: the realm has neither window nor document', () => {
		const realm = evaluateInRealm();
		const bus = realm.exports.createIcc();
		const seen: unknown[] = [];

		expect(realm.globals.window).toBeUndefined();
		expect(realm.globals.document).toBeUndefined();

		bus.on('x', (payload: unknown) => seen.push(payload));
		bus.sendSync('x', 'headless');

		expect(seen).toEqual(['headless']);
	});

	it('uses no collection newer than ES5', () => {
		for (const forbidden of ['new Map(', 'new Set(', 'new WeakMap(', 'new WeakSet(', 'Symbol(']) {
			expect(source, `${forbidden} would need a polyfill on a legacy engine`).not.toContain(forbidden);
		}
	});

	it('publishes exactly one global, under a versioned key', () => {
		const realm = evaluateInRealm({});
		const added = Object.keys(realm.globals).filter((key) => !realm.initialKeys.includes(key));

		expect(added).toEqual(['__ICC_DEFAULT_BUS_V1__']);
	});

	it('reuses a bus already published on the global object', () => {
		const first = evaluateInRealm({});
		const shared = first.globals.__ICC_DEFAULT_BUS_V1__;

		// A second evaluation stands in for an application loading both the ESM and
		// the CommonJS build: it has to adopt the instance that is already there.
		const second = evaluateInRealm({ __ICC_DEFAULT_BUS_V1__: shared });

		expect(second.exports.icc).toBe(shared);
		expect(second.exports.default).toBe(shared);
	});
});

describe('the request half in a realm with promises', () => {
	it('answers through the promise implementation of that realm', async () => {
		const realm = evaluateInRealm({ queueMicrotask: undefined });
		const bus = realm.exports.createIcc();

		bus.handle('who', () => 'answered');

		await expect(bus.invoke('who')).resolves.toBe('answered');
	});

	it('rejects with a tagged error when nothing answers', async () => {
		const realm = evaluateInRealm({});
		const bus = realm.exports.createIcc();

		await expect(bus.invoke('missing')).rejects.toMatchObject({
			name: 'IccError',
			code: 'ERR_ICC_NO_HANDLER',
			channel: 'missing',
		});
	});
});
