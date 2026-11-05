import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { hash: '', pathname: '/', search: '' }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const path = '/api/account/admin/signin';

    assert.deepEqual(admin.SIGNIN_ADMIN_PERMISSIONS, ['sys.manage_settings', 'sys.admin']);
    assert.equal(admin.SIGNIN_ADMIN_SECTION.basePath, 'system/sign-in');
    assert.equal(admin.SIGNIN_ADMIN_SECTION.navigationGroup, 'identity-access');
    assert(admin.ADMIN_SECTIONS.includes(admin.SIGNIN_ADMIN_SECTION));
    assert(admin.adminSectionRoutes([admin.SIGNIN_ADMIN_SECTION]).some((route) => route.path === 'system/sign-in'));

    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    assert.equal((await mock.mockFetch(path, {})).error_code, 401, 'anonymous callers are rejected');
    const viewer = await login('phone.viewer@nativemojo.com');
    assert.equal((await mock.mockFetch(path, { headers: viewer })).error_code, 403, 'callers without manage_settings/admin are rejected');
    const su = await login('dns.platform@nativemojo.com');

    const initial = (await mock.mockFetch(path, { headers: su })).data;
    assert.equal(initial.schema_version, 1);
    assert(initial.editable.includes('theme.app_title') && initial.editable.includes('login.methods'));
    assert.deepEqual(initial.options.layouts, ['minimal', 'compact', 'branded-panel', 'editorial']);
    assert(initial.options.layouts.includes(initial.auth.theme.layout), 'legacy layout tokens are normalized');
    const byName = Object.fromEntries(initial.providers.map((provider) => [provider.name, provider]));
    assert.deepEqual(Object.keys(byName), ['google', 'apple', 'github']);
    assert.equal(byName.apple.ready, false);
    assert.deepEqual(byName.apple.missing, ['Key ID', 'Private key (.p8)']);
    assert.equal(byName.apple.fields.find((field) => field.key === 'APPLE_CLIENT_ID').label, 'Services ID');
    assert.equal(byName.google.fields.every((field) => field.source === 'none'), true);
    assert.equal(byName.github.ready, true);
    assert(byName.github.fields.every((field) => field.source === 'deployment'));
    for (const provider of initial.providers) for (const field of provider.fields) if (field.secret) assert.equal(field.value, null, `${field.key} value never leaves the server`);
    assert.match(byName.apple.callback_url, /\/api\/auth\/oauth\/apple\/callback$/);

    const saved = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'theme.app_title': 'Acme', 'theme.layout': 'editorial' } } })).data;
    assert.equal(saved.auth.theme.app_title, 'Acme');
    assert.equal(saved.auth.theme.layout, 'editorial');
    const publicConfig = (await mock.mockFetch('/api/auth/config', { params: {} })).data;
    assert.equal(publicConfig.theme.app_title, 'Acme', '/api/auth/config reflects system saves');

    const noPassword = await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'login.methods': ['google'] } } });
    assert.equal(noPassword.status, false);
    assert.equal(noPassword.error_code, 400);
    assert.equal((await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'theme.api_base': 'x' } } })).error_code, 400, 'non-editable paths are rejected');
    assert.equal((await mock.mockFetch(path, { method: 'POST', headers: su, body: { auth: { 'theme.layout': 'card' } } })).error_code, 400);

    const key = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----';
    const apple = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', values: { APPLE_KEY_ID: 'KEY123', APPLE_PRIVATE_KEY: key, APPLE_TEAM_ID: '' } } })).data.providers.find((provider) => provider.name === 'apple');
    assert.equal(apple.ready, true);
    assert.equal(apple.fields.find((field) => field.key === 'APPLE_TEAM_ID').value, 'ABCDE12345', 'blank keeps the stored value');
    assert.equal(apple.fields.find((field) => field.key === 'APPLE_PRIVATE_KEY').value, null);
    const cleared = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', values: { APPLE_PRIVATE_KEY: null } } })).data.providers.find((provider) => provider.name === 'apple');
    assert.deepEqual(cleared.missing, ['Private key (.p8)']);

    const off = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', enabled: false } })).data;
    assert.equal(off.providers.find((provider) => provider.name === 'apple').enabled, false);
    assert(!off.auth.login.methods.includes('apple') && !off.auth.registration.methods.includes('apple'));
    const on = (await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'apple', enabled: true } })).data;
    assert(on.auth.login.methods.includes('apple') && on.auth.registration.methods.includes('apple'));
    assert.equal((await mock.mockFetch(path, { method: 'POST', headers: su, body: { provider: 'nope' } })).error_code, 400);

    // #8967: Microsoft label and icon, and optional server-supplied card notices.
    const render = (providers) => {
        const client = new QueryClient();
        client.setQueryData(admin.SIGNIN_QUERY_KEY, { ...on, providers });
        return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(admin.SigninPage)));
    };
    const quiet = on.providers.map((provider) => ({ ...provider, enabled: false }));
    const baseline = render(quiet);
    assert(!baseline.includes('signin-note'), 'providers without notices render no notes (older backends)');
    const microsoft = { ...quiet[0], name: 'microsoft', label: 'Microsoft', enabled: false, ready: false, missing: [], fields: [], notices: [
        { tone: 'info', text: 'No secret expiry date is recorded.' },
        { tone: 'warning', text: 'The client secret expires in 12 days.' },
        { tone: 'danger', text: 'The client secret expired on 2026-10-01.' },
        { tone: 'unknown', text: 'Unknown tones read as info.' },
        { tone: '__proto__', text: 'Inherited property names read as info too.' },
    ] };
    const markup = render([...quiet, microsoft]);
    assert.match(markup, /<i class="bi bi-microsoft"><\/i><\/span><div class="signin-provider-title"><h3 id="signin-provider-microsoft">Microsoft<\/h3>/);
    const notes = [...markup.matchAll(/<div class="(signin-note[^"]*)" role="status"><i class="bi ([^"]+)"><\/i><span>([^<]+)<\/span><\/div>/g)].map((match) => match.slice(1));
    assert.deepEqual(notes, [
        ['signin-note', 'bi-info-circle', 'No secret expiry date is recorded.'],
        ['signin-note is-warning', 'bi-exclamation-triangle', 'The client secret expires in 12 days.'],
        ['signin-note is-danger', 'bi-x-octagon', 'The client secret expired on 2026-10-01.'],
        ['signin-note', 'bi-info-circle', 'Unknown tones read as info.'],
        ['signin-note', 'bi-info-circle', 'Inherited property names read as info too.'],
    ]);

    // #9589: every callback URL and domain the server sends, the single-URL fallback, and the empty state.
    const page = await server.ssrLoadModule('/packages/portal-mojo/src/admin/signin/SigninPage.tsx');
    const mockApple = on.providers.find((provider) => provider.name === 'apple');
    assert.equal(mockApple.callback_urls.length, 2, 'the mock sends the lists for one provider');
    assert.deepEqual(mockApple.domains, ['api.example.com', 'app.example.com']);
    assert(on.providers.filter((provider) => provider.name !== 'apple').every((provider) => !('callback_urls' in provider)), 'the other mock providers stay single-URL');
    assert.deepEqual(page.callbackUrls({ callback_url: 'https://a/cb', callback_urls: [] }), ['https://a/cb'], 'an empty list falls back to callback_url');
    assert.deepEqual(page.callbackUrls({ callback_url: null }), []);
    assert.deepEqual(page.signinDomains({ domains: ['a.example.com', '', 'a.example.com', 'b.example.com'] }), ['a.example.com', 'b.example.com']);
    assert.deepEqual(page.signinDomains({}), [], 'domains are never derived from the URLs');

    const base = quiet.find((provider) => provider.name === 'google');
    const card = (markup, name) => markup.slice(markup.indexOf(`id="signin-provider-${name}"`), markup.indexOf('</section>', markup.indexOf(`id="signin-provider-${name}"`)));
    const inputs = (html, kind) => [...html.matchAll(new RegExp(`<input id="signin-${base.name}-${kind}-(\\d+)" class="input signin-code" readOnly="" value="([^"]*)"/>`, 'g'))].map((match) => [match[1], match[2]]);
    const variant = (changes) => card(render(quiet.map((provider) => provider.name === base.name ? { ...base, ...changes } : provider)), base.name);
    const urls = ['https://api.example.com/api/auth/oauth/google/callback', 'https://app.example.com/api/auth/oauth/google/callback', 'https://app.example.com:8443/api/auth/oauth/google/callback'];

    // (a) three URLs, duplicate domains
    const many = variant({ callback_url: urls[0], callback_urls: urls, domains: ['api.example.com', 'app.example.com', 'app.example.com'] });
    assert.deepEqual(inputs(many, 'callback'), urls.map((url, index) => [String(index), url]), 'every callback URL renders, in order, with its own id');
    assert.deepEqual(inputs(many, 'domain'), [['0', 'api.example.com'], ['1', 'app.example.com']], 'domains render once each');
    assert(many.includes('>Callback URLs</label>') && many.includes('Add each of these in the Google console'), 'several URLs read as a list');
    assert(many.includes('>Domains</label>') && many.includes('Only needed where the provider asks for login domains'), 'domains are labelled');
    assert.equal([...many.matchAll(/aria-label="Copy Google callback URL"/g)].length, 3, 'each URL has its own Copy button');
    assert.equal([...many.matchAll(/aria-label="Copy Google domain"/g)].length, 2, 'each domain has its own Copy button');

    // (b) an older backend: callback_url only
    const single = variant({ callback_url: urls[0] });
    assert.deepEqual(inputs(single, 'callback'), [['0', urls[0]]]);
    assert(single.includes('>Callback URL</label>') && single.includes('Paste this into the Google console as the redirect / callback URL.'), 'one URL keeps the current wording');
    assert(!single.includes('>Domains</label>'), 'no domains are invented for an older backend');

    // (c) no origin at all
    const none = variant({ callback_url: null, callback_urls: [], domains: [] });
    assert.deepEqual(inputs(none, 'callback'), [], 'no empty callback input');
    assert(!none.includes('>Domains</label>') && !none.includes('>Callback URL'), 'no callback or domain field');
    assert(none.includes('The server sent no callback URL. Check its BASE_URL and ALLOWED_REDIRECT_URLS settings, then reload this page.'));

    // (d) an empty list but a string callback_url
    assert.deepEqual(inputs(variant({ callback_url: urls[1], callback_urls: [] }), 'callback'), [['0', urls[1]]], 'an empty list falls back to the single URL');

    // Toggle, secret placeholders and field rows are unchanged by the callback variants.
    const rest = (html) => html.slice(0, html.indexOf('<p class="signin-provider-help">')) + html.slice(html.indexOf('<div class="signin-field-label-row">'));
    assert(rest(many).includes('role="switch"'), 'the card keeps its toggle');
    for (const other of [single, none]) assert.equal(rest(other), rest(many), 'only the callback and domain rows differ between variants');
    console.log('admin sign-in contract verified');
} finally {
    await server.close();
}
