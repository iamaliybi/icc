import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
	splitting: false,
	// esbuild cannot emit ES5 — it refuses on `const` before it even reaches a
	// class — so bundling stops at its floor and `scripts/downlevel.mjs` hands the
	// last step to TypeScript. `npm run verify:es5` then re-parses the result at an
	// ES5 target, which fails the build if anything newer survived.
	target: 'es2015',
	platform: 'browser',
	outExtension({ format }) {
		return { js: format === 'esm' ? '.mjs' : '.cjs' };
	},
});
