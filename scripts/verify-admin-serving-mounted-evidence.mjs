// Real mounted evidence panel, exact read admission and identity-late-reply fences.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'});
for(const key of ['window','document','HTMLElement','Event','Node','MouseEvent','CustomEvent'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const React=await import('react'); const {act}=React;
const {createRoot}=await import('react-dom/client');
const coverage=(total=1,returned=1)=>({total,returned,omitted:total-returned});
const bootstrap=()=>({user:{id:1,is_superuser:true,email:'PRIVATE'},capabilities:{setup:true},groups:[{private:true}],edge:{available:true,http_enabled:false,dnsman_issuance:'dns-01'},private_key:'PRIVATE'});
const report=()=>({schema_version:1,generated_at:'2026-10-21T12:00:00Z',overall:'pass',summary:{pass:1,warn:0,fail:0,pending:0},sections:[{code:'unrelated',secret:'PRIVATE'},{code:'hosting_vhosts',label:'Hosting',status:'pass',checks:[{code:'hosting.vhosts',status:'pass',explanation:'Domain and certificate status checks passed.',remediation:'No status repair required.',private_key:'PRIVATE'}],coverage:coverage()}],coverage:{sections:coverage(2,2),checks:coverage()}});
const state=globalThis.__servingEvidence={auth:{authenticated:true,uid:'1'},revision:1,me:{id:1,is_superuser:true,permissions:{}},listeners:new Set(),calls:[],bootstrap:bootstrap(),report:report(),fail:'',hold:null};
state.call=async(path,opts)=>{state.calls.push({path,params:opts?.params});if(state.hold&&path.includes('bootstrap'))return state.hold;if(state.fail)throw new Error(state.fail);return {data:path.includes('bootstrap')?state.bootstrap:state.report};};
const virtual={ '/__serving_evidence_runtime.ts': `export * from '/packages/portal-mojo/src/client/runtime.ts'; import {useSyncExternalStore} from 'react'; const s=globalThis.__servingEvidence;export const useAuthSnapshot=()=>useSyncExternalStore(fn=>{s.listeners.add(fn);return()=>s.listeners.delete(fn)},()=>s.auth);export const getAuthSnapshot=()=>s.auth;export const getAuthSessionRevision=()=>s.revision;export const useMe=()=>({data:s.me});export const mojoCall=(path,opts)=>s.call(path,opts);` };
const server=await createServer({root:process.cwd(),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'serving-evidence-fixtures',enforce:'pre',resolveId:id=>id in virtual?id:null,load:id=>virtual[id]??null,transform(source,id){if(!id.endsWith('/edge/ServingReadiness.tsx')&&!id.endsWith('/edge/serving-data.ts'))return;return source.replace("from '../../client/runtime'","from '/__serving_evidence_runtime.ts'");}}]});
const root=createRoot(document.getElementById('root'));
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
let key=0;
try{
 const data=await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/serving-data.ts');
 const {ModalHost}=await server.ssrLoadModule('/packages/portal-mojo/src/ui/index.ts');
 const {ServingReadiness}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/edge/ServingReadiness.tsx');
 const mount=async()=>{state.calls=[];await act(async()=>root.render(React.createElement(React.Fragment,null,React.createElement(ServingReadiness,{key:++key}),React.createElement(ModalHost))));await settle();};
 const refresh=async()=>{await act(async()=>document.querySelector('[aria-label="Refresh serving evidence"]').click());await settle();};
 const details=async()=>{await act(async()=>[...document.querySelectorAll('button')].find(node=>node.textContent==='Check details').click());await settle();};
 const close=async()=>{await act(async()=>[...document.querySelectorAll('dialog button')].find(node=>node.textContent==='Close').click());await settle();};
 const sameSessionMe=async(me)=>{const revision=state.revision;await act(async()=>{state.me=me;state.auth={...state.auth};for(const listener of state.listeners)listener();});await settle();assert.equal(state.revision,revision,'permission-only changes do not replace the auth session');};
 const replace=async(me)=>{await act(async()=>{state.revision++;state.me=me;state.auth={authenticated:!!me,uid:me?String(me.id):null};for(const listener of state.listeners)listener();});await settle();};
 assert.doesNotMatch(JSON.stringify(data.parseServingBootstrap(bootstrap(),1)),/PRIVATE|groups|email|private_key/);
 assert.doesNotMatch(JSON.stringify(data.parseHostingReadiness(report())),/PRIVATE|private_key|unrelated/);
 for(const status of ['pass','warn','fail','pending']){const raw=report();raw.overall=status;raw.sections[1].status=status;raw.sections[1].checks[0].status=status;assert.equal(data.parseHostingReadiness(raw).sections[0].status,status);}
 for(const change of [raw=>raw.schema_version=2,raw=>raw.sections.pop(),raw=>raw.generated_at='yesterday',raw=>raw.sections[1].coverage.omitted=-1,raw=>raw.sections[1].checks=Array(65).fill(raw.sections[1].checks[0]),raw=>raw.sections[1].status='healthy']){const raw=report();change(raw);assert.throws(()=>data.parseHostingReadiness(raw));}
 const bounded=report();bounded.sections[1].checks[0].details=Object.fromEntries(Array.from({length:20},(_,i)=>[`key${i}`,i]));assert.equal(Object.keys(data.parseHostingReadiness(bounded).sections[0].checks[0].details).length,16);
 await mount();
 assert.deepEqual(state.calls.map(call=>call.path),['/api/account/admin/bootstrap','/api/account/admin/setup/readiness']);
 assert.deepEqual(state.calls[1].params,{section:'hosting_vhosts'});
 assert.match(document.body.textContent,/Configuration checks/);
 assert.match(document.body.textContent,/As of/);
 assert.equal(document.querySelector('details'),null,'no readiness accordion on an already scrolling page');
 assert.doesNotMatch(document.body.textContent,/PRIVATE|Domain and certificate status checks passed/,'technical evidence starts in the focused modal');
 await details();assert.match(document.body.textContent,/Public HTTPDisabled/);assert.match(document.body.textContent,/Certificate issuanceDNS-01/);assert.match(document.body.textContent,/do not prove certificate expiry/);assert.doesNotMatch(document.body.textContent,/PRIVATE|(?:fleet )?convergence (?:is )?(?:verified|proven|complete|confirmed)/);await close();
 // Details must end when effective authority changes without a new auth session.
 await details();assert(document.querySelector('dialog'));state.calls=[];await sameSessionMe({id:1,is_superuser:false,permissions:{view_dns:true}});assert.equal(document.querySelector('dialog'),null,'bootstrap/superuser downgrade disposes the captured privileged report');assert.equal(state.calls.length,0,'losing bootstrap authority starts no denied reads');assert.doesNotMatch(document.body.textContent,/Domain and certificate status checks passed/);
 state.bootstrap=bootstrap();await sameSessionMe({id:1,is_superuser:true,permissions:{}});await details();assert(document.querySelector('dialog'));state.calls=[];state.bootstrap={...bootstrap(),user:{id:1,is_superuser:false},capabilities:{setup:false}};await sameSessionMe({id:1,is_superuser:false,permissions:{view_dns:true,view_admin:true}});assert.equal(document.querySelector('dialog'),null,'loss of literal superuser disposes readiness details even when bootstrap remains admitted');assert.deepEqual(state.calls.map(call=>call.path),['/api/account/admin/bootstrap'],'the still-admitted bootstrap read does not become a denied readiness read');
 state.bootstrap=bootstrap();await sameSessionMe({id:1,is_superuser:true,permissions:{}});
 const partial=report();partial.truncated=true;partial.sections[1].coverage=coverage(3,1);state.report=partial;await refresh();assert.match(document.querySelector('.edge-serving-evidence').textContent,/Partial report/,'partial coverage stays visible on the compact surface');await details();assert.match(document.body.textContent,/1 of 3 checks · 2 omitted/);await close();
 state.bootstrap={...bootstrap(),edge:{available:true,http_enabled:true,dnsman_issuance:'other'}};await refresh();await details();assert.match(document.body.textContent,/Certificate issuanceUnknown/);await close();
 for(const error of ['403 key-backed session refused','404 old backend','network error']){state.fail=error;await refresh();assert.match(document.body.textContent,/Unavailable/);await details();assert.match(document.body.textContent,new RegExp(error));assert.doesNotMatch(document.body.textContent,/Domain and certificate status checks passed/,'failed refresh clears previous pass');await close();}state.fail='';
 state.bootstrap=bootstrap();state.report={bad:true};await refresh();await details();assert.match(document.body.textContent,/incompatible or missing/);await close();state.report=report();
 state.bootstrap={...bootstrap(),edge:undefined};await refresh();assert.equal(state.calls.at(-1).path,'/api/account/admin/bootstrap','failed bootstrap cannot start readiness');
 state.bootstrap=bootstrap();await replace({id:1,is_superuser:false,permissions:{view_dns:true}});await mount();assert.equal(state.calls.length,0);await details();assert.match(document.body.textContent,/unavailable to this session/);await close();
 await replace({id:1,is_superuser:false,permissions:{view_dns:true,view_admin:true}});state.bootstrap={...bootstrap(),user:{id:1,is_superuser:false},capabilities:{setup:false}};await mount();assert.deepEqual(state.calls.map(call=>call.path),['/api/account/admin/bootstrap']);
 await replace({id:1,is_superuser:true,permissions:{}});state.bootstrap=bootstrap();let release;state.hold=new Promise(resolve=>{release=resolve;});await mount();assert.equal(state.calls.length,1);await replace({id:2,is_superuser:false,permissions:{view_dns:true}});await act(async()=>release({data:bootstrap()}));await settle();assert.equal(state.calls.length,1,'old identity bootstrap cannot start readiness');assert.doesNotMatch(document.body.textContent,/status checks passed/);state.hold=null;
 await replace(null);assert.equal(document.body.textContent,'','logout clears the projection');
 console.log('verify-admin-serving-mounted-evidence: positive DTOs, bounded schema, independent gates, unknown posture, honest refresh failures and auth replacement fences passed.');
}finally{await act(async()=>root.unmount());await server.close();}
