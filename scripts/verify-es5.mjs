/**
 * Fails the build if anything newer than ES5 survived into `dist/`.
 *
 * esbuild is the checker precisely because it cannot transform to ES5: pointed
 * at an ES5 target it errors on the first construct it would have to lower, so
 * a clean run is proof that none is left. A regex sweep would flag `=>` inside a
 * string; a parser cannot be fooled that way.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BUNDLES = [
	{ file: 'dist/index.mjs', format: 'esm' },
	{ file: 'dist/index.cjs', format: 'cjs' },
];

let failed = false;

for (const { file, format } of BUNDLES) {
	const contents = readFileSync(resolve(root, file), 'utf8');

	try {
		await transform(contents, { target: 'es5', format, loader: 'js' });

		console.log(`ES5 ✓  ${file}`);
	}
	catch (error) {
		failed = true;

		console.error(`ES5 ✗  ${file}`);

		for (const detail of error.errors ?? [{ text: String(error) }]) {
			console.error(`       ${detail.text}${detail.location ? ` (line ${detail.location.line})` : ''}`);
		}
	}
}

if (failed) process.exit(1);
