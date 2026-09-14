import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../../client/runtime';
import { Badge, FlatRow, fmt, modal } from '../../../ui';
import { fetchPushDeviceReadiness, sendPushDeviceTest, type PushReadiness, type PushTestResult } from './api';
import { PUSH_DEVICE_TEST_PERMISSIONS, PUSH_DEVICE_VIEW_PERMISSIONS, PushDeliveryModel, PushDeviceModel, type PushDeviceRow } from './models';

// A completion belongs to the mounted record and permission snapshot that started it.
export function usePushRequestOwner(key:string) {
    const owner=useRef({key,live:true});
    if(owner.current.key!==key)owner.current={key,live:true};
    useEffect(()=>{const current=owner.current;current.live=true;return()=>{current.live=false;};},[key]);
    return ()=>{const current=owner.current;return ()=>current===owner.current&&current.live;};
}
export function PushTestResultView({result,at}:{result:PushTestResult;at:number}) {
    const labels={validated:'FCM connection verified',accepted:'Accepted by FCM',rejected:'Rejected by FCM',blocked:'Test blocked',unknown:'Acceptance unknown'};
    return <div className={`push-test-result ${result.success?'':'push-test-attention'}`} role="status">
        <Badge tone={result.success?'success':result.outcome==='unknown'?'warning':'danger'}>{labels[result.outcome]}</Badge>
        <p>{result.message}</p><p className="dim">Checked {fmt.datetime(at)}</p>
        {result.delivery_id&&<FlatRow label="Delivery record">#{result.delivery_id}</FlatRow>}
    </div>;
}
export function openPushDeviceTest(row:PushDeviceRow) {
    const pending={current:false};
    return modal.open(close=><PushTestDialog row={row} pending={pending} close={()=>close(null)}/>,{size:'md',canDismiss:()=>!pending.current});
}
function PushTestDialog({row,pending,close}:{row:PushDeviceRow;pending:{current:boolean};close:()=>void}) {
    const sender=useCan(PUSH_DEVICE_TEST_PERMISSIONS);const viewer=useCan(PUSH_DEVICE_VIEW_PERMISSIONS);
    const can=sender.can&&viewer.can;const qc=useQueryClient();
    const own=usePushRequestOwner(`${row.id}:${can}:${sender.me?.id}`);
    const [readiness,setReadiness]=useState<PushReadiness|null>(null);const [loadError,setLoadError]=useState('');
    const [title,setTitle]=useState('Push test');const [message,setMessage]=useState('This is a test notification.');
    const [busy,setBusy]=useState(false);const [result,setResult]=useState<{value:PushTestResult;at:number}|null>(null);
    useEffect(()=>{const current=own();setReadiness(null);setResult(null);setLoadError('');if(can)void fetchPushDeviceReadiness(row.id).then(value=>{if(current())setReadiness(value);}).catch(()=>{if(current())setLoadError('Readiness could not be checked. Confirm your permission and try opening this dialog again.');});return()=>{};},[row.id,can]);
    const send=async()=>{
        if(pending.current||!can||!readiness?.ready||result||!title.trim()||!message.trim())return;
        pending.current=true;setBusy(true);const current=own();
        try {const value=await sendPushDeviceTest(row.id,title,message);if(current())setResult({value,at:Date.now()/1000});}
        finally {pending.current=false;setBusy(false);void qc.invalidateQueries({queryKey:PushDeliveryModel.keys.root});void qc.invalidateQueries({queryKey:PushDeviceModel.keys.root});void qc.invalidateQueries({queryKey:['/api/account/devices/push/stats']});}
    };
    const config=result?.value.config??readiness?.config;
    return <div className="modal-pad push-test-dialog"><h2 className="modal-title">Send test push</h2>
        <p className="modal-message">Send one visible notification to <strong>{row.device_name||row.device_id}</strong>.</p>
        <div className="push-test-target"><FlatRow label="Device">{row.platform} · #{row.id}</FlatRow><FlatRow label="User">{row.user?.display_name??row.user?.name??(row.user?`#${row.user.id}`:'Unknown')}</FlatRow>
            <FlatRow label="Configuration">{config?`${config.name} · #${config.id}`:'Not available'}</FlatRow>
            <FlatRow label="Scope">{config?(config.group?.name??(config.group?`Group #${config.group.id}`:'System default')):'—'}</FlatRow>
            <FlatRow label="FCM project">{config?.fcm_project_id??'—'}</FlatRow>
        </div>
        {!can?<p className="form-alert" role="alert">Your permission to test this device is no longer available.</p>:result?<PushTestResultView result={result.value} at={result.at}/>:<>
            <p className={!readiness?.ready?'form-alert':'dim'} role="status">{loadError||readiness?.message||'Checking device readiness…'}</p>
            <fieldset disabled={busy} className="push-fields"><label className="field"><span className="field-label">Title</span><input className="input" maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
                <label className="field"><span className="field-label">Message</span><textarea className="input" rows={3} maxLength={1000} value={message} onChange={e=>setMessage(e.target.value)}/></label></fieldset>
            <p className="dim">FCM acceptance does not confirm the notification appeared. Check the selected device after sending.</p>
        </>}
        <div className="modal-actions"><button className="btn" disabled={busy} onClick={close}>{result?'Close':'Cancel'}</button>{can&&!result&&<button className="btn btn-primary" disabled={busy||!readiness?.ready||!title.trim()||!message.trim()} onClick={()=>void send()}>{busy?'Sending…':'Send notification'}</button>}</div>
    </div>;
}
