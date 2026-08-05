import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' so the built dist can be mounted anywhere — including served
// as static files by a django-mojo instance itself.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: './',
    // PORT lets the launcher assign a free port; 5199 is the manual-run default.
    server: { port: Number(process.env.PORT ?? 5199), strictPort: true },
});
