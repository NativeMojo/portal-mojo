import { PushPage } from 'portal-mojo/admin';

export function AdminPushDemo(){return <div className="flex flex-col gap-3"><div className="panel panel-pad"><div className="eyebrow">Global Admin · independently gated</div><h2 className="panel-title">Push notification control plane</h2><p className="dim">The showcase operator can inspect caller-only stats, global metrics, registered devices, sanitized delivery history, templates, and write-only FCM configuration. Switch tabs to prove only the active surface fetches.</p></div><PushPage/></div>;}
