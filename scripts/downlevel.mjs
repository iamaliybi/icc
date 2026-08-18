/**
 * Transpiles the bundles in `dist/` down to ES5.
 *
 * esbuild — and therefore tsup — cannot emit ES5 at all: it refuses on `const`
 * before it even reaches a class. So the bundling stays with tsup, and the last
 * step is handed to TypeScript, which has downlevelled to ES5 for a decade.
 *
 * Source maps are composed rather than replaced: tsup maps the bundle back to
 * `src/`, this step maps ES5 back to the bundle, and the two are chained so a
 * stack trace in a browser still points at the original TypeScript.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import remapping from '@ampproject/remapping';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each bundle keeps the module system it was built with. */
const BUNDLES = [
	{ file: 'dist/index.mjs', module: ts.ModuleKind.ESNext },
	{ file: 'dist/index.cjs', module: ts.ModuleKind.CommonJS },
];

const SOURCE_MAP_COMMENT = /\n?\/\/# sourceMappingURL=.*$/;

const downlevel = ({ file, module }) => {
	const path = resolve(root, file);
	const mapPath = `${path}.map`;
	const name = basename(file);

	const source = readFileSync(path, 'utf8');
	const bundleMap = JSON.parse(readFileSync(mapPath, 'utf8'));

	const { outputText, sourceMapText } = ts.transpileModule(source, {
		fileName: name,
		compilerOptions: {
			target: ts.ScriptTarget.ES5,
			module,
			sourceMap: true,
			newLine: ts.NewLineKind.LineFeed,
			// The bundle is not where anyone reads the documentation: every comment
			// is already in the shipped `.d.ts`, which is what an IDE reads, and
			// keeping them here tripled the unminified size for no benefit.
			removeComments: true,
		},
	});

	// tsup maps the bundle to `src/`; TypeScript maps ES5 to the bundle. Chaining
	// them keeps the published map pointing at the original TypeScript.
	const chained = remapping(sourceMapText, (requested) => (requested === name ? bundleMap : null));

	const code = `${outputText.replace(SOURCE_MAP_COMMENT, '')}\n//# sourceMappingURL=${name}.map\n`;

	writeFileSync(path, code, 'utf8');
	writeFileSync(mapPath, `${JSON.stringify(chained)}\n`, 'utf8');

	return { file, bytes: Buffer.byteLength(code) };
};

for (const bundle of BUNDLES) {
	const { file, bytes } = downlevel(bundle);

	console.log(`ES5  ${file}  ${(bytes / 1024).toFixed(2)} KB`);
}
