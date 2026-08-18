import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
	splitting: false,
	// The bus has to run in whatever the consumer's browserslist allows, so the
	// output stays at the lowest target esbuild can reliably emit. The runtime
	// itself only relies on ES5 built-ins plus `Promise`.
	target: 'es2015',
	platform: 'browser',
	outExtension({ format }) {
		return { js: format === 'esm' ? '.mjs' : '.cjs' };
	},
});
