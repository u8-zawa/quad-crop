import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
    return {
        base: command === 'build' ? '/quad-crop/' : './',
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
            // https: true,
        }
    }
});