import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        globals: false,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/internal/**', 'src/devtools/**'],
        },
        benchmark: {
            include: ['bench/**/*.bench.ts'],
        },
    },
});
