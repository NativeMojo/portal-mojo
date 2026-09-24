import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: dom.window.sessionStorage, configurable: true });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{
    name: 'settings-table-fixture', enforce: 'pre',
    resolveId: id => id === '/__settings_ui.ts' ? id : null,
    load: id => id === '/__settings_ui.ts' ? `export * from '/packages/portal-mojo/src/ui/index.ts'; export const ModelTable = props => {globalThis.__settingsTable = props; return null;};` : null,
    transform: (source, id) => id.endsWith('/settings/SettingsPage.tsx') ? source.replace("from '../../ui'", "from '/__settings_ui.ts'") : null,
}] });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
const render = element => renderToStaticMarkup(React.createElement(QueryClientProvider, { client: queryClient }, element));
try {
    const { SettingsPage } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/settings/SettingsPage.tsx');
    const { SettingDetail } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/settings/SettingDetail.tsx');
    const { SettingModel } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/settings/model.ts');
    render(React.createElement(SettingsPage));
    const cell = globalThis.__settingsTable.columns.find(column => column.key === 'display_value');
    const value = JSON.stringify({ message: '<script>alert(1)</script>', items: Array.from({ length: 30 }, (_, id) => ({ id, description: 'long nested value' })) });
    const row = { id: 1, key: 'LARGE_JSON', value, display_value: value, is_secret: false, group: null, created: 1, modified: 1 };
    const preview = render(cell.render(row));
    assert(preview.length < 1200, 'Large settings must not dump their full value into the list');
    assert(!preview.includes('long nested value'), 'JSON contents belong in the detail viewer');
    assert(!preview.includes('<button'), 'The existing row action opens detail without a redundant button');
    assert.equal(typeof globalThis.__settingsTable.onRowClick, 'function');
    const detail = target => { SettingModel.useOne = () => ({ data: target, isPending: false }); return render(React.createElement(SettingDetail, { id: target.id, onClose() {} })); };
    const full = detail(row);
    const parsed = new JSDOM(full).window.document;
    assert.equal(parsed.querySelector('.json-block-body')?.textContent, JSON.stringify(JSON.parse(value), null, 2));
    assert.equal(parsed.querySelectorAll('script').length, 0, 'JSON is escaped text');
    assert(parsed.querySelector('.json-tok-key'), 'JSON uses syntax highlighting');
    assert.match(full, /Copy/, 'Full JSON is copyable');
    const plain = 'first line\n' + 'x'.repeat(2000);
    assert(render(cell.render({ ...row, value: plain, display_value: plain })).length < 1200, 'Long text stays bounded too');
    assert(detail({ ...row, value: plain, display_value: 'short server preview' }).includes(plain), 'Detail uses the complete raw value');
    assert.match(detail({ ...row, value: '{broken json', display_value: '{broken json' }), /\{broken json/, 'Invalid JSON remains readable');
    assert.match(render(cell.render({ ...row, value: 'hello', display_value: 'hello' })), /hello/);
    const secret = { ...row, is_secret: true, display_value: '******' };
    assert(!render(cell.render(secret)).includes('long nested value'));
    assert(!detail(secret).includes('long nested value'), 'A raw secret can never enter the viewer');
    console.log('Settings previews, formatted full values, safe text, and secret masking verified.');
} finally { queryClient.clear(); await server.close(); dom.window.close(); }
