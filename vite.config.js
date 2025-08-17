import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        target: 'esnext',
        sourcemap: false,
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,
            },
        },
    },
    server: {
        open: true
        // https: true,
    }
});