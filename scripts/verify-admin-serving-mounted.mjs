// Mounted native Serving wizard: committed writes whose responses are lost
// must never be replayed as creates or described as definite refusals.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    if (state.mode === 'hold') return new Promise((resolve,reject)=>{state.release={resolve,reject};});
    state.stored = { ...body, id: id ?? 9127, domain: { id: 1, name: 'example.test' }, certificate: { id: 2, common_name: 'example.test' }, server_name: 'example.test' };
    if ((id == null && state.mode === 'create-lost') || (id != null && state.mode === 'enable-lost')) throw new TypeError('response connection dropped');
    return state.mode === 'create-malformed' ? {...state.stored,id:undefined} : state.stored;
};
state.route = async (id, body) => { state.calls.push({ route: true, id, body }); const row = { ...body, id: 72, upstream: { id: body.upstream, name: 'api' } }; state.routes.push(row); if (state.mode === 'route-lost') throw new TypeError('response connection dropped'); return row; };
const virtual = {
    '/__serving_api.ts': `export * from '/packages/portal-mojo/src/admin/edge/api.ts'; export const saveVhost = (id, body) => globalThis.__serving.save(id, body); export const saveVhostRoute = (id, body) => globalThis.__serving.route(id, body); export const listVhostRoutes = async () => globalThis.__serving.routes;`,
    '/__serving_runtime.ts': `export * from '/packages/portal-mojo/src/client/runtime.ts'; export const useMe = () => ({data:{id:1,is_superuser:true}});`,
    '/__serving_ui.ts': `export * from '/packages/portal-mojo/src/ui/index.ts'; import React from 'react'; export function CollectionSelect(p) { const certificate=p.model.endpoint.includes('certificate'); const upstream=p.model.endpoint.includes('upstream'); const row=certificate?{id:2,common_name:'example.test',sans:[]} :upstream?{id:3,name:'api'}:{id:1,name:'example.test'};return React.createElement('button',{type:'button',disabled:p.disabled||p.readOnly,onClick:()=>p.onChange(row.id,row)},p.label||'Upstream…'); }`,
};
const server = await createServer({ root: process.cwd(), appType:'custom', logLevel:'silent', server:{middlewareMode:true}, plugins:[{name:'serving-mounted-fixtures',enforce:'pre',resolveId:id=>id in virtual?id:null,load:id=>virtual[id]??null,transform(source,id){if(!id.endsWith('/admin/edge/VhostWizard.tsx'))return;const text = process.env.SERVING_REGRESSION_REF ? execFileSync('git',['show',`${process.env.SERVING_REGRESSION_REF}:${id.replace(`${process.cwd()}/`,'')}`],{encoding:'utf8'}) : source;return text.replace("from './api'","from '/__serving_api.ts'").replace("from '../../client/runtime'","from '/__serving_runtime.ts'").replace("from '../../ui'","from '/__serving_ui.ts'");}}] });
const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
const root = createRoot(document.getElementById('root'));
const settle = () => act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
const button = name => [...document.querySelectorAll('button')].find(n=>n.textContent.trim()===name);
const click = async name => { assert(button(name),`button ${name} exists`);await act(async()=>button(name).click());await settle(); };
const type = async (input,value) => act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
try {
    const { VhostWizard, openVhostWizard } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/VhostWizard.tsx');
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
    if (!process.env.SERVING_REGRESSION_CASE) {
    await mount('site');
    await click(button('Add hostname')?'Add hostname':'Create vhost');
    assert.equal(state.calls.length,1);
    assert.match(document.body.textContent,/unconfirmed|unknown|not confirmed/i,'a committed create with a lost response is explicitly unconfirmed');
    await click(button('Add hostname')?'Add hostname':'Create vhost');
    assert.equal(state.calls.length,1,'unacknowledged create is never blindly replayed');
    }
    for (const mode of (process.env.SERVING_REGRESSION_CASE ? [process.env.SERVING_REGRESSION_CASE] : ['route-lost', 'enable-lost'])) {
        state.mode=mode;
        await mount('site_api');
        await click(button('Add hostname')?'Add hostname':'Create vhost');
        assert.match(document.body.textContent,/outcome unconfirmed/i);
        assert.doesNotMatch(document.querySelector('.form-alert').textContent,/refused|still disabled/i,'unknown outcome is never called refused or still disabled');
        const writes=state.calls.length;
        assert.equal(state.calls.filter(call=>call.id===null&&!call.route).length,1);
        await click(button('Add hostname')?'Add hostname':'Create vhost'); // observation only
        assert.equal(state.calls.length,writes,'first finish after uncertainty only observes');
        state.mode='success';
        await click(button('Add hostname')?'Add hostname':'Create vhost');
        assert.equal(state.calls.filter(call=>call.id===null&&!call.route).length,1,'acknowledged create is retained');
        assert.equal(state.calls.filter(call=>call.route).length,1,'observed route is not posted twice');
        assert.equal(state.finish?.is_enabled,true);
    }

    if (!process.env.SERVING_REGRESSION_REF) {
        state.mode='create-malformed';await mount('site');await click('Add hostname');assert.match(document.body.textContent,/Create outcome unconfirmed/);await click('Add hostname');assert.equal(state.calls.length,1,'malformed create receipt is not acknowledged or replayed');
        async function initial(kind, row=null) {
            state.calls=[];state.mode='success';state.finish=null;state.routes=[];
            await act(async()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(VhostWizard,{key:Math.random(),row,onDone:value=>{state.finish=value;}}))));
            if(!row){
                assert(button('Domain') && button('Certificate'),'hostname naming and certificate are on the first surface');
                assert.equal(document.querySelector('.edge-advanced').open,false,'Advanced starts closed');
                await act(async()=>document.querySelectorAll('.edge-kind-card input')[['api','site','site_api','redirect'].indexOf(kind)].click());
                await click('Domain');await click('Certificate');
            }
        }
        for(const kind of ['api','site_api']) {
            await initial(kind);
            await click('Next');
            assert.equal(document.querySelector('.edge-advanced').open,true,'missing required hidden destination opens Advanced');
            assert(document.querySelector('.edge-advanced').contains(document.activeElement),'validation focuses Advanced destination control');
            assert.equal(state.calls.length,0);
        }
        for(const kind of ['api','site','redirect']) {
            await initial(kind);
            if(kind==='api'){await click('Configure API destination');await click('Upstream');}
            if(kind==='redirect')await type(document.querySelector('input[placeholder="www.example.com"]'),'target.example.test');
            const enabled=[...document.querySelectorAll('input[type="checkbox"]')].find(node=>node.parentElement.textContent.includes('Enabled'));
            await act(async()=>enabled.click());
            await click('Next');await click('Add hostname');
            assert.equal(state.calls.length,1);assert.equal(state.calls[0].body.kind,kind);assert.equal(state.calls[0].body.is_enabled,false,'disabled staging is preserved');
            assert.equal(state.calls[0].body.upstream,kind==='api'?3:null);
            assert.equal(state.calls[0].body.redirect_to,kind==='redirect'?'target.example.test':null);
        }
        const row={id:44,kind:'site',domain:{id:1,name:'example.test'},label:'',certificate:{id:2,common_name:'example.test'},pool:'custom',is_enabled:false,spa:true,body_size_mb:250,quiet_paths:[],serve_static:false};
        await initial('site',row);assert.equal(document.querySelector('.edge-advanced').open,true,'nondefault edit settings open Advanced');
        await act(async()=>document.querySelectorAll('.edge-kind-card input')[2].click());
        await click('Save changes');assert.equal(state.calls.length,1);assert.equal(state.calls[0].body.kind,'site_api','route-less supported conversion remains available');assert.equal(state.calls[0].body.pool,'custom');assert.equal(state.calls[0].body.body_size_mb,250);
        await initial('site');
        await act(async()=>{document.querySelector('.edge-advanced').open=true;document.querySelector('.edge-advanced').dispatchEvent(new Event('toggle'));});
        const pool=[...document.querySelectorAll('label.field')].find(node=>node.textContent.startsWith('Pool')).querySelector('input');await type(pool,'custom');
        await act(async()=>{document.querySelector('.edge-advanced').open=false;document.querySelector('.edge-advanced').dispatchEvent(new Event('toggle'));});
        await click('Next');await click('Add hostname');assert.equal(state.calls[0].body.pool,'custom','collapsing Advanced retains controlled values');
        // Explicit backend rejection remains retryable at the failed step.
        const {MojoError}=await server.ssrLoadModule('/packages/portal-mojo/src/client/runtime.ts');
        const originalRoute=state.route;
        let rejectOnce=true;
        state.route=async(id,body)=>{if(rejectOnce){rejectOnce=false;state.calls.push({route:true,id,body});throw new MojoError('selected upstream is disabled',400);}return originalRoute(id,body);};
        state.mode='success';await mount('site_api');await click('Add hostname');assert.match(document.querySelector('.form-alert').textContent,/route.*refused.*selected upstream is disabled/);await click('Add hostname');assert.equal(state.calls.filter(call=>call.id===null&&!call.route).length,1);assert.equal(state.finish?.is_enabled,true);state.route=originalRoute;
        // Real modal opener + real native cancellation path while a write is held.
        const ui=await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
        await act(async()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(ui.ModalHost))));
        let done=false;
        await act(async()=>{void openVhostWizard().then(()=>{done=true;});});
        await act(async()=>document.querySelectorAll('.edge-kind-card input')[1].click());await click('Domain');await click('Certificate');await click('Next');state.mode='hold';await click('Add hostname');
        await act(async()=>{document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));document.querySelector('dialog').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));});
        assert.equal(done,false);assert(document.querySelector('dialog'));assert.equal(button('Cancel').disabled,true);
        await act(async()=>state.release.reject(new TypeError('response connection dropped')));await settle();assert.equal(button('Cancel').disabled,false);await click('Cancel');assert.equal(done,true);
    }
    console.log('verify-admin-serving-mounted: create, route and final-enable response loss require observation; acknowledged progress is retained without duplicate creates or routes.');
} finally { await act(async()=>root.unmount());await server.close(); }
