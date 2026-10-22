// Mounted behavior; native focus/layout is covered by the closing browser pass.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/dns/domains'});
for(const key of ['window','document','location','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLDialogElement','Event','MouseEvent','Node','localStorage','sessionStorage','CustomEvent'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
const matches=HTMLElement.prototype.matches;HTMLElement.prototype.matches=function(selector){return selector===':popover-open'?this.hasAttribute('data-test-open'):matches.call(this,selector);};HTMLElement.prototype.showPopover=function(){this.setAttribute('data-test-open','');};HTMLElement.prototype.hidePopover=function(){this.removeAttribute('data-test-open');};
globalThis.ResizeObserver=class{observe(){}disconnect(){}};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');const router=await import('react-router-dom');
const server=await createServer({root:process.cwd(),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'domains-mounted-peer',enforce:'pre',transform(source,id){if(!id.endsWith('/client/mock.ts'))return;return source.replace('export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> {','export async function mockFetch(path: string, opts: MockFetchOpts): Promise<unknown> { if ((globalThis as any).__domainsPeer) { const response = await (globalThis as any).__domainsPeer(path, opts); if(response !== undefined) return response; }');}}]});
let root,qc;
const wait=async(predicate,label)=>{for(let i=0;i<100;i++){await act(async()=>new Promise(resolve=>setTimeout(resolve,15)));if(predicate())return;}assert.fail(`Timed out: ${label}`);};
const button=(name)=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===name);
const click=async(name)=>{await wait(()=>button(name)&&!button(name).disabled,`${name} enabled`);await act(async()=>button(name).click());};
const input=async(node,value)=>{assert(node);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});};
const field=(label)=>{const node=[...document.querySelectorAll('label')].find(node=>node.textContent.includes(label));return node?.querySelector('input')??document.getElementById(node?.htmlFor??'');};
try{
 const auth=await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');auth.initAuth();await auth.login('dns.manager@nativemojo.com','mojo');
 const ui=await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');ui.toast.success=()=>{};ui.toast.error=()=>{};
 const {DomainPurchaseWizard}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainPurchaseWizard.tsx');
 const mount=async(Component,props={},path='/custom/system/dns/domains')=>{qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(QueryClientProvider,{client:qc},React.createElement(router.MemoryRouter,{initialEntries:[path]},React.createElement(Component,props),React.createElement(ui.ModalHost)))));};
 const unmount=async()=>{await act(async()=>{root?.unmount();root=null;ui.modal.closeAll();});qc?.clear();};
 const login=async(email)=>{delete globalThis.__domainsPeer;await act(async()=>auth.login(email,'mojo'));};
 const choose=async(label,text)=>{await act(async()=>field(label).focus());await wait(()=>[...document.querySelectorAll('[role=option]')].some(node=>node.textContent.includes(text)),`${label} choice ${text}`);await act(async()=>[...document.querySelectorAll('[role=option]')].find(node=>node.textContent.includes(text)).click());};
 let attempts=0,captured;
 globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/registrar/purchase'){attempts++;captured=opts.body;return {status:false,error:'Acknowledgement uncertain',error_code:503};}};
 await mount(DomainPurchaseWizard);
 await act(async()=>field('Purchasing group').focus());await wait(()=>document.querySelector('[role="option"]'),'authorized groups');await act(async()=>document.querySelector('[role="option"]').click());
 await input(field('Base name'),'domains-regression');await input(field('TLDs'),'com');await click('Continue');await wait(()=>document.querySelector('input[type="radio"]'),'search result');await click('Continue');await wait(()=>field('Type domains-regression.com'),'exact confirmation');await input(field('Type domains-regression.com'),'domains-regression.com');await click('Continue');await wait(()=>document.body.textContent.includes('Money may have moved'),'terminal ambiguous purchase');assert.equal(attempts,1);assert.equal(captured.confirm_domain,'domains-regression.com','mounted wizard must send quote identity name');assert.equal(captured.confirm_price,'12.00','mounted wizard must send exact decimal quote price');assert(!button('Continue'),'attempted wizard cannot purchase again');
 console.log('PASS mounted Domains purchase exact confirmation tuple and no replay');
 await unmount();
 const {DomainRegisterExisting}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainRegisterExisting.tsx');
 const {showDomainOnboarding}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainOnboardingDialog.tsx');
 const {DomainOnboardingDialog}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainOnboardingContent.tsx');
 const {DomainRegistrarSettings,showDomainRegistrarSettings}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainRegistrarSettings.tsx');
 const {DomainsPage}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainsPage.tsx');
 const {DomainDetail}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainDetail.tsx');
 const groups=[{id:1,name:'Group One'},{id:2,name:'Group Two'}];
 const credential=(group=1,extra={})=>({id:8101,name:`Verified GoDaddy ${group}`,provider:'godaddy',group,is_active:true,verified:true,created:0,verified_at:1,domain_count:0,last_error:null,api_key_masked:'***',api_secret_masked:'***',...extra});
 const domain={id:8201,name:'existing.example',provider:'route53',status:'active',group:groups[0],created:0,expires:null,auto_renew:true,privacy:true,last_error:null};
 let credentialReads=0,posts=[],deferOld,requestOld;
 const peer=async(path,opts)=>{
  if(path==='/api/dnsman/credential/group-choice')return {status:true,data:groups,count:2,size:25,start:0};
  if(path==='/api/dnsman/credential'){credentialReads++;if(Number(opts.params.group)===1&&requestOld){requestOld=false;return new Promise(resolve=>deferOld=()=>resolve({status:true,data:[credential()],count:1}));}return {status:true,data:[credential(Number(opts.params.group))],count:1};}
  if(path==='/api/dnsman/registrar/register-existing'){posts.push(opts.body);return {status:true,data:{...domain,provider:'godaddy',group:opts.body.group,name:opts.body.domain}};}
 };
 globalThis.__domainsPeer=peer;let closed=0;
 await mount(DomainRegisterExisting,{close(){closed++;},back(){},setBusyGate(){}});
 assert(!field('GoDaddy credential'),'credential picker does not mount before an explicit group');assert.equal(credentialReads,0);
 await choose('Authorized group','Group One');await choose('GoDaddy credential','Verified GoDaddy 1');await input(field('Domain name'),' Existing.Example. ');
 await act(async()=>{const node=button('Register existing');node.click();node.click();});await wait(()=>closed===1,'registration success');assert.deepEqual(posts,[{group:1,domain:'existing.example',credential:8101}],'same-group normalized exact payload and one mutation');await unmount();
 // A delayed response from the prior scope must not become a visible or selectable choice.
 requestOld=true;globalThis.__domainsPeer=peer;await mount(DomainRegisterExisting,{close(){},back(){},setBusyGate(){}});await choose('Authorized group','Group One');await act(async()=>field('GoDaddy credential').focus());await wait(()=>deferOld,'old group request pending');await act(async()=>document.querySelector('button[aria-label="Clear selection"]').click());await choose('Authorized group','Group Two');await act(async()=>deferOld());assert(!document.body.textContent.includes('Verified GoDaddy 1'),'late old-scope response is absent after keyed remount');assert.equal(field('GoDaddy credential').value,'','group change clears credential value');await choose('GoDaddy credential','Verified GoDaddy 2');await unmount();
 // A server or cache returning an unusable/cross-group credential cannot create a usable selection.
 for(const bad of [credential(2),credential(1,{verified:false}),credential(1,{is_active:false}),credential(1,{provider:'route53'})]){
  posts=[];globalThis.__domainsPeer=async(path,opts)=>path==='/api/dnsman/credential'?{status:true,data:[bad],count:1}:peer(path,opts);
  await mount(DomainRegisterExisting,{close(){},back(){},setBusyGate(){}});await choose('Authorized group','Group One');await choose('GoDaddy credential',bad.name);assert(button('Register existing').disabled,'unusable credential leaves submit disabled');assert.equal(posts.length,0);await unmount();
 }
 // Existing registration's unknown outcome stays terminal, without a second mutation.
 globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/registrar/register-existing'){posts.push(opts.body);return {status:false,error:'Provider unavailable',error_code:503};}return peer(path,opts);};posts=[];await mount(DomainRegisterExisting,{close(){},back(){},setBusyGate(){}});await choose('Authorized group','Group One');await choose('GoDaddy credential','Verified GoDaddy 1');await input(field('Domain name'),'uncertain.example');await click('Register existing');await wait(()=>document.body.textContent.includes('review the provider account'),'unknown registration reviewed');assert(button('Register existing').disabled);assert.equal(posts.length,1);await unmount();
 console.log('PASS mounted registration scope hold, keyed stale-response isolation, normalized payload, unusable refusal and no replay');
 await login('dns.platform@nativemojo.com');let adoption=[];let gate=false;
 globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/registrar/adopt'){adoption.push(opts.body);return {status:true,data:{...domain,group:null,name:opts.body.domain}};}};
 await mount(DomainOnboardingDialog,{initialMode:'adopt',close(){},setBusyGate(value){gate=value;}});await wait(()=>field('Existing House domain'),'direct adoption mode');await input(field('Existing House domain'),' Exact.Example. ');await click('Review adoption');assert(gate,'review engages native dismissal guard');assert.match(document.body.textContent,/exact.example/);assert.match(document.body.textContent,/Platform/);await click('Cancel review');assert.equal(gate,false);assert.equal(adoption.length,0);await click('Review adoption');await act(async()=>{const node=button('Confirm adoption');node.click();node.click();});await wait(()=>adoption.length===1&&!gate,'adoption settled');assert.deepEqual(adoption,[{domain:'exact.example'}],'adoption omits group and create_zone');await unmount();
 await login('dns.manager@nativemojo.com');await mount(DomainOnboardingDialog,{initialMode:'adopt',close(){},setBusyGate(){}});await wait(()=>document.body.textContent.includes('Platform superuser required'),'manager cannot enter adoption');assert(!field('Existing House domain'));await unmount();
 // Register and buy direct entry, and the historical no-argument menu remain reachable.
 globalThis.__domainsPeer=peer;await mount(DomainOnboardingDialog,{initialMode:'register',close(){},setBusyGate(){}});await wait(()=>field('Authorized group'),'register direct mode');await unmount();await mount(DomainOnboardingDialog,{initialMode:'purchase',close(){},setBusyGate(){}});await wait(()=>field('Purchasing group'),'buy direct mode');await unmount();await mount(()=>null);await act(async()=>{void showDomainOnboarding();});await wait(()=>document.querySelector('.dns-onboarding-options')?.textContent.includes('Register existing'),'no-argument menu preserved');await unmount();
 console.log('PASS mounted direct action modes, Platform adoption review/cancel, literal-superuser gate and exact single flight');
 // Registrar save contains changed booleans only, and the warning comes from a new authoritative read.
 let settingsPosts=[],reads=0,settingsError=false;
 globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/domain/8201'){if(opts.method==='POST'){settingsPosts.push(opts.body);return settingsError?{status:false,error:'Response lost',error_code:503}:{status:true,data:domain};}reads++;return {status:true,data:{...domain,auto_renew:false,last_error:'Registrar rejected an earlier privacy setting'}};}};
 await mount(DomainRegistrarSettings,{domain});await wait(()=>button('Save registrar settings'),'registrar editor');await act(async()=>document.querySelector('input[type=checkbox]').click());await act(async()=>{const node=button('Save registrar settings');node.click();node.click();});await wait(()=>document.body.textContent.includes('Registrar warning'),'authoritative warning');assert.deepEqual(settingsPosts,[{auto_renew:false}]);assert.equal(reads,1);assert(document.body.textContent.includes('may be historical'));await unmount();
 settingsError=true;settingsPosts=[];reads=0;await mount(DomainRegistrarSettings,{domain});await wait(()=>button('Save registrar settings'),'uncertain editor');await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Save registrar settings');await wait(()=>document.body.textContent.includes('outcome is uncertain'),'uncertain save');assert.equal(reads,1,'rejected write still authoritatively refetches');assert(button('Save registrar settings').disabled);assert.equal(settingsPosts.length,1);await unmount();
 for(const provider of ['godaddy','mojo','unknown']){await mount(DomainRegistrarSettings,{domain:{...domain,provider}});assert(!document.querySelector('input[type=checkbox]'));await unmount();}

 // Native dismissal is blocked until the exact editor request and refetch settle.
 let releaseSave,started=false;
 globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/domain/8201'){if(opts.method==='POST'){started=true;return new Promise(resolve=>releaseSave=()=>resolve({status:true,data:domain}));}return {status:true,data:{...domain,auto_renew:false}};}};
 await mount(()=>null);await act(async()=>{void showDomainRegistrarSettings(domain);});await wait(()=>button('Save registrar settings'),'native registrar editor');await act(async()=>document.querySelector('input[type=checkbox]').click());await click('Save registrar settings');await wait(()=>started,'native save pending');const native=document.querySelector('dialog');const cancel=new Event('cancel',{cancelable:true});await act(async()=>native.dispatchEvent(cancel));assert(cancel.defaultPrevented&&native.hasAttribute('open'),'Escape cannot dismiss pending registrar write');assert(button('Close').disabled,'explicit Close cannot dismiss pending registrar write');await act(async()=>releaseSave());await wait(()=>button('Close')&&!button('Close').disabled,'native save and refresh settled');await click('Close');await wait(()=>!document.querySelector('dialog'),'editor closes after settle');await unmount();
 console.log('PASS mounted registrar changed-boolean whitelist, single flight, authoritative warning, uncertainty and provider gating');

 // Detail keeps the overview, provider constraints, related sections and explicit sibling Serving link.
 const DetailProbe=({id=8201})=>React.createElement(React.Fragment,null,React.createElement(DomainDetail,{id,onClose(){}}),React.createElement('output',{'data-location':true},router.useLocation().pathname+router.useLocation().search));
 for(const provider of ['route53','godaddy','mojo','unknown']){
  globalThis.__domainsPeer=async(path)=>path==='/api/dnsman/domain/8201'?{status:true,data:{...domain,provider}}:undefined;
  await mount(DetailProbe);await wait(()=>button('Serving'),'domain overview and authority');assert.equal(!!button('Registrar settings'),provider==='route53');assert(document.body.textContent.includes('Advanced validation'));assert(document.body.textContent.includes('Certificates'));
  const direct=[...document.querySelectorAll('.domains-overview-actions button')].find(node=>node.textContent.trim()==='DNS Records');assert.equal(!!direct,['route53','godaddy'].includes(provider));
  if(provider==='mojo')assert(document.body.textContent.includes('cannot use generic DNS CRUD'));
  if(provider==='godaddy')assert(document.body.textContent.includes('remain in the GoDaddy account'));
  await click('Serving');assert.equal(document.querySelector('[data-location]').textContent,'/custom/system/edge/vhosts','Serving is a mount-aware sibling outside DNS registry');await unmount();
 }
 // Verify actual page actions and navigate from the mounted table without opening a row modal.
 await login('dns.platform@nativemojo.com');
 const RouteProbe=()=>React.createElement('output',{'data-location':true},router.useLocation().pathname+router.useLocation().search);
 const PageProbe=()=>React.createElement(React.Fragment,null,React.createElement(DomainsPage),React.createElement(RouteProbe));
 globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/domain')return {status:true,data:[domain,{...domain,id:8202,name:'certificate.example',provider:'mojo',group:null}],count:2};return peer(path,opts);};
 for(const prefix of ['/admin','/custom/system','']){await mount(PageProbe,{},`${prefix}/dns/domains?search=keep`);await wait(()=>button('Adopt'),'platform page actions');await wait(()=>document.querySelector('tbody button'),'table records action');assert(button('Register existing')&&button('Buy domain'));assert(![...document.querySelectorAll('th')].some(node=>node.textContent==='Created'));assert(document.body.textContent.includes('Scope'));await act(async()=>document.querySelector('tbody button').click());assert.equal(document.querySelector('[data-location]').textContent,`${prefix}/dns/records?domain=8201`);assert(!document.querySelector('dialog'),'records button stops row modal');await unmount();}
 await mount(PageProbe);await wait(()=>button('Shared validation setup'),'Advanced entry');await click('Shared validation setup');await wait(()=>document.body.textContent.includes('Controller review'),'external/controller setup accessible without domain');await unmount();
 await login('dns.viewer@nativemojo.com');globalThis.__domainsPeer=async(path)=>path==='/api/dnsman/domain'?{status:true,data:[domain],count:1}:undefined;await mount(PageProbe);await wait(()=>document.body.textContent.includes('existing.example'),'viewer inventory');assert(!button('Register existing')&&!button('Adopt')&&!button('Buy domain')&&!button('Shared validation setup'));await unmount();
 console.log('PASS mounted Domains header authority, mount-aware records navigation and Advanced external/controller entry');
 auth.stopAutoRefresh();
}finally{delete globalThis.__domainsPeer;if(root)await act(async()=>root.unmount());qc?.clear();await server.close();dom.window.close();}
