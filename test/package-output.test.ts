/**
 * What consumers actually install: the built bundles, their type definitions and
 * the manifest that points at them. Nothing here imports `src`.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Record<string, any>;

const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8');

describe('the manifest', () => {
	it('declares no runtime dependencies', () => {
		expect(manifest.dependencies ?? {}).toEqual({});
		expect(manifest.peerDependencies ?? {}).toEqual({});
	});

	it('points every export condition at a file that exists', () => {
		const entry = manifest.exports['.'];
		const targets = [
			manifest.main,
			manifest.module,
			manifest.types,
			entry.import.types,
			entry.import.default,
			entry.require.types,
			entry.require.default,
		];

		for (const target of targets) {
			expect(existsSync(resolve(root, target)), `${target} is missing from the build`).toBe(true);
		}
	});

	it('ships the files a consumer needs and nothing else', () => {
		expect(manifest.files).toContain('dist');
		expect(manifest.sideEffects).toBe(false);
		expect(manifest.license).toBe('MIT');
	});
});

describe('the ECMAScript module build', () => {
	it('exposes the documented surface', async () => {
		const esm = await import('../dist/index.mjs');

		expect(typeof esm.Icc).toBe('function');
		expect(typeof esm.createIcc).toBe('function');
		expect(esm.icc).toBeInstanceOf(esm.Icc);
		expect(esm.default).toBe(esm.icc);
	});

	it('works end to end', async () => {
		const { createIcc } = await import('../dist/index.mjs');
		const bus = createIcc({ scheduler: (task: () => void) => task() });
		const seen: unknown[] = [];

		bus.on('x', (payload: unknown) => seen.push(payload));
		bus.sendSync('x', 'esm');
		bus.handle('y', () => 'answered');

		expect(seen).toEqual(['esm']);
		await expect(bus.invoke('y')).resolves.toBe('answered');
	});
});

describe('the CommonJS build', () => {
	it('exposes the documented surface', () => {
		const cjs = require('../dist/index.cjs');

		expect(typeof cjs.Icc).toBe('function');
		expect(typeof cjs.createIcc).toBe('function');
		expect(cjs.default).toBe(cjs.icc);
		expect(cjs.createIcc()).toBeInstanceOf(cjs.Icc);

		// `cjs.icc instanceof cjs.Icc` is deliberately not asserted: whichever build
		// loads first publishes the shared bus, and the other adopts that instance
		// rather than building a second one. See the side-by-side suite below.
		for (const method of ['on', 'once', 'off', 'send', 'sendSync', 'waitFor', 'handle', 'invoke']) {
			expect(typeof cjs.icc[method], `icc.${method} is missing`).toBe('function');
		}
	});

	it('works end to end', async () => {
		const { createIcc } = require('../dist/index.cjs');
		const bus = createIcc({ scheduler: (task: () => void) => task() });
		const seen: unknown[] = [];

		bus.on('x', (payload: unknown) => seen.push(payload));
		bus.sendSync('x', 'cjs');
		bus.handle('y', () => 'answered');

		expect(seen).toEqual(['cjs']);
		await expect(bus.invoke('y')).resolves.toBe('answered');
	});
});

describe('both builds side by side', () => {
	it('share a single default bus, so a mixed application still talks to itself', async () => {
		const esm = await import('../dist/index.mjs');
		const cjs = require('../dist/index.cjs');
		const seen: unknown[] = [];

		expect(cjs.icc).toBe(esm.icc);
		expect(cjs.Icc, 'two builds really do carry two class objects').not.toBe(esm.Icc);

		esm.icc.on('mixed', (payload: unknown) => seen.push(payload));
		cjs.icc.sendSync('mixed', 'one registry');

		expect(seen).toEqual(['one registry']);

		esm.icc.clear();
	});
});

describe('the type definitions', () => {
	const definitions = ['dist/index.d.ts', 'dist/index.d.cts'];

	it.each(definitions)('%s documents the surface it declares', (file) => {
		const contents = read(file);

		for (const symbol of ['declare class Icc', 'declare function createIcc', 'interface IccEvents', 'interface IccBus']) {
			expect(contents).toContain(symbol);
		}

		expect(contents).toContain('@example');
		expect(contents).toContain('@param');
		expect(contents).toContain('@returns');
	});

	it('keeps an example on every public method of the bus', () => {
		const contents = read('dist/index.d.ts');
		const methods = [
			'on<', 'once<', 'off<', 'send<', 'sendSync<', 'waitFor<',
			'handle<', 'handleOnce<', 'invoke<', 'hasHandler(', 'removeHandler(',
			'listenerCount(', 'channelNames(', 'removeAllListeners(', 'removeChannels(', 'clear(',
		];

		for (const method of methods) {
			const at = contents.indexOf(method);

			expect(at, `${method} is missing from the definitions`).toBeGreaterThan(-1);

			// The doc block sits directly above the signature; an undocumented member
			// would show the previous one's block instead, so look at a tight window.
			const block = contents.slice(Math.max(0, at - 1_600), at);

			expect(block, `${method} has no example above it`).toContain('@example');
		}
	});
});
