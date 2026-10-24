// Mounted regressions for modal effects and retained lifecycle exceptions.
// JSDOM deliberately does not claim native dialog/focus/layout coverage.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window','document','HTMLElement','HTMLInputElement','HTMLSelectElement','Event','MouseEvent','CustomEvent','Node']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const nativeMatches=HTMLElement.prototype.matches; HTMLElement.prototype.matches=function(selector){return selector===':popover-open'?this.hasAttribute('data-test-open'):nativeMatches.call(this,selector);};
HTMLElement.prototype.showPopover=function(){this.setAttribute('data-test-open','');}; HTMLElement.prototype.hidePopover=function(){this.removeAttribute('data-test-open');};
globalThis.ResizeObserver=class { observe(){} disconnect(){} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = await import('react'); const { createRoot } = await import('react-dom/client'); const { act } = React;
const requests = [], errors = [], deleted = []; let confirmation;
const fixture = globalThis.__modal4156 = { can: true, user: { id: 7 }, requests, errors, deleted,
    purge: params => new Promise((resolve, reject) => requests.push({ params, resolve, reject })),
    confirm: () => new Promise(resolve => { confirmation = resolve; }),
    remove: async target => { deleted.push(target); },
};
const runtime = `export * from '/packages/portal-mojo/src/client/runtime.ts'; export const useCan=()=>({can:globalThis.__modal4156.can,me:globalThis.__modal4156.user}); export const useMe=()=>({data:globalThis.__modal4156.user});`;
const model = `export * from '/packages/portal-mojo/src/admin/identity/users/models.ts'; const model={useList:()=>({data:{rows:[{id:3,provider:'GitHub',friendly_name:'Laptop',rp_id:'example.test',is_enabled:true,created:1,sign_count:0,transports:['usb']}]}}),useDelete:()=>({isPending:false,mutateAsync:target=>globalThis.__modal4156.remove(target)}),useSave:()=>({isPending:false,mutateAsync:async()=>{}})}; export const OAuthConnectionModel=model; export const PasskeyModel=model;`;
const ruleModels = `export * from '/packages/portal-mojo/src/admin/rules/models.ts'; export const RuleSetModel={useOne:()=>globalThis.__modal4156.parentQuery,useSave:()=>({})}; export const RuleModel={useList:()=>globalThis.__modal4156.rulesQuery,useDelete:()=>({mutateAsync:target=>globalThis.__modal4156.removeRule(target)})};`;
const ruleUI = `export * from '/packages/portal-mojo/src/ui/index.ts'; import React from 'react'; export const DetailView=props=>React.createElement(React.Fragment,null,props.sections.filter(s=>s.key==='conditions').map(s=>React.createElement(React.Fragment,{key:s.key},s.render()))); export const ModelTable=props=>{globalThis.__modal4156.ruleActions=props.batchActions;globalThis.__modal4156.ruleScope=props.fixedParams;return null;};`;
const virtual = { '/__4156_rules.ts': ruleModels, '/__4156_rule_ui.ts': ruleUI, '/__4156_runtime.ts': runtime, '/__4156_models.ts': model, '/__4156_control.ts': `export * from '/packages/portal-mojo/src/admin/jobs/control.ts'; export const purgeJobs = params => globalThis.__modal4156.purge(params);` };
const targets = ['jobs/sections/JobOperationsSection.tsx','identity/users/sections/OAuthSection.tsx','identity/users/sections/actions.tsx','rules/RuleSetDetailPage.tsx'];
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{ name: 'modal-boundary-fixtures', enforce: 'pre', resolveId: id => id in virtual ? id : null, load: id => virtual[id], transform(source,id) {
    if (id.endsWith('/ui/DetailView.tsx')) return source.replace("from '../client/me'", "from '/__4156_runtime.ts'");
    if (id.endsWith('/ui/Popover.tsx') && process.env.POPOVER_REGRESSION_REF) return execFileSync('git', ['show', `${process.env.POPOVER_REGRESSION_REF}:packages/portal-mojo/src/ui/Popover.tsx`], { encoding: 'utf8' });
    if (id.endsWith('/account/PasskeyList.tsx')) {
        // The shared passkey list (portal-mojo/account) backs the admin modal.
        if (process.env.MODAL_REGRESSION_REF) source = execFileSync('git', ['show', `${process.env.MODAL_REGRESSION_REF}:${id.replace(process.cwd() + '/', '')}`], { encoding: 'utf8' });
        return source.replace("from '../client/runtime'", "from '/__4156_runtime.ts'").replace("from './models'", "from '/__4156_models.ts'").replace("from './credential-models'", "from '/__4156_models.ts'");
    }
    if (!targets.some(path => id.endsWith('/admin/' + path))) return;
    if (process.env.MODAL_REGRESSION_REF) source = execFileSync('git', ['show', `${process.env.MODAL_REGRESSION_REF}:${id.replace(process.cwd() + '/', '')}`], { encoding: 'utf8' });
    source = source.replace(/from ['"](?:\.\.\/)+client\/runtime['"]/g, `from '/__4156_runtime.ts'`);
    if (id.includes('/jobs/')) source = source.replace("from '../control'", "from '/__4156_control.ts'");
    if (id.includes('/identity/')) source = source.replace(/from '\.\.\/models'/g, `from '/__4156_models.ts'`);
    if (id.endsWith('/rules/RuleSetDetailPage.tsx')) source = source.replace("from './models'", "from '/__4156_rules.ts'").replace("from '../../ui'", "from '/__4156_rule_ui.ts'");
    return source;
} }] });
const { QueryClient, QueryClientProvider, useQuery } = await import('@tanstack/react-query');
let root; const queryClient = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
const renderElement=(Component,props)=>React.createElement(QueryClientProvider,{client:queryClient},React.createElement(React.StrictMode,null,React.createElement(Component,props)));
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text);
const click = async text => { const element = button(text); assert(element, `Missing button ${text}`); assert(!element.disabled, `${text} disabled`); await act(async () => { element.click(); }); };
const mount = async (Component, props) => { root = createRoot(document.getElementById('root')); await act(async () => root.render(renderElement(Component,props))); };
const unmount = async () => { await act(async () => root.unmount()); };
const reply = async (index, value, reject = false) => { await act(async () => { requests[index][reject ? 'reject' : 'resolve'](value); }); };
try {
    const ui = await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    ui.modal.confirm = fixture.confirm; ui.toast.error = value => errors.push(value); ui.toast.success = () => {};
    const { PurgeDialog } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/jobs/sections/JobOperationsSection.tsx');
    let executing = false, closes = 0;
    await mount(PurgeDialog, { onClose: () => closes++, onExecuting: next => { executing = next; } });
    await click('Preview'); assert.equal(requests.length, 1);
    await reply(0, { dry_run: true, count: 4, cutoff: '2020-01-01' });
    assert(!button('Purge').disabled, 'StrictMode effect replay must still accept the real mounted preview');
    await click('Purge'); assert(button('Click again to delete 4 job(s)'), 'Preview arms the shown count');
    const input = document.querySelector('input');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'7'); input.dispatchEvent(new Event('input',{bubbles:true})); });
    assert(button('Purge').disabled, 'Editing the filter clears previously armed eligibility');
    await click('Preview');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'8'); input.dispatchEvent(new Event('input',{bubbles:true})); });
    await click('Preview'); assert.equal(requests.length, 3);
    await reply(1, { dry_run: true, count: 99, cutoff: '2020-01-01' }); assert(button('Purge').disabled, 'Stale editable-filter response is ignored');
    await reply(2, { dry_run: true, count: 2, cutoff: '2020-02-01' });
    await click('Purge'); await click('Click again to delete 2 job(s)');
    assert(executing); assert(input.disabled); assert(document.querySelector('select').disabled); assert(button('Cancel').disabled);
    assert.deepEqual(requests[3].params, { daysOld: 8, status: null });
    await reply(3, new Error('server refused purge'), true); assert(!executing); assert(button('Purge').disabled, 'Rejected purge requires a new preview'); assert(errors.includes('server refused purge'));
    await click('Preview'); await unmount(); await reply(4, { dry_run: true, count: 9, cutoff: '2020-01-01' }); assert.equal(closes, 0);
    console.log('Mounted StrictMode purge: preview accepted, edited-filter stale response ignored, rearmed tuple frozen, execution disables filters/cancel, refusal requires re-preview, unmount ignores response.');
    fixture.can = false;
    const { OAuthConnectionList } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/identity/users/sections/OAuthSection.tsx');
    await mount(OAuthConnectionList, { userId: 7 }); await click('Unlink'); await act(async () => confirmation(true)); assert.equal(deleted.length, 1, 'Owner without admin retains unlink');
    await click('Unlink'); fixture.user = { id: 8 }; await act(async () => root.render(renderElement(OAuthConnectionList,{userId:7}))); await act(async () => confirmation(true)); assert.equal(deleted.length,1,'Permission loss refuses pending owner unlink'); await unmount();
    fixture.user = { id: 7 }; await mount(OAuthConnectionList,{userId:7}); await click('Unlink'); await unmount(); await act(async () => confirmation(true)); assert.equal(deleted.length,1,'Unmount invalidates pending confirmation');
    const { PasskeyList } = await server.ssrLoadModule('/packages/portal-mojo/src/account/PasskeyList.tsx');
    await mount(PasskeyList,{userId:7}); await click('Remove'); await act(async () => confirmation(true)); assert.equal(deleted.length,2,'Owner without admin retains passkey removal');
    await click('Remove'); await unmount(); await act(async () => confirmation(true)); assert.equal(deleted.length,2);
    fixture.user = { id: 8 }; await mount(PasskeyList,{userId:7}); assert(button('Remove').closest('[inert]'),'Without live ownership or admin the row actions are inert'); await unmount(); fixture.user = { id: 7 };
    console.log('Mounted credential exceptions: owner without admin, live owner loss, and unmount through nested OAuth/passkey confirmations.');

    fixture.can = true;
    fixture.parentQuery = {data:{id:1,name:'Routing rules',match_by:0,is_active:true,metadata:{}},refetch:async()=>{fixture.parentRefreshes++;return fixture.parentQuery;}};
    fixture.rulesQuery = {data:{count:2,rows:[{id:1,name:'Country',index:0},{id:2,name:'Risk',index:1}]},refetch:async()=>{fixture.ruleRefreshes++;return fixture.rulesQuery;}};
    fixture.parentRefreshes=0; fixture.ruleRefreshes=0;
    fixture.removeRule=async({id})=>{if(id===2)throw new Error('server refused');};
    const { RuleSetDetail } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/rules/RuleSetDetailPage.tsx');
    await mount(RuleSetDetail,{id:1,onClose(){}});
    assert.deepEqual(fixture.ruleScope,{parent:1},'Condition table parent must be fixed, not a clearable filter');
    let action=fixture.ruleActions[0]; let preparation;
    await act(async()=>{preparation=action.prepare(fixture.rulesQuery.data.rows);}); await act(async()=>confirmation(true)); assert.deepEqual(await preparation,[1,2]);
    await assert.rejects(action.runBatch(fixture.rulesQuery.data.rows),/1 removed; 1 refused/); assert.equal(fixture.parentRefreshes,2); assert.equal(fixture.ruleRefreshes,2);
    fixture.parentQuery.error=new Error('refresh refused'); assert.equal(await action.prepare(fixture.rulesQuery.data.rows),null); delete fixture.parentQuery.error;
    await act(async()=>{preparation=action.prepare(fixture.rulesQuery.data.rows);}); fixture.can=false; await act(async()=>root.render(renderElement(RuleSetDetail,{id:1,onClose(){}}))); await act(async()=>confirmation(true)); assert.equal(await preparation,null); await unmount();
    console.log('Mounted Rule condition exception: authoritative prepare, surfaced refresh refusal, partial failure refreshes parent/children, and permission loss through confirmation.');

    // Assistant Memory's current dialogs and live authority use the real client/auth
    // fixtures in verify-admin-assistant-pages.mjs, including the former scope,
    // removal-refusal and confirmation-lifetime exceptions covered here.
    function MenuHost(){const anchor=React.useRef(null);const [open,setOpen]=React.useState(false);return React.createElement('dialog',{open:true},React.createElement('button',{ref:anchor,onClick:()=>setOpen(true)},'Anchor'),React.createElement(ui.Popover,{anchorRef:anchor,open,onClose:()=>setOpen(false)},React.createElement('button',{role:'menuitem'},'Nested operation')));}
    await mount(MenuHost,{}); await click('Anchor'); assert.equal(document.querySelector('[role="menuitem"]').closest('[popover]').parentElement.tagName,'DIALOG','Native popovers must remain within the modal subtree to escape document inertness'); await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));document.querySelector('[role="menuitem"]').focus();document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));}); assert.equal(document.activeElement.textContent,'Anchor','Escape restores the anchor focus'); await unmount();
    console.log('Mounted native-popover host regression: menu stays in the dialog subtree. Native pointer/focus proof remains browser-owned.');
    const detailSections = [{key:'one',label:'One',render:()=>React.createElement('p',null,'First')},{key:'two',label:'Two',render:()=>React.createElement('p',null,'Second')}];
    await mount(ui.DetailView,{title:'Keyboard fixture',sections:detailSections});
    await act(async()=>document.querySelector('.detail-section-toggle').click());
    const secondSection=[...document.querySelectorAll('.detail-rail button')].find(node=>node.textContent.trim()==='Two');
    await act(async()=>{secondSection.focus();secondSection.click();});
    assert(document.activeElement===document.querySelector('.detail-section-toggle'),'Compact selection must restore focus before hiding the focused rail');
    await unmount(); console.log('Mounted compact navigation: section selection returns focus to the visible toggle.');
    const { CertificateLifecyclePoller } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/CertificateLifecyclePoller.tsx');
    const { CertificateModel } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/models.ts');
    const certKey=CertificateModel.keys.one(999);
    queryClient.setQueryData(certKey,{id:999,domain:1,status:'active',renew_after:Date.now()/1000+86400,not_after:Date.now()/1000+172800,attempts:1});
    function CertificateObserver(){useQuery({queryKey:certKey,queryFn:async()=>null,enabled:false});return null;}
    function CertificateHost({inspect=false}){return React.createElement(React.Fragment,null,React.createElement(CertificateLifecyclePoller,{}),inspect&&React.createElement(CertificateObserver,{}));}
    const renderErrors=[]; const oldConsoleError=console.error; console.error=(...args)=>{renderErrors.push(args.join(' '));};
    try {
        await mount(CertificateHost,{});
        await act(async()=>root.render(renderElement(CertificateHost,{inspect:true})));
        await unmount();
    } finally { console.error=oldConsoleError; }
    assert(!renderErrors.some(message=>message.includes('while rendering a different component')),'Opening a certificate observer must not update its lifecycle poller during render');
    console.log('Mounted certificate lifecycle: opening a cached certificate observer does not schedule a cross-component render update.');
} finally { queryClient.clear(); await server.close(); dom.window.close(); delete globalThis.__modal4156; }
