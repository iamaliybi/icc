import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Node is the default so the core suite proves the bus needs no DOM at all.
		// The files that do need one opt in with an `@vitest-environment` docblock.
		environment: 'node',
		include: ['test/**/*.test.ts'],
		typecheck: {
			enabled: false,
			include: ['test/**/*.test-d.ts'],
			tsconfig: './tsconfig.test.json',
		},
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			// Type-only modules compile away to nothing, so they would report as
			// uncovered files with no statements to cover.
			exclude: ['src/types/**'],
			reporter: ['text', 'html'],
			thresholds: {
				statements: 95,
				branches: 90,
				functions: 95,
				lines: 95,
			},
		},
	},
});
