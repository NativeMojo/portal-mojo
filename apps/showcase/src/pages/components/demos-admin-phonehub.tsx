import { PhoneHubPage } from 'portal-mojo/admin/communications';

export function AdminPhoneHubDemo(){return <div className="flex flex-col gap-3"><div className="panel panel-pad"><div className="eyebrow">Global Admin · no group context</div><h2 className="panel-title">Phone Hub control plane</h2><p className="dim">Try normalization-backed lookup, compose a custom SMS, inspect audit records, and test write-only provider configurations. SMS sends are simulated here; a recipient ending in 0000 demonstrates provider refusal.</p></div><PhoneHubPage/></div>;}
