// Local browser proof of the real Portal host/bridge. Provider sign-in is simulated.
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'portal-hosted-reauth-'));
const server = await createServer({
    root, cacheDir, configFile: join(root, 'apps/portal/vite.config.ts'), mode: 'django-admin',
    server: { host: '127.0.0.1', port: 5218, strictPort: true },
    plugins: [{ name: 'configured-login-fixture', configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
            if (new URL(req.url, 'http://localhost').pathname !== '/auth') return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
                <h1>Configured sign-in fixture</h1><p>Local simulation only. Configured method: Google.</p>
                <button id="google">Continue with Google</button><button id="cancel">Cancel</button>
                <script>
                document.getElementById('google').onclick = () => {
                    const payload = btoa(JSON.stringify({uid:4,email:'operator@example.test',exp:Date.now()/1000+7200,auth_time:Math.floor(Date.now()/1000)}));
                    localStorage.setItem('access_token','e30.'+payload+'.sig');
                    localStorage.setItem('refresh_token','e30.'+payload+'.sig');
                    location.href = new URLSearchParams(location.search).get('redirect');
                };
                document.getElementById('cancel').onclick = () => history.back();
                </script></body></html>`);
        });
    } }],
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await server.close(); await rm(cacheDir, { recursive: true, force: true }); process.exit(0);
});
await server.listen();
console.log('Open http://127.0.0.1:5218/scripts/fixtures/hosted-reauth.html?keep=1#/system/credentials?group=7');
