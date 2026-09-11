import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { mojoList, useCan } from '../../client/runtime';
import { Badge, DetailView, FlatRow, ModelTable, Tabs, fmt, modal, toast, type Column, type FilterDef } from '../../ui';
import { DEFAULT_MOJO_REMOTE_URL, buildPhoneConfigPayload, fetchPhoneGroupChoices, lookupPhoneNumber, normalizePhoneNumber, resolveMojoRemoteUrl, savePhoneConfigImperative, testPhoneConfigImperative, type PhoneSecretField, type SecretEdit } from './api';
import { exportPhoneConfigs, exportPhoneNumbers, exportSmsAudits } from './data';
import { openSmsComposer, SMS_SEND_PERMISSIONS } from './SmsComposer';
import {
    PHONE_CONFIG_MANAGE_PERMISSIONS,
    PHONE_CONFIG_VIEW_PERMISSIONS,
    PHONE_GROUP_DIRECTORY_PERMISSIONS,
    PHONE_LOOKUP_UI_PERMISSIONS,
    PHONE_NUMBER_VIEW_PERMISSIONS,
    PhoneConfigModel,
    PhoneNumberModel,
    SMS_VIEW_PERMISSIONS,
    SmsModel,
    type PhoneConfigRow,
    type PhoneNumberRow,
    type SmsRow,
} from './models';

const relationLabel=(value:{id:number;name?:string;display_name?:string}|number|null,empty='System default')=>value==null?empty:typeof value==='number'?`#${value}`:value.name??value.display_name??`#${value.id}`;
const tone=(status:string)=>status==='delivered'||status==='valid'?'success':status==='failed'||status==='undelivered'||status==='invalid'?'danger':'warning';
const phoneColumns:Column<PhoneNumberRow>[]=[
    {key:'phone_number',label:'Phone number',sortable:true,hideable:false,render:r=><code>{r.phone_number}</code>},
    {key:'carrier',label:'Carrier',sortable:true,render:r=>r.carrier||'—'},
    {key:'line_type',label:'Line type',sortable:true,render:r=>r.line_type||'—'},
    {key:'is_valid',label:'Validity',render:r=><Badge tone={r.is_valid?'success':'danger'}>{r.is_valid?'valid':'invalid'}</Badge>},
    {key:'lookup_count',label:'Lookups',sortable:true,align:'end'},
    {key:'last_lookup_at',label:'Last lookup',sortable:true,render:r=>r.last_lookup_at?fmt.datetime(r.last_lookup_at):'Never'},
];
const smsColumns:Column<SmsRow>[]=[
    {key:'created',label:'Created',sortable:true,hideable:false,render:r=>fmt.datetime(r.created)},
    {key:'direction',label:'Direction',sortable:true,render:r=><Badge tone="info">{r.direction}</Badge>},
    {key:'from_number',label:'From',render:r=><code>{r.from_number}</code>},
    {key:'to_number',label:'To',render:r=><code>{r.to_number}</code>},
    {key:'status',label:'Status',sortable:true,render:r=><Badge tone={tone(r.status)}>{r.status}</Badge>},
    {key:'provider',label:'Provider',sortable:true,render:r=>r.provider||'—'},
];
const smsFilters:FilterDef[]=[{key:'direction',label:'Direction',type:'select',options:['inbound','outbound'].map(value=>({value,label:value}))},{key:'status',label:'Status',type:'select',options:['queued','sending','sent','delivered','failed','undelivered','received'].map(value=>({value,label:value}))},{key:'provider',label:'Provider',type:'select',options:['twilio','aws','mojo'].map(value=>({value,label:value}))},{key:'created',label:'Created',type:'daterange'}];
const configColumns:Column<PhoneConfigRow>[]=[
    {key:'name',label:'Configuration',sortable:true,hideable:false},
    {key:'group',label:'Scope',render:r=>relationLabel(r.group)},
    {key:'provider',label:'Stored/tested provider',sortable:true,render:r=><Badge tone="info">{r.provider}</Badge>},
    {key:'is_active',label:'Active',sortable:true,render:r=><Badge tone={r.is_active?'success':'muted'}>{r.is_active?'active':'inactive'}</Badge>},
    {key:'test_mode',label:'Test mode',render:r=><Badge tone={r.test_mode?'warning':'muted'}>{r.test_mode?'yes':'no'}</Badge>},
    {key:'modified',label:'Modified',sortable:true,render:r=>fmt.datetime(r.modified)},
];

function PhoneDetail({id,onClose}:{id:number;onClose:()=>void}){const query=PhoneNumberModel.useOne(id);if(!query.data)return <div className="modal-pad">{query.isLoading?'Loading phone record…':'Phone record unavailable'}<button className="btn" onClick={onClose}>Close</button></div>;const row=query.data;return <DetailView title={row.phone_number} subtitle={`${row.carrier||'Unknown carrier'} · ${row.line_type||'Unknown line type'}`} icon="bi-telephone" onClose={onClose} sections={[{key:'lookup',label:'Lookup',icon:'bi-search',render:()=><div className="detail-section"><FlatRow label="Provider">{row.lookup_provider||'—'}</FlatRow><FlatRow label="Lookup count">{row.lookup_count}</FlatRow><FlatRow label="Last lookup">{row.last_lookup_at?fmt.datetime(row.last_lookup_at):'Never'}</FlatRow><FlatRow label="Expires">{row.lookup_expires_at?fmt.datetime(row.lookup_expires_at):'Unknown'}</FlatRow><p className="dim">Lookup payloads are deliberately excluded from the client cache.</p></div>},{key:'identity',label:'Carrier & owner',icon:'bi-person-lines-fill',render:()=><div className="detail-section"><FlatRow label="Valid">{row.is_valid?'Yes':'No'}</FlatRow><FlatRow label="Mobile">{row.is_mobile?'Yes':'No'}</FlatRow><FlatRow label="VoIP">{row.is_voip?'Yes':'No'}</FlatRow><FlatRow label="Registered owner">{row.registered_owner||'—'}</FlatRow><FlatRow label="Region">{[row.region,row.state].filter(Boolean).join(', ')||'—'}</FlatRow></div>}]}/>;}

function LookupDialog({close}:{close:(row:PhoneNumberRow|null)=>void}){const qc=useQueryClient();const [value,setValue]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const submit=async()=>{setBusy(true);setError('');try{const normalized=await normalizePhoneNumber(value);let previous:PhoneNumberRow|undefined;try{const existing=await mojoList<PhoneNumberRow>(PhoneNumberModel.endpoint,{phone_number:normalized,graph:'default',start:0,size:1});previous=existing.rows[0];}catch{/* lookup remains available for a new row */}const row=await lookupPhoneNumber(normalized,previous,()=>window.confirm('This cache row is still fresh. Force a paid global Twilio Lookup anyway?'));qc.setQueryData(PhoneNumberModel.keys.one(row.id),row);await qc.invalidateQueries({queryKey:PhoneNumberModel.keys.root});toast.success('Lookup completed with refresh evidence');close(row);}catch(reason){setError(reason instanceof Error?reason.message:'Lookup failed');}finally{setBusy(false);}};return <div className="modal-pad"><h2 className="modal-title">Lookup phone number</h2><p className="dim">The number is normalized first. New or expired rows refresh automatically; a known-fresh row requires confirmation before a paid global Twilio Lookup.</p>{error&&<div className="form-alert" role="alert">{error}</div>}<label className="field"><span className="field-label">Phone number</span><input className="input" value={value} onChange={e=>setValue(e.target.value)} placeholder="+1 415 555 0100"/></label><div className="modal-actions"><button className="btn" disabled={busy} onClick={()=>close(null)}>Cancel</button><button className="btn btn-primary" disabled={busy||!value.trim()} onClick={()=>void submit()}>{busy?'Looking up…':'Normalize and look up'}</button></div></div>;}

export function PhoneNumbersPage(){const canLookup=useCan(PHONE_LOOKUP_UI_PERMISSIONS).can;return <ModelTable model={PhoneNumberModel} eyebrow="Communications · Phone Hub" title="Phone Numbers" columns={phoneColumns} defaultSort="phone_number" searchable searchPlaceholder="Search number, carrier, or owner" columnChooser persistState persistKey="admin:phonehub:numbers" exportFormats={['csv','json']} exporter={exportPhoneNumbers} addLabel="Lookup number" onAdd={canLookup?()=>void modal.open(close=><LookupDialog close={close}/>):undefined} onRowClick={row=>void modal.detail(close=><PhoneDetail id={row.id} onClose={()=>close(null)}/>)}/>;}

function SmsDetail({id,onClose}:{id:number;onClose:()=>void}){const query=SmsModel.useOne(id);if(!query.data)return <div className="modal-pad">{query.isLoading?'Loading SMS audit…':'SMS audit unavailable'}<button className="btn" onClick={onClose}>Close</button></div>;const row=query.data;return <DetailView title={`${row.from_number} → ${row.to_number}`} subtitle={`${row.direction} · ${row.status}`} icon="bi-chat-square-text" onClose={onClose} sections={[{key:'message',label:'Message',icon:'bi-chat-text',render:()=><div className="detail-section"><FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow><FlatRow label="Provider">{row.provider||'—'}</FlatRow><FlatRow label="Group">{relationLabel(row.group,'None')}</FlatRow><div className="known-card"><h3>Message body</h3><p className="pre-wrap">{row.body||'—'}</p></div>{row.error_message&&<div className="form-alert">{row.error_message}</div>}</div>}]}/>;}
export function SmsPage(){const canSend=useCan(SMS_SEND_PERMISSIONS).can;return <ModelTable model={SmsModel} eyebrow="Communications · Phone Hub" title="SMS Audit" columns={smsColumns} filters={smsFilters} defaultSort="-created" searchable searchPlaceholder="Search number or message body" autoRefresh={20} columnChooser persistState persistKey="admin:phonehub:sms" exportFormats={['csv','json']} exporter={exportSmsAudits} addLabel="Send SMS" onAdd={canSend?()=>void openSmsComposer():undefined} onRowClick={row=>void modal.detail(close=><SmsDetail id={row.id} onClose={()=>close(null)}/>)}/>;}

type PhoneProvider = PhoneConfigRow['provider'];

const credentialLabels: Record<PhoneSecretField, string> = {
    twilio_account_sid: 'Twilio account SID',
    twilio_auth_token: 'Twilio auth token',
    aws_access_key_id: 'AWS access key ID',
    aws_secret_access_key: 'AWS secret access key',
    mojo_api_key: 'Mojo service API key',
};

const providerMeta: Record<PhoneProvider, { label: string; icon: string; description: string }> = {
    twilio: { label: 'Twilio', icon: 'bi-chat-square-text', description: 'Programmable SMS credentials' },
    aws: { label: 'AWS SNS', icon: 'bi-cloud', description: 'Regional SMS sender credentials' },
    mojo: { label: 'Mojo Remote', icon: 'bi-phone', description: 'Group-aware remote Mojo bridge' },
};

const providerCredentialFields: Record<PhoneProvider, PhoneSecretField[]> = {
    twilio: ['twilio_account_sid', 'twilio_auth_token'],
    aws: ['aws_access_key_id', 'aws_secret_access_key'],
    mojo: ['mojo_api_key'],
};

function providerOperationalNote(provider: PhoneProvider): string {
    if (provider === 'mojo') return 'Mojo Remote is used by the group-aware SMS delivery path.';
    if (provider === 'aws') return 'Stored AWS credentials can be tested here. AWS outbound delivery is not wired yet.';
    return 'Stored Twilio credentials can be tested here. Outbound delivery currently uses the global Twilio settings.';
}

function providerVisibleRows(row: PhoneConfigRow): Array<[string, string]> {
    if (row.provider === 'twilio') return [['From number', row.twilio_from_number || 'Not set']];
    if (row.provider === 'aws') return [['Region', row.aws_region || 'Not set'], ['Sender ID', row.aws_sender_id || 'Not set']];
    return [['Remote URL', row.mojo_remote_url || 'Not set']];
}

function CredentialField({ field, existing, clearing, wide, inputRef, onToggle }: {
    field: PhoneSecretField;
    existing: boolean;
    clearing: boolean;
    wide?: boolean;
    inputRef: (node: HTMLInputElement | null) => void;
    onToggle: () => void;
}) {
    const inputId = `phonehub-${field}`;
    return <div className={`field phonehub-secret-field${wide ? ' phonehub-field-span' : ''}`}>
        <label className="field-label" htmlFor={inputId}>{credentialLabels[field]}</label>
        <div className="phonehub-secret-row">
            <input
                id={inputId}
                ref={inputRef}
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={existing ? 'Leave blank to keep the stored value' : 'Enter credential'}
                disabled={clearing}
            />
            {existing && <button type="button" className={`btn${clearing ? ' btn-danger' : ''}`} onClick={onToggle}>
                {clearing ? 'Keep stored value' : 'Clear stored value…'}
            </button>}
        </div>
        <span className={`field-help${clearing ? ' text-bad' : ''}`}>
            {clearing ? 'This credential will be cleared when you save.' : 'Write-only; the stored value is never displayed.'}
        </span>
    </div>;
}

function ConfigEditor({ row, close }: { row?: PhoneConfigRow; close: (value: PhoneConfigRow | null) => void }) {
    const qc = useQueryClient();
    const canGroups = useCan(PHONE_GROUP_DIRECTORY_PERMISSIONS).can;
    const groups = useQuery({ queryKey: ['phonehub', 'group-choices'], queryFn: fetchPhoneGroupChoices, enabled: canGroups, staleTime: 60_000 });
    const [name, setName] = useState(row?.name ?? '');
    const [provider, setProvider] = useState<PhoneProvider>(row?.provider ?? 'twilio');
    const [group, setGroup] = useState(row?.group == null ? '' : String(typeof row.group === 'number' ? row.group : row.group.id));
    const [active, setActive] = useState(row?.is_active ?? true);
    const [testMode, setTestMode] = useState(row?.test_mode ?? false);
    const [lookup, setLookup] = useState(row?.lookup_enabled ?? true);
    const [cacheDays, setCacheDays] = useState(row?.lookup_cache_days ?? 90);
    const [twilioFrom, setTwilioFrom] = useState(row?.twilio_from_number ?? '');
    const [awsRegion, setAwsRegion] = useState(row?.aws_region ?? 'us-east-1');
    const [awsSender, setAwsSender] = useState(row?.aws_sender_id ?? '');
    const [mojoUrl, setMojoUrl] = useState(resolveMojoRemoteUrl(row?.mojo_remote_url));
    const refs = useRef<Partial<Record<PhoneSecretField, HTMLInputElement | null>>>({});
    const [clearFields, setClearFields] = useState<PhoneSecretField[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const meta = providerMeta[provider];
    const invalidCache = lookup && (!Number.isFinite(cacheDays) || cacheDays < 1);

    const chooseProvider = (next: PhoneProvider) => {
        setProvider(next);
        if (next === 'mojo') setMojoUrl((value) => resolveMojoRemoteUrl(value));
        setClearFields([]);
    };
    const toggleClear = (field: PhoneSecretField) => {
        if (clearFields.includes(field)) {
            setClearFields(clearFields.filter((value) => value !== field));
            return;
        }
        if (window.confirm(`Clear the stored ${credentialLabels[field]} on save?`)) setClearFields([...clearFields, field]);
    };
    const submit = async () => {
        setBusy(true);
        setError('');
        const credentials: Partial<Record<PhoneSecretField, SecretEdit>> = {};
        const visibleCredentials = providerCredentialFields[provider];
        for (const field of Object.keys(credentialLabels) as PhoneSecretField[]) {
            const value = refs.current[field]?.value ?? '';
            credentials[field] = !visibleCredentials.includes(field)
                ? { mode: 'untouched' }
                : clearFields.includes(field)
                    ? { mode: 'clear', confirmed: true }
                    : value ? { mode: 'replace', value } : { mode: 'untouched' };
        }
        const providerChanges = provider === 'twilio'
            ? { twilio_from_number: twilioFrom || null }
            : provider === 'aws'
                ? { aws_region: awsRegion || null, aws_sender_id: awsSender || null }
                : { mojo_remote_url: resolveMojoRemoteUrl(mojoUrl) };
        try {
            buildPhoneConfigPayload({}, credentials);
            const saved = await savePhoneConfigImperative(qc, row?.id ?? null, {
                name: name.trim(), provider, group: group ? Number(group) : null,
                is_active: active, test_mode: testMode, lookup_enabled: lookup,
                lookup_cache_days: cacheDays, ...providerChanges,
            }, credentials);
            for (const field of Object.keys(credentialLabels) as PhoneSecretField[]) if (refs.current[field]) refs.current[field]!.value = '';
            toast.success(row ? 'Provider configuration updated' : 'Provider configuration created');
            close(saved);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Configuration could not be saved');
        } finally {
            setBusy(false);
        }
    };

    return <div className="modal-pad phonehub-config-editor">
        <header className="phonehub-config-header">
            <div className="eyebrow">Phone Hub</div>
            <h2 className="modal-title">{row ? 'Edit' : 'Create'} provider configuration</h2>
            <p className="dim">Choose a provider, enter only its connection details, then set how this configuration participates in delivery and lookup.</p>
        </header>
        <div className="phonehub-config-sections">
            {error && <div className="form-alert" role="alert">{error}</div>}
            <section className="phonehub-config-section" aria-labelledby="phonehub-basics-heading">
                <div className="phonehub-config-section-heading">
                    <span className="phonehub-config-section-icon"><i className="bi bi-card-heading" /></span>
                    <div><h3 id="phonehub-basics-heading">Basics</h3><p>Name the configuration and decide where it applies.</p></div>
                </div>
                <div className="phonehub-field-grid">
                    <label className="field phonehub-field-span"><span className="field-label">Name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Primary Twilio or Mojo Remote" /></label>
                    {canGroups ? <label className="field phonehub-field-span"><span className="field-label">Group scope</span><select className="input" value={group} onChange={(event) => setGroup(event.target.value)}><option value="">System default</option>{groups.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="field-help">System default is used when an active group-specific configuration is unavailable.</span></label> : <div className="field phonehub-field-span"><span className="field-label">Group scope</span><div className="input" aria-readonly="true">{relationLabel(row?.group ?? null)}</div><span className="field-help">Group choices stay hidden without global group-directory permission.</span></div>}
                    <fieldset className="phonehub-provider-fieldset phonehub-field-span">
                        <legend className="field-label">Provider</legend>
                        <div className="phonehub-provider-options">
                            {(Object.entries(providerMeta) as Array<[PhoneProvider, typeof providerMeta[PhoneProvider]]>).map(([value, option]) => <label className="phonehub-provider-option" key={value}>
                                <input type="radio" name="phonehub-provider" value={value} checked={provider === value} onChange={() => chooseProvider(value)} />
                                <span><i className={`bi ${option.icon}`} /><strong>{option.label}</strong><small>{option.description}</small></span>
                            </label>)}
                        </div>
                    </fieldset>
                </div>
            </section>

            <section className="phonehub-config-section" aria-labelledby="phonehub-connection-heading">
                <div className="phonehub-config-section-heading">
                    <span className="phonehub-config-section-icon"><i className={`bi ${meta.icon}`} /></span>
                    <div><h3 id="phonehub-connection-heading">{meta.label} connection</h3><p>Only fields for the selected provider are shown and submitted.</p></div>
                </div>
                <div className="phonehub-field-grid">
                    {provider === 'twilio' && <>
                        <label className="field phonehub-field-span"><span className="field-label">From number</span><input className="input" value={twilioFrom} onChange={(event) => setTwilioFrom(event.target.value)} placeholder="+15551234567" /></label>
                    </>}
                    {provider === 'aws' && <>
                        <label className="field"><span className="field-label">AWS region</span><input className="input" value={awsRegion} onChange={(event) => setAwsRegion(event.target.value)} placeholder="us-east-1" /></label>
                        <label className="field"><span className="field-label">Sender ID</span><input className="input" value={awsSender} onChange={(event) => setAwsSender(event.target.value)} placeholder="Optional, region-dependent" /></label>
                    </>}
                    {provider === 'mojo' && <>
                        <label className="field phonehub-field-span"><span className="field-label">Remote Mojo URL</span><input className="input" type="url" value={mojoUrl} onChange={(event) => setMojoUrl(event.target.value)} onBlur={() => setMojoUrl((value) => resolveMojoRemoteUrl(value))} placeholder={DEFAULT_MOJO_REMOTE_URL} /><span className="field-help">Defaults to the hosted MojoVerify API. Change this only for a custom Mojo endpoint.</span></label>
                    </>}
                    {providerCredentialFields[provider].map((field) => <CredentialField
                        key={field}
                        field={field}
                        existing={Boolean(row)}
                        clearing={clearFields.includes(field)}
                        wide={providerCredentialFields[provider].length === 1}
                        inputRef={(node) => { refs.current[field] = node; }}
                        onToggle={() => toggleClear(field)}
                    />)}
                </div>
                <div className={`phonehub-provider-note${provider === 'mojo' ? '' : ' is-warning'}`}><i className={`bi ${provider === 'mojo' ? 'bi-info-circle' : 'bi-exclamation-triangle'}`} /><span>{providerOperationalNote(provider)}</span></div>
            </section>

            <section className="phonehub-config-section" aria-labelledby="phonehub-behavior-heading">
                <div className="phonehub-config-section-heading">
                    <span className="phonehub-config-section-icon"><i className="bi bi-toggles" /></span>
                    <div><h3 id="phonehub-behavior-heading">Behavior</h3><p>Control selection, connection testing, and phone-number lookup.</p></div>
                </div>
                <div className="phonehub-behavior-grid">
                    <label className="phonehub-behavior-setting"><span><strong>Active</strong><small>Eligible for provider selection.</small></span><input type="checkbox" role="switch" className="switch" checked={active} onChange={(event) => setActive(event.target.checked)} /></label>
                    <label className="phonehub-behavior-setting"><span><strong>Test mode</strong><small>Short-circuit connection tests; delivery is unchanged.</small></span><input type="checkbox" role="switch" className="switch" checked={testMode} onChange={(event) => setTestMode(event.target.checked)} /></label>
                    <label className="phonehub-behavior-setting"><span><strong>Automatic lookup</strong><small>Look up carrier data for new numbers.</small></span><input type="checkbox" role="switch" className="switch" checked={lookup} onChange={(event) => setLookup(event.target.checked)} /></label>
                </div>
                <label className="field phonehub-cache-field"><span className="field-label">Lookup cache lifetime</span><div className="phonehub-number-suffix"><input className="input" type="number" min="1" value={cacheDays} disabled={!lookup} onChange={(event) => setCacheDays(Number(event.target.value))} /><span>days</span></div>{invalidCache && <span className="field-error">Enter at least 1 day.</span>}</label>
            </section>
        </div>
        <div className="modal-actions phonehub-config-actions">
            <button className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !name.trim() || invalidCache} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save configuration'}</button>
        </div>
    </div>;
}

function ConfigDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const qc = useQueryClient();
    const [saving, setSaving] = useState(false);
    const query = PhoneConfigModel.useOne(id);
    const canManage = useCan(PHONE_CONFIG_MANAGE_PERMISSIONS).can;


    const [testing, setTesting] = useState(false);
    if (!query.data) return <div className="modal-pad">{query.isLoading ? 'Loading provider configuration…' : 'Configuration unavailable'}<button className="btn" onClick={onClose}>Close</button></div>;
    const row = query.data;
    const toggle = async (next: boolean) => {
        if (!canManage || saving) return;
        setSaving(true);
        try { await savePhoneConfigImperative(qc, id, { is_active: next }, {}); await query.refetch(); }
        catch (error) { toast.error(error instanceof Error ? error.message : 'State change failed'); }
        finally { setSaving(false); }
    };
    const meta = providerMeta[row.provider];
    const edit = () => void modal.open((close) => <ConfigEditor row={row} close={async (saved) => { close(saved); if (saved) await query.refetch(); }} />, { size: 'lg' });
    const test = async () => {
        setTesting(true);
        try {
            const result = await testPhoneConfigImperative(id);
            toast[result.status ? 'success' : 'error'](result.message);
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Connection test failed');
        } finally {
            setTesting(false);
        }
    };

    return <DetailView
        title={row.name}
        subtitle={relationLabel(row.group)}
        icon={meta.icon}
        chips={[{ text: meta.label, tone: 'info' }, { text: row.is_active ? 'Active' : 'Inactive', tone: row.is_active ? 'success' : 'muted' }, ...(row.test_mode ? [{ text: 'Test mode', tone: 'warning' as const }] : [])]}
        onClose={onClose}
        active={canManage ? { value: row.is_active, disabled: saving, onChange: next => void toggle(next) } : undefined}
        contextMenu={canManage ? [{ label: 'Edit configuration', onSelect: edit }, { label: 'Test stored connection', disabled: testing, onSelect: () => void test() }, { label: row.is_active ? 'Deactivate' : 'Reactivate', disabled: saving, onSelect: () => void toggle(!row.is_active) }] : []}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-sliders', render: () => <div className="detail-section"><div className="phonehub-provider-summary"><i className={`bi ${meta.icon}`} /><div><span className="eyebrow">Provider</span><h3>{meta.label}</h3><p>{meta.description}</p></div></div><div className="phonehub-summary-grid"><div className="known-card"><span>Scope</span><strong>{relationLabel(row.group)}</strong></div><div className="known-card"><span>Automatic lookup</span><strong>{row.lookup_enabled ? `Enabled · ${row.lookup_cache_days} days` : 'Disabled'}</strong></div><div className="known-card"><span>Last modified</span><strong>{fmt.datetime(row.modified)}</strong></div></div><p className="dim">An active group configuration wins; otherwise Phone Hub falls back to the first active system default.</p></div> },
            { key: 'connection', label: 'Connection', icon: 'bi-plug', render: () => <div className="detail-section"><div className="section-eyebrow">{meta.label} settings</div>{providerVisibleRows(row).map(([label, value]) => <FlatRow key={label} label={label}>{value}</FlatRow>)}<FlatRow label="Credentials"><span><i className="bi bi-shield-lock" /> Write-only; edit to replace or clear</span></FlatRow><div className={`phonehub-provider-note${row.provider === 'mojo' ? '' : ' is-warning'}`}><i className={`bi ${row.provider === 'mojo' ? 'bi-info-circle' : 'bi-exclamation-triangle'}`} /><span>{providerOperationalNote(row.provider)}</span></div>{row.test_mode && <div className="phonehub-provider-note is-warning"><i className="bi bi-beaker" /><span>Test mode only short-circuits the connection test. It does not prevent SMS delivery.</span></div>}<FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow></div> }
        ]}
    />;
}
export function ProviderConfigsPage(){const canManage=useCan(PHONE_CONFIG_MANAGE_PERMISSIONS).can;return <ModelTable model={PhoneConfigModel} eyebrow="Communications · Phone Hub" title="Provider Configurations" columns={configColumns} defaultSort="name" searchable searchPlaceholder="Search configuration names" columnChooser persistState persistKey="admin:phonehub:configs" exportFormats={['csv','json']} exporter={exportPhoneConfigs} addLabel="Create configuration" onAdd={canManage?()=>void modal.open(close=><ConfigEditor close={close}/>,{size:'lg'}):undefined} onRowClick={row=>void modal.detail(close=><ConfigDetail id={row.id} onClose={()=>close(null)}/>)}/>;}

export function PhoneHubPage(){const canNumbers=useCan(PHONE_NUMBER_VIEW_PERMISSIONS).can;const canSms=useCan(SMS_VIEW_PERMISSIONS).can;const canConfig=useCan(PHONE_CONFIG_VIEW_PERMISSIONS).can;const items=[...(canNumbers?[{key:'numbers',label:'Phone Numbers',panel:<PhoneNumbersPage/>}]:[]),...(canSms?[{key:'sms',label:'SMS',panel:<SmsPage/>}]:[]),...(canConfig?[{key:'config',label:'Provider Config',panel:<ProviderConfigsPage/>}]:[])];return <div className="phonehub-page"><div className="phonehub-heading"><p className="eyebrow">Communications</p><h1>Phone Hub</h1><p className="dim">Global phone intelligence, SMS audit history, and provider configuration. This surface never adopts the active product group.</p></div><Tabs ariaLabel="Phone Hub admin areas" variant="underline-all" items={items}/></div>;}
