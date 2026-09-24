// System Sign-in admin (#5547): the SYSTEM login page look & feel plus the
// Google / Apple / GitHub OAuth provider credentials, over one endpoint
// (GET/POST /api/account/admin/signin, global manage_settings | admin).
// Deliberately simple: an explicit Save for look & feel that sends only the
// changed dotted paths, one Save per provider card, and an immediate Enabled
// switch. The group "Configure Auth" dialog stays the per-group override.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, MultiSelectDropdown, toast } from '../../ui';
import {
    SIGNIN_QUERY_KEY, fetchSigninSettings, getSigninPath, saveSigninAuth, saveSigninProvider,
    type SigninOptions, type SigninProvider, type SigninProviderField, type SigninSettings,
} from './api';

type FieldKind = 'text' | 'url' | 'textarea' | 'css' | 'select' | 'color' | 'methods' | 'bool';
interface FieldSpec {
    path: string;
    label: string;
    kind: FieldKind;
    help?: string;
    options?: keyof SigninOptions;
    wide?: boolean;
}
interface FieldGroup { key: string; title: string; icon: string; blurb: string; fields: FieldSpec[] }

const FIELD_GROUPS: FieldGroup[] = [
    {
        key: 'branding', title: 'Branding', icon: 'bi-badge-tm', blurb: 'Names and images shown around the sign-in form.',
        fields: [
            { path: 'theme.app_title', label: 'App title', kind: 'text', help: 'Brand name in the page header and browser tab.' },
            { path: 'theme.auth_provider_name', label: 'Sign-in provider name', kind: 'text', help: 'Who is signing the user in, e.g. "Acme Account".' },
            { path: 'theme.logo_url', label: 'Logo URL', kind: 'url' },
            { path: 'theme.favicon_url', label: 'Favicon URL', kind: 'url' },
        ],
    },
    {
        key: 'layout', title: 'Layout & color', icon: 'bi-palette', blurb: 'Overall arrangement, light/dark behavior and accent color.',
        fields: [
            { path: 'theme.layout', label: 'Layout', kind: 'select', options: 'layouts' },
            { path: 'theme.appearance', label: 'Appearance', kind: 'select', options: 'appearances', help: 'System follows the visitor’s device setting.' },
            { path: 'theme.accent_color', label: 'Accent color', kind: 'color', help: 'Buttons and links on the sign-in page.' },
        ],
    },
    {
        key: 'hero', title: 'Hero panel', icon: 'bi-image', blurb: 'The large image and headline beside the form (panel layouts).',
        fields: [
            { path: 'theme.hero_headline', label: 'Headline', kind: 'text' },
            { path: 'theme.hero_subheadline', label: 'Subheadline', kind: 'text' },
            { path: 'theme.hero_image_url', label: 'Image URL', kind: 'url', help: 'Used when no light/dark variant is set.', wide: true },
            { path: 'theme.hero_image_url_light', label: 'Image URL (light)', kind: 'url' },
            { path: 'theme.hero_image_url_dark', label: 'Image URL (dark)', kind: 'url' },
            { path: 'theme.hero_image_position', label: 'Image focus', kind: 'select', options: 'hero_image_positions' },
            { path: 'theme.back_to_website_label', label: 'Back-to-website label', kind: 'text' },
        ],
    },
    {
        key: 'login', title: 'Sign-in form', icon: 'bi-box-arrow-in-right', blurb: 'Heading, supporting text and the ways people can sign in.',
        fields: [
            { path: 'login.heading', label: 'Heading', kind: 'text' },
            { path: 'login.methods', label: 'Sign-in methods', kind: 'methods', options: 'login_methods', help: 'Password always stays on so admins can get in.' },
            { path: 'login.supporting_copy', label: 'Supporting text', kind: 'textarea', wide: true },
        ],
    },
    {
        key: 'registration', title: 'Registration', icon: 'bi-person-plus', blurb: 'Whether new people can sign up, and how.',
        fields: [
            { path: 'registration.enabled', label: 'Allow sign-up', kind: 'bool', help: 'When off, the registration page is hidden.', wide: true },
            { path: 'registration.methods', label: 'Sign-up methods', kind: 'methods', options: 'registration_methods' },
            { path: 'registration.passkey_prompt', label: 'Passkey prompt after sign-up', kind: 'select', options: 'passkey_prompts' },
        ],
    },
    {
        key: 'css', title: 'Custom CSS', icon: 'bi-braces', blurb: 'Inline CSS added after the theme stylesheet.',
        fields: [
            { path: 'theme.custom_css', label: 'Custom CSS', kind: 'css', help: 'No external URLs, @import or HTML.', wide: true },
        ],
    },
];

const TOKEN_LABELS: Record<string, string> = {
    password: 'Password', sms: 'SMS code', passkey: 'Passkey', magic: 'Magic link',
    google: 'Google', apple: 'Apple', github: 'GitHub',
    'branded-panel': 'Branded panel',
};
const tokenLabel = (token: string) => TOKEN_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1).replace(/-/g, ' ');
const LAYOUT_ALIASES: Record<string, string> = { card: 'compact', fullscreen: 'branded-panel' };
const PROVIDER_ICONS: Record<string, string> = { google: 'bi-google', apple: 'bi-apple', github: 'bi-github' };
const SOURCE_LABELS: Record<SigninProviderField['source'], string> = {
    admin: 'Set in Admin', deployment: 'Set in server config', none: 'Not set',
};

function errorMessage(reason: unknown, fallback: string): string {
    return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** The value the form shows for a path when it has no local edit. */
function baselineValue(settings: SigninSettings, spec: FieldSpec): unknown {
    const raw = getSigninPath(settings.auth, spec.path);
    if (spec.kind === 'bool') return raw === true;
    if (spec.kind === 'methods') {
        const list = Array.isArray(raw) ? raw.map(String) : [];
        return spec.path === 'login.methods' && !list.includes('password') ? ['password', ...list] : list;
    }
    if (spec.kind === 'select') {
        const options = settings.options[spec.options!] ?? [];
        const value = spec.path === 'theme.layout' ? LAYOUT_ALIASES[String(raw)] ?? String(raw ?? '') : String(raw ?? '');
        if (options.includes(value)) return value;
        console.warn(`[signin] ${spec.path} value "${String(raw)}" is not one of ${options.join(', ')}; showing "${options[0] ?? ''}"`);
        return options[0] ?? '';
    }
    return raw == null ? '' : String(raw);
}

function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
        const left = [...(Array.isArray(a) ? a : [])].map(String).sort();
        const right = [...(Array.isArray(b) ? b : [])].map(String).sort();
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }
    return a === b;
}

function LookAndFeel({ settings, onSaved }: { settings: SigninSettings; onSaved: (next: SigninSettings) => void }) {
    const [edits, setEdits] = useState<Record<string, unknown>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const editable = new Set(settings.editable);
    const groups = FIELD_GROUPS
        .map((group) => ({ ...group, fields: group.fields.filter((field) => editable.has(field.path)) }))
        .filter((group) => group.fields.length > 0);
    const specs = groups.flatMap((group) => group.fields);
    const valueOf = (spec: FieldSpec) => spec.path in edits ? edits[spec.path] : baselineValue(settings, spec);
    const changed = specs.filter((spec) => spec.path in edits && !sameValue(edits[spec.path], baselineValue(settings, spec)));
    const set = (path: string, value: unknown) => { setEdits((current) => ({ ...current, [path]: value })); setError(''); };

    const save = async () => {
        if (changed.length === 0) return;
        const payload = Object.fromEntries(changed.map((spec) => [spec.path, valueOf(spec)]));
        setBusy(true);
        setError('');
        try {
            const next = await saveSigninAuth(payload);
            setEdits({});
            onSaved(next);
            toast.success('Sign-in page saved');
        } catch (reason) {
            const message = errorMessage(reason, 'Sign-in page could not be saved');
            setError(message);
            toast.error(message);
        } finally {
            setBusy(false);
        }
    };

    const control = (spec: FieldSpec): ReactNode => {
        const id = `signin-${spec.path.replace('.', '-')}`;
        const value = valueOf(spec);
        const help = spec.help ? <span className="field-help">{spec.help}</span> : null;
        const className = `field${spec.wide ? ' signin-field-span' : ''}`;
        if (spec.kind === 'methods') {
            const options = (settings.options[spec.options!] ?? []).map((token) => ({
                value: token,
                label: spec.path === 'login.methods' && token === 'password' ? 'Password (always on)' : tokenLabel(token),
                disabled: spec.path === 'login.methods' && token === 'password',
            }));
            return <div className={className} key={spec.path}>
                <MultiSelectDropdown label={spec.label} help={spec.help} options={options} value={value as string[]}
                    onChange={(next) => set(spec.path, next.map(String))} maxLabelsToShow={4} />
            </div>;
        }
        if (spec.kind === 'bool') {
            return <label className={`signin-toggle${spec.wide ? ' signin-field-span' : ''}`} key={spec.path}>
                <span><strong>{spec.label}</strong>{spec.help && <small>{spec.help}</small>}</span>
                <input type="checkbox" role="switch" className="switch" checked={value === true} onChange={(event) => set(spec.path, event.target.checked)} />
            </label>;
        }
        if (spec.kind === 'select') {
            return <label className={className} key={spec.path}>
                <span className="field-label">{spec.label}</span>
                <select id={id} className="input" value={String(value)} onChange={(event) => set(spec.path, event.target.value)}>
                    {(settings.options[spec.options!] ?? []).map((token) => <option key={token} value={token}>{tokenLabel(token)}</option>)}
                </select>
                {help}
            </label>;
        }
        if (spec.kind === 'color') {
            const text = String(value);
            const valid = /^#[0-9a-fA-F]{6}$/.test(text);
            return <div className={className} key={spec.path}>
                <label className="field-label" htmlFor={id}>{spec.label}</label>
                <div className="signin-color-row">
                    <input type="color" className="signin-color-swatch" aria-label={`${spec.label} picker`} value={valid ? text : '#6384ff'} onChange={(event) => set(spec.path, event.target.value)} />
                    <input id={id} className="input" value={text} spellCheck={false} onChange={(event) => set(spec.path, event.target.value.trim())} placeholder="#6384ff" />
                </div>
                {valid ? help : <span className="field-error">Use a #rrggbb color.</span>}
            </div>;
        }
        if (spec.kind === 'textarea' || spec.kind === 'css') {
            return <label className={className} key={spec.path}>
                <span className="field-label">{spec.label}</span>
                <textarea id={id} className={`input${spec.kind === 'css' ? ' signin-code' : ''}`} rows={spec.kind === 'css' ? 6 : 3}
                    spellCheck={spec.kind !== 'css'} value={String(value)} onChange={(event) => set(spec.path, event.target.value)} />
                {help}
            </label>;
        }
        return <label className={className} key={spec.path}>
            <span className="field-label">{spec.label}</span>
            <input id={id} className="input" type={spec.kind === 'url' ? 'url' : 'text'} value={String(value)}
                placeholder={spec.kind === 'url' ? 'https://…' : undefined} onChange={(event) => set(spec.path, event.target.value)} />
            {help}
        </label>;
    };

    const colorInvalid = changed.some((spec) => spec.kind === 'color' && !/^#[0-9a-fA-F]{6}$/.test(String(valueOf(spec))));
    return <section className="panel signin-card" aria-labelledby="signin-look-heading">
        <header className="signin-card-header">
            <div>
                <h2 id="signin-look-heading" className="panel-title">Look &amp; feel</h2>
                <p className="dim">The system sign-in page. Groups with their own “Configure Auth” settings override these.</p>
            </div>
        </header>
        <div className="signin-groups">
            {groups.map((group) => <section className="signin-group" key={group.key} aria-labelledby={`signin-group-${group.key}`}>
                <div className="signin-group-heading">
                    <span className="signin-group-icon"><i className={`bi ${group.icon}`} /></span>
                    <div><h3 id={`signin-group-${group.key}`}>{group.title}</h3><p>{group.blurb}</p></div>
                </div>
                <div className="signin-field-grid">{group.fields.map(control)}</div>
            </section>)}
        </div>
        {error && <div className="form-alert signin-save-error" role="alert">{error}</div>}
        <footer className="signin-save-bar">
            <span className={changed.length ? 'signin-dirty' : 'dim'}>
                {changed.length ? `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}` : 'All changes saved'}
            </span>
            <button type="button" className="btn" disabled={busy || changed.length === 0} onClick={() => { setEdits({}); setError(''); }}>Discard</button>
            <button type="button" className="btn btn-primary" disabled={busy || changed.length === 0 || colorInvalid} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
            </button>
        </footer>
    </section>;
}

/** Clipboard API first; where it is denied, select the field and fall back to execCommand. */
function CopyButton({ text, label, inputId }: { text: string; label: string; inputId: string }) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const legacyCopy = () => {
        const input = document.getElementById(inputId) as HTMLInputElement | null;
        if (!input) return false;
        input.focus();
        input.select();
        try { return document.execCommand('copy'); } catch { return false; }
    };
    const copy = async () => {
        let ok = false;
        try {
            if (!navigator.clipboard) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch {
            ok = legacyCopy();
        }
        if (!ok) { toast.error('Copy was blocked — the URL is selected, press Ctrl/⌘+C'); return; }
        setCopied(true);
        toast.success(`${label} copied`);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
    };
    return <button type="button" className="btn" onClick={() => void copy()} aria-label={`Copy ${label}`}>
        <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'}`} /> {copied ? 'Copied' : 'Copy'}
    </button>;
}

function ProviderCard({ provider, onSaved }: { provider: SigninProvider; onSaved: (next: SigninSettings) => void }) {
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const displayed = (field: SigninProviderField) => field.key in edits ? edits[field.key]! : field.secret ? '' : field.value ?? '';
    const dirty = provider.fields.filter((field) => field.key in edits && edits[field.key] !== (field.secret ? '' : field.value ?? '') && edits[field.key]!.trim() !== '');

    const run = async (change: Parameters<typeof saveSigninProvider>[0], success: string) => {
        setBusy(true);
        setError('');
        try {
            const next = await saveSigninProvider(change);
            onSaved(next);
            toast.success(success);
            return true;
        } catch (reason) {
            const message = errorMessage(reason, `${provider.label} settings could not be saved`);
            setError(message);
            toast.error(message);
            return false;
        } finally {
            setBusy(false);
        }
    };
    const save = async () => {
        const values = Object.fromEntries(dirty.map((field) => [field.key, edits[field.key]!]));
        if (await run({ provider: provider.name, values }, `${provider.label} credentials saved`)) setEdits({});
    };
    const clear = async (field: SigninProviderField) => {
        if (!window.confirm(`Clear the stored ${provider.label} ${field.label}?`)) return;
        if (await run({ provider: provider.name, values: { [field.key]: null } }, `${provider.label} ${field.label} cleared`)) {
            setEdits(({ [field.key]: _removed, ...rest }) => rest);
        }
    };

    return <section className="panel signin-provider" aria-labelledby={`signin-provider-${provider.name}`}>
        <header className="signin-provider-header">
            <span className="signin-provider-icon"><i className={`bi ${PROVIDER_ICONS[provider.name] ?? 'bi-key'}`} /></span>
            <div className="signin-provider-title">
                <h3 id={`signin-provider-${provider.name}`}>{provider.label}</h3>
                {provider.ready ? <Badge tone="success">Ready</Badge> : <Badge tone="warning">Needs setup</Badge>}
            </div>
            <label className="signin-provider-switch">
                <span>{provider.enabled ? 'Enabled' : 'Off'}</span>
                <input type="checkbox" role="switch" className="switch" aria-label={`Enable ${provider.label} sign-in`} checked={provider.enabled} disabled={busy}
                    onChange={(event) => void run({ provider: provider.name, enabled: event.target.checked }, `${provider.label} sign-in ${event.target.checked ? 'enabled' : 'turned off'}`)} />
            </label>
        </header>
        <p className="signin-provider-help">{provider.help} {provider.console_url && <a href={provider.console_url} target="_blank" rel="noreferrer">Open {provider.label} console <i className="bi bi-box-arrow-up-right" /></a>}</p>
        {provider.enabled && !provider.ready && <div className="signin-note is-warning" role="status">
            <i className="bi bi-exclamation-triangle" />
            <span>Shown on the sign-in page, but it will not work until these are set: {provider.missing.join(', ')}.</span>
        </div>}
        {error && <div className="form-alert" role="alert">{error}</div>}
        <div className="field">
            <label className="field-label" htmlFor={`signin-${provider.name}-callback`}>Callback URL</label>
            <div className="signin-inline-row">
                <input id={`signin-${provider.name}-callback`} className="input signin-code" readOnly value={provider.callback_url} onFocus={(event) => event.target.select()} />
                <CopyButton text={provider.callback_url} label={`${provider.label} callback URL`} inputId={`signin-${provider.name}-callback`} />
            </div>
            <span className="field-help">Paste this into the {provider.label} console as the redirect / callback URL.</span>
        </div>
        {provider.fields.map((field) => {
            const id = `signin-${provider.name}-${field.key}`;
            const placeholder = field.secret
                ? field.configured ? 'Leave blank to keep the stored value' : field.multiline ? 'Paste the full key, including the BEGIN and END lines' : 'Enter value'
                : field.source === 'deployment' ? 'Set in server config' : 'Enter value';
            const status = field.secret && field.configured
                ? `${SOURCE_LABELS[field.source]}${field.hint ? ` · ends ${field.hint}` : ''}`
                : SOURCE_LABELS[field.source];
            return <div className="field" key={field.key}>
                <div className="signin-field-label-row">
                    <label className="field-label" htmlFor={id}>{field.label}</label>
                    <span className={`signin-source signin-source-${field.source}`}>{status}</span>
                </div>
                <div className="signin-inline-row">
                    {field.multiline
                        ? <textarea id={id} className="input signin-code" rows={4} spellCheck={false} autoComplete="off" value={displayed(field)}
                            placeholder={placeholder} disabled={busy} onChange={(event) => setEdits({ ...edits, [field.key]: event.target.value })} />
                        : <input id={id} className="input" type={field.secret ? 'password' : 'text'} autoComplete={field.secret ? 'new-password' : 'off'}
                            spellCheck={false} value={displayed(field)} placeholder={placeholder} disabled={busy}
                            onChange={(event) => setEdits({ ...edits, [field.key]: event.target.value })} />}
                    {field.source === 'admin' && field.configured && <button type="button" className="btn" disabled={busy} onClick={() => void clear(field)}>Clear…</button>}
                </div>
            </div>;
        })}
        <footer className="signin-provider-actions">
            <button type="button" className="btn" disabled={busy || Object.keys(edits).length === 0} onClick={() => { setEdits({}); setError(''); }}>Discard</button>
            <button type="button" className="btn btn-primary" disabled={busy || dirty.length === 0} onClick={() => void save()}>{busy ? 'Saving…' : `Save ${provider.label}`}</button>
        </footer>
    </section>;
}

export function SigninPage() {
    const qc = useQueryClient();
    const query = useQuery({ queryKey: SIGNIN_QUERY_KEY, queryFn: fetchSigninSettings });
    const onSaved = (next: SigninSettings) => qc.setQueryData(SIGNIN_QUERY_KEY, next);
    return <div className="signin-page">
        <div className="signin-heading">
            <p className="eyebrow">Identity &amp; Access</p>
            <h1>Sign-in</h1>
            <p className="dim">How the system login page looks, and which social sign-in providers it offers.</p>
        </div>
        {query.isLoading && <div className="panel panel-pad" role="status"><span className="spinner" aria-hidden /> Loading sign-in settings…</div>}
        {query.isError && <div className="panel panel-pad">
            <div className="form-alert" role="alert">{errorMessage(query.error, 'Sign-in settings could not be loaded')}</div>
            <button type="button" className="btn" onClick={() => void query.refetch()}>Retry</button>
        </div>}
        {query.data && <>
            <LookAndFeel settings={query.data} onSaved={onSaved} />
            <section aria-labelledby="signin-providers-heading" className="signin-providers-section">
                <div className="signin-section-heading">
                    <h2 id="signin-providers-heading" className="panel-title">Providers</h2>
                    <p className="dim">Social sign-in buttons. Blank secret fields keep what is stored.</p>
                </div>
                <div className="signin-provider-grid">
                    {query.data.providers.map((provider) => <ProviderCard key={provider.name} provider={provider} onSaved={onSaved} />)}
                </div>
            </section>
        </>}
    </div>;
}
