import { PushPage } from 'portal-mojo/admin/communications';

export function AdminPushDemo(){return <div className="flex flex-col gap-3"><div className="panel panel-pad"><div className="eyebrow">Push administration demo</div><h2 className="panel-title">Push notifications</h2><p className="dim">Local fixtures only: connection checks and test pushes here do not contact FCM or deliver notifications. Open a device to test the flow, or inspect a configuration’s scope and connection.</p></div><PushPage/></div>;}
