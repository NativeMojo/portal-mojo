// Registration-specific mounted contracts. Parent owns real native layout QA.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/dns/domains' });
for (const key of ['window','document','location','Element','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLDialogElement','Event','MouseEvent','Node','localStorage','sessionStorage','CustomEvent']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
window.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react'), { act } = React, { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { MemoryRouter } = await import('react-router-dom');
const server = await createServer({ root:process.cwd(), appType:'custom', logLevel:'silent', server:{middlewareMode:true}, plugins:[{name:'registration-peer',enforce:'pre',transform(source,id){if(id.endsWith('/client/mock.ts')) return source.replace('export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> {','export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> { if ((globalThis as any).__registrationPeer) { const value = await (globalThis as any).__registrationPeer(path, opts); if(value !== undefined) return value; }');}}] });
let root, qc, ui, auth;
const domain = {id:8201,name:'registration.example',provider:'route53',status:'active',group:{id:1,name:'Group One'},auto_renew:false,privacy:false};
const contact = { FirstName:'Private-canary',LastName:'Operator',ContactType:'PERSON',AddressLine1:'123 Private Street',City:'Town',State:'CA',CountryCode:'US',ZipCode:'90000',PhoneNumber:'+1.5555550100',Email:'private-canary@example.test',Fax:'+1.5555550101',ExtraParams:[{Name:'RegistryKey',Value:'keep-local'}] };
const original = () => ({name:domain.name,registrar:'Amazon Registrar, Inc.',auto_renew:true,privacy:true,admin_privacy:true,registrant_privacy:true,tech_privacy:true,privacy_supported:true,expires:1800000000,registrant:{...contact},admin:{...contact},tech:{...contact},secret:'DO-NOT-KEEP'});
let evidence, calls, failRead=false, loseSave=false, holdRead=false, holdPost=false, releases=[];
const peer = async (path, opts={}) => {
    if (path !== '/api/dnsman/whois' && path !== '/api/dnsman/whois/privacy' && path !== '/api/dnsman/domain/8201') return;
    calls.push({path,method:opts.method??'GET',body:opts.body,params:opts.params});
    if(path==='/api/dnsman/domain/8201') {
        if(opts.method==='POST') { if(holdPost) await new Promise(resolve=>releases.push(resolve)); if(loseSave)return {status:false,error:'Private server diagnostic',error_code:503}; return {status:true,data:{...domain,...opts.body}}; }
        return {status:true,data:domain};
    }
    if(opts.method==='POST') {
        if(holdPost)await new Promise(resolve=>releases.push(resolve));
        if(loseSave)return {status:false,error:'Private server diagnostic',error_code:503};
        if(path.endsWith('/privacy')) for(const key of ['privacy','admin_privacy','registrant_privacy','tech_privacy']) evidence[key]=opts.body.enabled;
        else for(const key of ['registrant','admin','tech']) evidence[key]={...opts.body.contact};
        return {status:true,data:{name:domain.name,operation_id:'op-safe',privacy:evidence.privacy}};
    }
    const value=structuredClone(evidence);
    if(holdRead)await new Promise(resolve=>releases.push(resolve));
    return failRead?{status:false,error:'No registered domain',error_code:404}:{status:true,data:value};
};
const reset=()=>{evidence=original();calls=[];failRead=false;loseSave=false;holdRead=false;holdPost=false;releases=[];globalThis.__registrationPeer=peer;};
const flush=async()=>{await act(async()=>new Promise(resolve=>setTimeout(resolve,15)));};
const wait=async check=>{for(let i=0;i<100;i++){await flush();if(check())return;}assert.fail(document.body.textContent);};
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
const click=async text=>{await wait(()=>button(text)&&!button(text).disabled);await act(async()=>button(text).click());await flush();};
const select=async(label,value)=>{const node=[...document.querySelectorAll('label')].find(node=>node.textContent.includes(label))?.querySelector('select');assert(node,label);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('change',{bubbles:true}));});};
const change=async(label,value)=>{const node=[...document.querySelectorAll('label')].find(node=>node.textContent.includes(label))?.querySelector('input');assert(node,label);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});};
let props, Panel;
const render=()=>React.createElement(React.StrictMode,null,React.createElement(QueryClientProvider,{client:qc},React.createElement(MemoryRouter,null,React.createElement(Panel,props),React.createElement(ui.ModalHost))));
const mount=async more=>{props={domain,...more};qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});root=createRoot(document.getElementById('root'));await act(async()=>root.render(render()));await flush();};
const unmount=async()=>{await act(async()=>{root?.unmount();ui.modal.closeAll();});root=null;qc?.clear();};
try {
    auth=await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');auth.initAuth();
    ui=await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
    ({DomainRegistrationPanel:Panel}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainRegistrationPanel.tsx'));
    const api=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/registrar-api.ts');
    assert.equal(api.registrationAuthority(null),'unknown');assert.equal(api.registrationAuthority('GoDaddy.com, LLC'),'godaddy');assert.equal(api.registrationAuthority('Amazon Registrar, Inc.'),'route53');assert.equal(api.registrationAuthority('Some Registrar'),'unknown');
    await auth.login('dns.viewer@nativemojo.com','mojo');reset();await mount();assert(!button('Read registration'));assert.equal(calls.length,0);await unmount();
    await auth.login('dns.manager@nativemojo.com','mojo');reset();await mount({domain:{...domain,provider:'godaddy'}});await wait(()=>document.querySelector('a[href="https://dcc.godaddy.com/domains"]'));assert.equal(calls.length,0);await unmount();
    reset();await mount();await wait(()=>button('Read registration'));assert.equal(calls.length,0,'PII requires explicit read');await click('Read registration');await wait(()=>button('Registration settings…'));assert.equal(calls.filter(c=>c.path.endsWith('/whois')).length,1);assert(!document.body.textContent.includes('Private-canary'),'Overview omits contact PII');assert(!JSON.stringify(qc.getQueryCache().getAll().map(q=>q.state.data)).includes('Private-canary'));await click('Contacts…');assert(document.body.textContent.includes('Private-canary'));assert.deepEqual([...document.querySelectorAll('[aria-label="Registrar contact roles"] [role="tab"]')].map(n=>n.textContent),['Registrant','Admin','Technical']);await click('Admin');await click('Close');assert(!document.body.textContent.includes('Private-canary'));await unmount();
    for(const registrar of [null,'GoDaddy.com, LLC','Unknown registrar']){reset();evidence.registrar=registrar;await mount();await click('Read registration');await wait(()=>button('Refresh registration'));assert(!button('Registration settings…'));assert(!button('Contacts…'));await unmount();}
    reset();failRead=true;await mount();await click('Read registration');await wait(()=>document.body.textContent.includes('could not be read'));assert(!button('Registration settings…'));await unmount();
    reset();evidence.name='other.example';await mount();await click('Read registration');await wait(()=>document.body.textContent.includes('could not be read'));assert(!button('Registration settings…'));await unmount();
    reset();evidence.privacy_supported=false;await mount();await click('Read registration');await click('Registration settings…');assert([...document.querySelectorAll('option')].find(node=>node.textContent==='Enable for all contacts').disabled,'Unsupported privacy cannot be enabled');assert.equal(calls.filter(c=>c.method==='POST').length,0);await unmount();
    console.log('PASS registration admission: explicit live manager read, no viewer/provider requests, unknown registrar refusal, exact identity, modal-only PII');
    reset();let busy=false,changed=0;await mount({onBusyChange:value=>busy=value,onChanged:()=>changed++});await click('Read registration');await click('Registration settings…');await select('Auto-renew','false');holdPost=true;await act(async()=>{button('Save registration settings').click();button('Save registration settings').click();});await wait(()=>releases.length===1);assert(busy);assert(button('Close').disabled);const native=document.querySelector('dialog'),cancel=new Event('cancel',{cancelable:true});await act(async()=>native.dispatchEvent(cancel));assert(cancel.defaultPrevented);await act(async()=>releases.shift()());holdPost=false;await wait(()=>!busy&&button('Close')&&!button('Close').disabled);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.deepEqual(calls.find(c=>c.method==='POST').body,{auto_renew:false});assert(document.body.textContent.includes('not yet reported'),'DB acknowledgement alone is not provider apply proof');assert(button('Save registration settings').disabled);assert.equal(changed,1);await click('Close');await unmount();
    reset();await mount();await click('Read registration');await click('Registration settings…');await select('WHOIS privacy','false');await click('Save registration settings');await wait(()=>document.body.textContent.includes('now visible'));assert.deepEqual(calls.find(c=>c.method==='POST').body,{domain:8201,enabled:false});assert.equal(calls.find(c=>c.method==='POST').path,'/api/dnsman/whois/privacy');await click('Close');await unmount();
    reset();loseSave=true;await mount();await click('Read registration');await click('Registration settings…');await select('Auto-renew','false');await click('Save registration settings');await wait(()=>document.body.textContent.includes('outcome is unconfirmed'));assert.equal(calls.filter(c=>c.path==='/api/dnsman/whois'&&c.method==='GET').length,3,'Lost save still performs live reconciliation');assert(!document.body.textContent.includes('Private server diagnostic'));assert(button('Save registration settings').disabled);assert.equal(calls.filter(c=>c.method==='POST').length,1);await unmount();
    console.log('PASS settings: fresh ownership/live preflight, changed-only auto-renew, dedicated privacy action, pending native guard, no false apply proof and lost-response no replay');
    reset();holdRead=true;await mount();const {showDomainRegistrarSettings}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainRegistrarSettings.tsx');await act(async()=>{void showDomainRegistrarSettings(domain);});const legacyRead=()=>[...document.querySelectorAll('dialog button')].find(node=>node.textContent==='Read registration');await wait(legacyRead);await act(async()=>legacyRead().click());await wait(()=>releases.length===1);assert(button('Close').disabled,'Compatibility dialog explicit close is guarded during live read');const legacyCancel=new Event('cancel',{cancelable:true});await act(async()=>document.querySelector('dialog').dispatchEvent(legacyCancel));assert(legacyCancel.defaultPrevented);await act(async()=>releases.shift()());holdRead=false;await wait(()=>button('Close')&&!button('Close').disabled);await click('Close');await unmount();
    reset();await mount();await click('Read registration');await click('Contacts…');await click('Edit all contacts…');await change('First name','Changed-private');await click('Address');await change('City','New Town');await click('Contact');assert.equal([...document.querySelectorAll('input')].find(n=>n.closest('label')?.textContent.includes('First name')).value,'Changed-private');holdPost=true;await click('Replace all contacts');await wait(()=>releases.length===1);await click('Address');assert.equal(document.querySelector('[aria-label="Contact fields"] [aria-selected="true"]').textContent,'Contact','Pending tabs preserve active form');await act(async()=>releases.shift()());holdPost=false;await wait(()=>document.body.textContent.includes('now visible'));const contactPost=calls.find(c=>c.method==='POST');assert.equal(contactPost.body.domain,8201);assert.equal(contactPost.body.contact.FirstName,'Changed-private');assert.equal(contactPost.body.contact.City,'New Town');assert.deepEqual(contactPost.body.contact.ExtraParams,contact.ExtraParams);assert(!JSON.stringify(qc.getQueryCache().getAll().map(q=>q.state.data)).includes('Changed-private'));await unmount();
    reset();await mount();await click('Read registration');await click('Registration settings…');await select('Auto-renew','false');evidence.auto_renew=false;await click('Save registration settings');await wait(()=>document.body.textContent.includes('ownership changed'));assert.equal(calls.filter(c=>c.method==='POST').length,0);await unmount();
    console.log('PASS contacts: separate role inspection, all-role replacement, retained cross-tab draft, pending tab guard, extension preservation, no PII cache and stale preflight refusal');
    reset();holdRead=true;await mount();await click('Read registration');await wait(()=>releases.length===1);props={domain:{...domain,id:8202,name:'next.example'}};await act(async()=>root.render(render()));await act(async()=>releases.shift()());assert(!document.body.textContent.includes('Amazon Registrar'));assert(!document.body.textContent.includes('Private-canary'));await unmount();
    reset();holdRead=true;await mount();await click('Read registration');await wait(()=>releases.length===1);await unmount();await act(async()=>releases.shift()());
    reset();await mount();await click('Read registration');await act(async()=>auth.login('dns.viewer@nativemojo.com','mojo'));await flush();assert(!button('Registration settings…'));assert(!document.body.textContent.includes('Amazon Registrar'));await unmount();
    console.log('PASS registration lifetime: late scope/unmount replies discarded and authority/session replacement clears live evidence');
    auth.stopAutoRefresh();
} finally {delete globalThis.__registrationPeer;for(const resolve of releases)resolve();if(root)await unmount();await server.close();dom.window.close();}
