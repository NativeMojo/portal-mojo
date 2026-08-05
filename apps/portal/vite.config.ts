import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' so the built dist can be mounted anywhere — including served
// as static files by a django-mojo instance itself.
export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: './',
    server: { port: 5199, strictPort: true },
});
