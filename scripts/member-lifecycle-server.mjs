import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';

// Test-only: the browser intercepts every /api request; never use real credentials.
// MEMBER_REGRESSION_REF allows the same assertions to demonstrate the old bug.
const server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: 'node_modules/.cache/member-lifecycle',
    define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('http://127.0.0.1:5296') },
    server: { host: '127.0.0.1', port: 5296, strictPort: true },
    plugins: [tailwindcss(), {
        name: 'member-regression-source', enforce: 'pre',
        transform(source, id) {
            if (process.env.MEMBER_REGRESSION_REF && ['/members/member-flows.tsx', '/members/MemberDetail.tsx'].some(path => id.endsWith(path))) {
                return execFileSync('git', ['show', `${process.env.MEMBER_REGRESSION_REF}:${id.slice(process.cwd().length + 1)}`], { encoding: 'utf8' });
            }
        },
    }, {
        name: 'fixture-html',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url !== '/') return next();
                res.setHeader('Content-Type', 'text/html');
                res.end('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/member-lifecycle.tsx"></script></body></html>');
            });
        },
    }],
    esbuild: { jsx: 'automatic' },
});
await server.listen();
console.log('member lifecycle fixture ready on http://127.0.0.1:5296');
