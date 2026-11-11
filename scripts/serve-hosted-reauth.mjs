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
        // What the account has, picked on the fixture page (cookie): drives the modal's methods.
        const profiles = {
            both: { has_password: true, has_passkey: true, links: ['google'] },
            password: { has_password: true, has_passkey: false, links: [] },
            google: { has_password: false, has_passkey: false, links: ['google'] },
        };
        const json = (res, body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        const token = () => `e30.${Buffer.from(JSON.stringify({ uid: 4, email: 'operator@example.test', exp: Date.now() / 1000 + 7200, auth_time: Math.floor(Date.now() / 1000) })).toString('base64url')}.sig`;
        vite.middlewares.use((req, res, next) => {
            const path = new URL(req.url, 'http://localhost').pathname;
            const profile = profiles[/fixture_mix=(\w+)/.exec(req.headers.cookie ?? '')?.[1]] ?? profiles.google;
            if (path === '/api/user/me') return json(res, { status: true, data: { id: 4, has_password: profile.has_password, has_passkey: profile.has_passkey } });
            if (path === '/api/account/oauth_connection') return json(res, { status: true, data: profile.links.map((provider, i) => ({ id: i + 1, provider, is_active: true })), count: profile.links.length, start: 0, size: 50 });
            if (path === '/api/auth/config') return json(res, { status: true, data: { login: { methods: ['password', 'passkey', 'google'] } } });
            if (path === '/api/login') return json(res, { status: true, data: { access_token: token(), refresh_token: token(), user: { id: 4 } } });
            if (path !== '/auth') return next();
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
