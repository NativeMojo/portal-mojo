// Mounted native Serving wizard: committed writes whose responses are lost
// must never be replayed as creates or described as definite refusals.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','Event','MouseEvent','CustomEvent','Node']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const state = globalThis.__serving = { calls: [], mode: 'create-lost', stored: null, routes: [], finish: null };
state.save = async (id, body) => {
    state.calls.push({ id, body });
    state.stored = { ...body, id: id ?? 9127, domain: { id: 1, name: 'example.test' }, certificate: { id: 2, common_name: 'example.test' }, server_name: 'example.test' };
    if ((id == null && state.mode === 'create-lost') || (id != null && state.mode === 'enable-lost')) throw new TypeError('response connection dropped');
    return state.stored;
};
state.route = async (id, body) => { state.calls.push({ route: true, id, body }); const row = { ...body, id: 72, upstream: { id: body.upstream, name: 'api' } }; state.routes.push(row); if (state.mode === 'route-lost') throw new TypeError('response connection dropped'); return row; };
const virtual = {
    '/__serving_api.ts': `export * from '/packages/portal-mojo/src/admin/edge/api.ts'; export const saveVhost = (id, body) => globalThis.__serving.save(id, body); export const saveVhostRoute = (id, body) => globalThis.__serving.route(id, body); export const listVhostRoutes = async () => globalThis.__serving.routes;`,
    '/__serving_runtime.ts': `export * from '/packages/portal-mojo/src/client/runtime.ts'; export const useMe = () => ({data:{id:1,is_superuser:true}});`,
    '/__serving_ui.ts': `export * from '/packages/portal-mojo/src/ui/index.ts'; import React from 'react'; export function CollectionSelect(p) { const certificate=p.model.endpoint.includes('certificate'); const upstream=p.model.endpoint.includes('upstream'); const row=certificate?{id:2,common_name:'example.test',sans:[]} :upstream?{id:3,name:'api'}:{id:1,name:'example.test'};return React.createElement('button',{type:'button',disabled:p.disabled||p.readOnly,onClick:()=>p.onChange(row.id,row)},p.label||'Upstream…'); }`,
};
const server = await createServer({ root: process.cwd(), appType:'custom', logLevel:'silent', server:{middlewareMode:true}, plugins:[{name:'serving-mounted-fixtures',enforce:'pre',resolveId:id=>id in virtual?id:null,load:id=>virtual[id]??null,transform(source,id){if(!id.endsWith('/admin/edge/VhostWizard.tsx'))return;return source.replace("from './api'","from '/__serving_api.ts'").replace("from '../../client/runtime'","from '/__serving_runtime.ts'").replace("from '../../ui'","from '/__serving_ui.ts'");}}] });
const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
const root = createRoot(document.getElementById('root'));
const settle = () => act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
const button = name => [...document.querySelectorAll('button')].find(n=>n.textContent.trim()===name);
const click = async name => { assert(button(name),`button ${name} exists`);await act(async()=>button(name).click());await settle(); };
const type = async (input,value) => act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
try {
    const { VhostWizard } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/VhostWizard.tsx');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/models.ts');
    const dns = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/models.ts');
    models.EdgeVhostModel.invalidate = models.EdgeRouteModel.invalidate = async()=>{};
    models.EdgeVhostModel.fetchOne = async()=>state.stored;
    dns.CertificateModel.fetchOne = async()=>({id:2,common_name:'example.test',sans:[]});
    async function mount(kind) {
        state.calls=[]; state.stored=null; state.routes=[]; state.finish=null;
        await act(async()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(VhostWizard,{key:Math.random(),onDone:value=>{state.finish=value;}}))));
        await act(async()=>document.querySelectorAll('.edge-kind-card input')[kind==='site'?1:2].click());
        // Current and simplified wizard both keep the native navigation.
        if(!button('Domain')) await click('Next');
        await click('Domain');
        if(button('Next')) await click('Next');
        if(kind==='site_api') {
            if(button('Configure API paths')) await click('Configure API paths');
            await click('Add route');
            await type(document.querySelector('[aria-label="Path prefix"]'),'/api');
            await click('Upstream…');
        }
        // Advance to certificate when it isn't on the initial basic surface.
        if(!button('Certificate')) await click('Next');
        await click('Certificate');
        while(button('Next')) await click('Next');
    }
    await mount('site');
    await click(button('Add hostname')?'Add hostname':'Create vhost');
    assert.equal(state.calls.length,1);
    assert.match(document.body.textContent,/unconfirmed|unknown|not confirmed/i,'a committed create with a lost response is explicitly unconfirmed');
    await click(button('Add hostname')?'Add hostname':'Create vhost');
    assert.equal(state.calls.length,1,'unacknowledged create is never blindly replayed');
    console.log('verify-admin-serving-mounted: committed create response loss blocks duplicate replay.');
} finally { await act(async()=>root.unmount());await server.close(); }
