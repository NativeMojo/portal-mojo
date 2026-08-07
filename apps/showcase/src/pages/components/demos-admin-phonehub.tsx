import { PhoneHubPage } from 'portal-mojo/admin/communications';

export function AdminPhoneHubDemo(){return <div className="flex flex-col gap-3"><div className="panel panel-pad"><div className="eyebrow">Global Admin · no group context</div><h2 className="panel-title">Phone Hub control plane</h2><p className="dim">Try normalization-backed lookup, inspect sanitized SMS audit records, and test write-only provider configurations. The demo includes fresh and expired lookup rows plus Twilio, AWS, and Mojo provider fixtures.</p></div><PhoneHubPage/></div>;}
