import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../../packages/portal-mojo/package.json', import.meta.url), 'utf8'));
const versionDefine = { 'import.meta.env.VITE_MOJO_APP_VERSION': JSON.stringify(version) };

// base './' so the built dist can be mounted anywhere — including served
// as static files by a django-mojo instance itself.
export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss()],
    base: './',
    define: versionDefine,
    ...(mode === 'django-admin' ? {
        envFile: false,
        envPrefix: '__ADMIN_NO_ENV__',
        define: {
            ...versionDefine,
            'import.meta.env.VITE_MOJO_PACKAGED_ADMIN': JSON.stringify('1'),
            'import.meta.env.VITE_MOJO_API': JSON.stringify(''),
            'import.meta.env.VITE_MOJO_AUTH': JSON.stringify('hosted'),
            'import.meta.env': JSON.stringify({
                MODE: 'django-admin', BASE_URL: './', DEV: false, PROD: true, SSR: false,
                VITE_MOJO_PACKAGED_ADMIN: '1', VITE_MOJO_API: '', VITE_MOJO_AUTH: 'hosted',
                VITE_MOJO_APP_VERSION: version,
            }),
        },
        build: { manifest: true, sourcemap: false, emptyOutDir: true },
    } : {}),
    // PORT lets the launcher assign a free port; 5199 is the manual-run default.
    server: { port: Number(process.env.PORT ?? 5199), strictPort: true },
}));
