import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
for (const name of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','Node','localStorage','sessionStorage']) globalThis[name]=dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
globalThis.ResizeObserver=class {observe(){} disconnect(){}};
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const fixture=globalThis.__pushTests={can:true,reply:{status:true,data:{id:1}},calls:[]};
const runtime=`export * from '/packages/portal-mojo/src/client/runtime.ts'; export const useCan=()=>({can:globalThis.__pushTests.can,me:{id:globalThis.__pushTests.userId??1}}); export const mojoList=async()=>({rows:[]}); export const mojoCall=async(path,opts={})=>{const f=globalThis.__pushTests;f.calls.push({path,...opts});return f.reply;};`;
const server=await createServer({root:process.cwd(),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'push-test-fixture',enforce:'pre',resolveId:id=>id==='/__push_runtime.ts'?id:null,load:id=>id==='/__push_runtime.ts'?runtime:null,transform(source,id){if(!id.includes('/admin/messaging/push/'))return;source=source.replaceAll("from '../../../client/runtime'","from '/__push_runtime.ts'");if(id.endsWith('/PushPage.tsx'))source+='\nexport { DeviceDetail, ConfigDetail };';return source;}}]});
const React=await import('react');
const {createRoot}=await import('react-dom/client');
const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');
const qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
let invalidations=0;qc.invalidateQueries=async()=>{invalidations++;};
const root=createRoot(document.getElementById('root'));
try {
 const api=await server.ssrLoadModule('/packages/portal-mojo/src/admin/messaging/push/api.ts');
 assert.equal((await api.testPushConfigConnection(1)).success,false,'A missing provider verdict must never imply a working connection');
 const config={id:7,name:'System push',group:null,fcm_project_id:'demo',has_fcm_credentials:true,is_active:true,test_mode:false};
 const accepted={success:true,outcome:'accepted',device_id:300,message_id:'projects/demo/messages/test-1',delivery_id:9001,config};
 const validated={success:true,outcome:'validated',validation_only:true,message_id:'projects/demo/messages/check-1'};
 for(const data of [{success:true},{success:true,test_mode:true},{success:true,outcome:'validated',validation_only:true},{success:false,outcome:'rejected',error_code:'PERMISSION_DENIED',message:'private-key-canary'},null]){
   fixture.reply={status:true,data};const result=await api.testPushConfigConnection(7);assert.equal(result.success,false,'Only explicit provider validation is success');assert(!JSON.stringify(result).includes('private-key-canary'));
 }
 fixture.reply={status:true,data:{...validated,test_mode:true}};assert.equal((await api.testPushConfigConnection(7)).success,true,'Real validation can work while device sends are simulated');
 fixture.reply={status:false,data:validated};assert.equal((await api.testPushConfigConnection(7)).success,false,'Failed envelopes cannot establish validation');
 fixture.reply={status:true,data:{...accepted,device_id:999}};assert.equal((await api.sendPushDeviceTest(300,'Title','Body')).success,false,'Mismatched device receipt cannot establish acceptance');
 fixture.reply={status:true,data:{ready:true,device_id:999,config}};assert.equal((await api.fetchPushDeviceReadiness(300)).ready,false,'Readiness belongs to the requested device');
 fixture.reply={status:true,data:{ready:true,device_id:300,config:{...config,test_mode:true}}};assert.equal((await api.fetchPushDeviceReadiness(300)).ready,false,'Simulation is not readiness for a real send');
 const page=await server.ssrLoadModule('/packages/portal-mojo/src/admin/messaging/push/PushPage.tsx');
 const models=await server.ssrLoadModule('/packages/portal-mojo/src/admin/messaging/push/models.ts');
 const {openPushDeviceTest}=await server.ssrLoadModule('/packages/portal-mojo/src/admin/messaging/push/PushTestDialog.tsx');
 const {ModalHost}=await server.ssrLoadModule('/packages/portal-mojo/src/ui/modal.tsx');
 let row={...config,modified:1,created:1,default_sound:'default',fcm_client_email:'fcm@example.test'};
 models.PushConfigModel.useOne=()=>({data:row,refetch:async()=>{}});
 const device={id:300,device_id:'registered-300',device_name:'Test phone',platform:'ios',push_enabled:true,is_active:true,push_preferences:{},last_seen:1,user:{id:1,display_name:'Test user'}};
 models.PushDeviceModel.useOne=()=>({data:device});
 const render=async(element)=>{await React.act(async()=>root.render(React.createElement(QueryClientProvider,{client:qc},React.createElement(React.Fragment,null,element,React.createElement(ModalHost)))));};
 const button=label=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
 const click=async label=>{assert(button(label),`Missing button: ${label}`);assert(!button(label).disabled,`Disabled button: ${label}`);await React.act(async()=>button(label).click());};
 const menu=async label=>{await React.act(async()=>document.querySelector('[aria-label="More actions"]').click());await click(label);};
 const configView=()=>React.createElement(page.ConfigDetail,{id:row.id,onClose(){}});
 await render(configView());await click('Connection');
 let finish;fixture.reply=new Promise(resolve=>{finish=resolve;});await menu('Check FCM connection');
 await React.act(async()=>document.querySelector('[aria-label="More actions"]').click());assert(button('Edit configuration').disabled,'Configuration edits are locked during validation');assert(button('Checking FCM…').disabled,'Duplicate checks are locked');
 await React.act(async()=>finish({status:true,data:validated}));assert.match(document.body.textContent,/FCM connection verified/);assert.match(document.body.textContent,/No notification was delivered/);
 await React.act(async()=>document.dispatchEvent(new Event('pointerdown',{bubbles:true})));
 // Refetching a changed record cannot resurrect an earlier check result.
 fixture.reply=new Promise(resolve=>{finish=resolve;});
 if(button('Check FCM connection'))await click('Check FCM connection');else await menu('Check FCM connection');
 row={...row,modified:2};await render(configView());await React.act(async()=>finish({status:true,data:validated}));assert(!document.body.textContent.includes('FCM connection verified'),'Late results for a previous revision are ignored');
 fixture.reply=new Promise(resolve=>{finish=resolve;});await menu('Check FCM connection');fixture.can=false;await render(configView());await React.act(async()=>finish({status:true,data:validated}));assert(!document.body.textContent.includes('FCM connection verified'),'Permission loss invalidates pending checks');
 await render(React.createElement(page.DeviceDetail,{id:300,onClose(){}}));assert(!document.querySelector('[aria-label="More actions"]'),'Device inspection alone does not show send action');
 fixture.can=true;await render(null);
 const open=async()=>{fixture.reply={status:true,data:{ready:true,device_id:300,config}};await React.act(async()=>{void openPushDeviceTest(device);});};
 await open();assert.match(document.body.textContent,/System default/);assert.match(document.body.textContent,/System push/);
 let finishSend;fixture.reply=new Promise(resolve=>{finishSend=resolve;});const before=fixture.calls.length;
 await React.act(async()=>{button('Send notification').click();button('Send notification').click();});
 assert.equal(fixture.calls.length,before+1,'Double click sends exactly once');assert.deepEqual(fixture.calls.at(-1).body,{device_id:300,title:'Push test',message:'This is a test notification.'});
 assert(button('Cancel').disabled,'Cancel is locked while sending');const dialog=document.querySelector('dialog');await React.act(async()=>dialog.dispatchEvent(new Event('cancel',{cancelable:true})));assert(dialog.open,'Escape cannot dismiss an in-flight send');
 await React.act(async()=>finishSend({status:true,data:accepted}));assert.match(document.body.textContent,/Accepted by FCM/);assert.match(document.body.textContent,/#9001/);assert(!button('Send notification'),'Completed send is not repeatable in the same dialog');await click('Close');
 assert.equal(qc.getMutationCache().getAll().length,0,'Test bodies do not enter mutation cache');assert(invalidations>=3,'Tests refresh device, delivery and statistics queries');
 for(const outcome of ['rejected','blocked','unknown']){
   await open();fixture.reply={status:true,data:{success:false,outcome,device_id:300,config,error_code:outcome==='rejected'?'UNREGISTERED':'test_mode',message:'private-key-canary',delivery_id:9002}};await click('Send notification');
   assert(!document.body.textContent.includes('Accepted by FCM'));assert(!document.body.textContent.includes('private-key-canary'));assert(!button('Send notification'),'No automatic duplicate attempt after a terminal result');await click('Close');
 }
 await open();fixture.reply=new Promise(resolve=>{finishSend=resolve;});await click('Send notification');fixture.can=false;await render(null);await React.act(async()=>finishSend({status:true,data:accepted}));assert(!document.body.textContent.includes('Accepted by FCM'),'Late send result is hidden after permission loss');assert(!button('Close').disabled,'A settled operation still unlocks dismissal after permission loss');fixture.can=true;await render(null);assert(!button('Send notification'),'Restoring permission cannot rearm a dialog that already attempted a send');await click('Close');
 fixture.reply={status:true,data:{ready:true,device_id:300,config}};await open();fixture.reply={status:true,data:accepted};await click('Send notification');
 fixture.can=false;await render(null);fixture.can=true;await render(null);assert(!button('Send notification'),'Permission restoration cannot rearm a completed send');
 fixture.userId=2;await render(null);assert(!document.body.textContent.includes('Accepted by FCM'),'A new user cannot inherit the previous user result');assert(!button('Send notification'),'An account switch does not rearm the same dialog');await click('Close');
 console.log('Push tests: exact verdicts, safe projections, targeting, readiness, persistent results, revision/permission ownership, single send, dismissal lock, and cache isolation passed.');
} finally {await React.act(async()=>root.unmount());qc.clear();await server.close();dom.window.close();delete globalThis.__pushTests;}
