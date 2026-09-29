import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Live-network checks. Separate from `npm test` on purpose: these open real
 * sockets to real relays, so they are opt-in (`npm run test:live`) and never
 * run in the normal suite, which blocks egress outright.
 *
 * Node environment, not jsdom — node 22 has a native WebSocket, and the pool
 * takes the browser path here because `isDesktop()` is false without Tauri.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.live.test.ts'],
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, './src'),
        },
    },
});
