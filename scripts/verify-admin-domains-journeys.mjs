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
 const choose=async(label,text)=>{await wait(()=>field(label),`${label} mounted`);await act(async()=>field(label).focus());await wait(()=>[...document.querySelectorAll('[role=option]')].some(node=>node.textContent.includes(text)),`${label} choice ${text}`);await act(async()=>[...document.querySelectorAll('[role=option]')].find(node=>node.textContent.includes(text)).click());};

 const {DomainAssignment,showDomainAssignment}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainAssignment.tsx');
 const {DomainDetail}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DomainDetail.tsx');
 const {DnsRecordsPanel}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/DnsRecordsPanel.tsx');
 const groups=[{id:1,name:'Group One'},{id:2,name:'Group Two'}];
 let current={id:8209,name:'platform.example',provider:'route53',status:'active',group:null,created:0,expires:null,auto_renew:true,privacy:true,verified:true};
 let posts=[],uncertain=false,held,hold=false;
 const peer=async(path,opts)=>{
  if(path==='/api/dnsman/credential/group-choice') {const rows=opts.params.id?groups.filter(g=>g.id===Number(opts.params.id)):groups;return {status:true,data:rows,count:rows.length};}
  if(path==='/api/dnsman/domain/8209')return {status:true,data:current};
  if(path==='/api/dnsman/registrar/assign-group'){
   posts.push(opts.body);if(hold)await new Promise(resolve=>held=resolve);current={...current,group:groups.find(g=>g.id===opts.body.group)};
   return uncertain?{status:false,error:'Receipt lost',error_code:503}:{status:true,data:current};
  }
 };
 await login('dns.platform@nativemojo.com');globalThis.__domainsPeer=peer;
 await mount(DomainAssignment,{domain:current,close(){},onBusyChange(){}});
 await choose('Destination group','Group Two');await click('Review assignment');assert(document.body.textContent.includes('Group Two'));
 await input(field('Type Group Two'),'Group One');assert(button('Assign to group').disabled,'exact destination name is required');
 await input(field('Type Group Two'),'Group Two');await act(async()=>{button('Assign to group').click();button('Assign to group').click();});await wait(()=>posts.length===1&&!button('Close')?.disabled,'assignment settles');
 assert.deepEqual(posts,[{domain:8209,group:2}]);assert(!button('Assign to group'),'submitted assignment cannot replay');await unmount();
 console.log('PASS exact destination confirmation and single-flight one-time assignment');
 // A concurrent assignment is detected before the POST, even if the opening row was Platform.
 const opening={...current,group:null};posts=[];current={...opening,group:groups[0]};globalThis.__domainsPeer=peer;
 await mount(DomainAssignment,{domain:opening,close(){},onBusyChange(){}});await choose('Destination group','Group Two');await click('Review assignment');await input(field('Type Group Two'),'Group Two');await click('Assign to group');await wait(()=>document.body.textContent.includes('already been assigned'),'fresh owner guard');assert.equal(posts.length,0);await unmount();
 // A lost response may already have assigned the domain: observe owner, never repeat.
 current={...opening};uncertain=true;posts=[];globalThis.__domainsPeer=peer;
 await mount(DomainAssignment,{domain:current,close(){},onBusyChange(){}});await choose('Destination group','Group Two');await click('Review assignment');await input(field('Type Group Two'),'Group Two');await click('Assign to group');await wait(()=>button('Refresh owner'),'unknown outcome');await click('Refresh owner');assert.equal(posts.length,1);assert(!button('Assign to group'));assert(document.body.textContent.includes('Group Two'));await unmount();
 // Native dismissal cannot abandon a pending one-time assignment.
 current={...opening};uncertain=false;hold=true;posts=[];globalThis.__domainsPeer=peer;
 await mount(()=>null);await act(async()=>{void showDomainAssignment(current);});await choose('Destination group','Group Two');await click('Review assignment');await input(field('Type Group Two'),'Group Two');await click('Assign to group');await wait(()=>held,'held assignment');const native=document.querySelector('dialog');const cancel=new Event('cancel',{cancelable:true});await act(async()=>native.dispatchEvent(cancel));assert(cancel.defaultPrevented&&native.hasAttribute('open'));await act(async()=>held());await wait(()=>!document.querySelector('dialog'),'resolved assignment closes');await unmount();hold=false;
 console.log('PASS assignment stale-owner guard, lost-response observation and native pending protection');
 // Grouped records and non-superusers never get assignment controls.
 for(const email of ['dns.manager@nativemojo.com','dns.viewer@nativemojo.com']){await login(email);globalThis.__domainsPeer=peer;await mount(DomainAssignment,{domain:opening,close(){},onBusyChange(){}});await wait(()=>button('Close'),'assignment denied');assert(!field('Destination group'));await unmount();}
 await login('dns.viewer@nativemojo.com');globalThis.__domainsPeer=peer;let privilegedReads=0;globalThis.__domainsPeer=async(path,opts)=>{if(['/api/dnsman/whois','/api/dnsman/registrant','/api/dnsman/credential/group-choice'].includes(path))privilegedReads++;return peer(path,opts);};
 await mount(DomainDetail,{id:8209,onClose(){}});await wait(()=>document.querySelector('[role=tab]'),'viewer details');assert(!button('Assign to group'));assert(![...document.querySelectorAll('[role=tab]')].some(n=>n.textContent==='Registration'));assert.equal(privilegedReads,0);await unmount();
 // The same live-record panel can own its filter when no host callback is supplied.
 await login('dns.manager@nativemojo.com');delete globalThis.__domainsPeer;
 await mount(DnsRecordsPanel,{domain:{...opening,id:8201,name:'acme.example',group:1}});await wait(()=>document.querySelector('.dns-record-table tbody tr'),'records loaded');
 const filter=document.querySelector('select');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(filter,'TXT');filter.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(filter.value,'TXT');assert([...document.querySelectorAll('.dns-record-table tbody tr')].every(row=>row.querySelector('td').textContent==='TXT'),'type filter changes actual rendered records');await unmount();
 console.log('PASS viewer prerequisite/PII isolation and functional standalone record-type filtering');

 const {showCredentialEditor}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/ProviderCredentialsPage.tsx');
 const api=await server.ssrLoadModule('/packages/portal-mojo/src/admin/dns/api.ts');
 const caps=await api.fetchDnsCapabilities(1);let links=[],releaseLink;
 const safeCredential={id:8199,name:'QA GoDaddy',provider:'godaddy',group:1,is_active:true,verified:true,created:0,modified:0,verified_at:1,domain_count:1,last_error:null,api_key_masked:'***safe',api_secret_masked:'***safe'};
 globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/credential/link'){links.push(opts.body);await new Promise(resolve=>releaseLink=resolve);return {status:true,data:safeCredential};}};
 await mount(()=>null);await act(async()=>{void showCredentialEditor(caps,undefined,groups[0]);});await wait(()=>field('API key'),'scoped credential editor');assert(document.body.textContent.includes('Group One'),'credential setup retains exact selected group');assert(!field('Group'),'fixed group cannot be edited');await input(field('API key'),'credential-canary-key');await input(field('API secret'),'credential-canary-secret');await click('Link and verify');await wait(()=>releaseLink,'link pending');const linkDialog=document.querySelector('dialog');const linkCancel=new Event('cancel',{cancelable:true});await act(async()=>linkDialog.dispatchEvent(linkCancel));assert(linkCancel.defaultPrevented,'pending credential verification cannot be dismissed');await act(async()=>releaseLink());await wait(()=>!document.querySelector('dialog'),'verified link returns');assert.equal(links.length,1);assert.equal(links[0].group,1);assert(!JSON.stringify(qc.getQueryCache().getAll().map(q=>q.state.data)).includes('credential-canary'),'raw credential pair never enters Query');await unmount();
 links=[];globalThis.__domainsPeer=async(path,opts)=>{if(path==='/api/dnsman/credential/link'){links.push(opts.body);return {status:false,error:'Fresh authentication required',error_code:440};}};
 auth.setFreshAuthHandler(async()=>{await auth.login('dns.viewer@nativemojo.com','mojo');return true;});
 await mount(()=>null);await act(async()=>{void showCredentialEditor(caps,undefined,groups[0]);});await wait(()=>field('API key'),'replacement credential editor');await input(field('API key'),'credential-canary-key');await input(field('API secret'),'credential-canary-secret');await click('Link and verify');await wait(()=>!document.querySelector('input[type=password]')||document.body.textContent.includes('Session changed'),'session replacement stops credential replay');assert.equal(links.length,1);assert(!field('API key')||field('API key').value==='','old-session key is cleared or removed');assert(!field('API secret')||field('API secret').value==='','old-session secret is cleared or removed');auth.setFreshAuthHandler(null);await unmount();
 console.log('PASS scoped credential handoff, single-flight verification, native guard, transient secrets and replacement-session no replay');

 await login('dns.manager@nativemojo.com');let credentialReads=0,releaseCredential,delayCredential=true,showRecords;
 const broken={...opening,id:8201,name:'broken.example',group:1,provider:'godaddy',credential:{id:8101,name:'Broken GoDaddy',provider:'godaddy',is_active:false,verified:false}};
 globalThis.__domainsPeer=async(path)=>{if(path==='/api/dnsman/credential/8101'){credentialReads++;if(delayCredential)await new Promise(resolve=>releaseCredential=resolve);return {status:true,data:{...safeCredential,id:8101}};}};
 function RepairLifetime(){const [visible,setVisible]=React.useState(true);showRecords=setVisible;return visible?React.createElement(DnsRecordsPanel,{domain:broken}):React.createElement('p',null,'Records closed');}
 await mount(RepairLifetime);await wait(()=>button('Repair linked credential'),'repair action');await act(async()=>{button('Repair linked credential').click();button('Repair linked credential').click();});await wait(()=>releaseCredential,'held repair prerequisite');assert.equal(credentialReads,1,'repair launch is synchronous single flight');await act(async()=>showRecords(false));await act(async()=>releaseCredential());await wait(()=>document.body.textContent.includes('Records closed'),'panel lifetime ended');for(let i=0;i<5;i++)await act(async()=>new Promise(resolve=>setTimeout(resolve,15)));assert(!document.querySelector('dialog'),'late prerequisite never opens an orphan editor');await unmount();
 delayCredential=false;credentialReads=0;await mount(RepairLifetime);await click('Repair linked credential');await wait(()=>field('API key'),'repair child opens');await act(async()=>showRecords(false));await wait(()=>!document.querySelector('dialog'),'panel disposal closes the owned credential child');await unmount();
 console.log('PASS credential repair single-flight prerequisite fencing and child lifetime cancellation');
 auth.stopAutoRefresh();
}finally{delete globalThis.__domainsPeer;if(root)await act(async()=>root.unmount());qc?.clear();await server.close();dom.window.close();}
