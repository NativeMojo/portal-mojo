import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' — a static build that mounts anywhere, including a maestro
// sites publish (no server rewrite config needed; see the hash router below).
export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: './',
    server: { port: Number(process.env.PORT ?? 5299), strictPort: true },
});
