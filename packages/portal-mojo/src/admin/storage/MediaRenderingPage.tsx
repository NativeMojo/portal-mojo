// Storage → Media rendering (#7729): edit the three FILEMAN_RENDITIONS_*
// settings as a form built from django-mojo's rendition descriptor. See
// docs/admin-media-rendering.md for the contract and the invariants.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Tabs, modal, toast } from '../../ui';
import type { SettingRow } from '../settings/model';
import { renditionRoleLabel } from './file-renditions';
import {
    RENDITION_OPTIONS_ENDPOINT, AUTOMATIC_KEY, MP4_ONLY_OPTIONS, coerceFieldValue, draftToValue, fieldType, findCategoryRows,
    hidesMp4Options, isDefaultValue, orderedCategories, readRenditionOptions, renditionCategoryLabel, resetCategory,
    routeRenditionError, sameOverride, sameValue, saveCategoryValue, validateDraft, valueToDraft,
    type CategoryDraft, type RenditionCategory, type RenditionOptions,
} from './rendition-settings';

const OPTIONS_QUERY_KEY = ['fileman', 'renditions', 'options'] as const;
const rowQueryKey = (key: string) => ['settings', 'rendition-row', key] as const;

const FIELD_LABELS: Record<string, string> = {
    width: 'Width', height: 'Height', mode: 'Mode', format: 'Format', quality: 'Quality', time_offset: 'Frame at',
    bitrate: 'Bitrate', codec: 'Codec', crf: 'CRF', preset: 'Preset', duration: 'Seconds', audio: 'Audio', page: 'Page', max_pages: 'Max pages',
};
const PLACEHOLDERS: Record<string, string> = { bitrate: '2000k', time_offset: 'HH:MM:SS' };
// Display order only — membership always comes from the descriptor's `fields[kind]` (served sorted).
const FIELD_ORDER = ['width', 'height', 'mode', 'format', 'quality', 'time_offset', 'page', 'max_pages', 'bitrate', 'codec', 'crf', 'preset', 'duration', 'audio'];

function orderFields(names: readonly string[]): string[] {
    const rank = (name: string) => { const at = FIELD_ORDER.indexOf(name); return at === -1 ? FIELD_ORDER.length : at; };
    return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function fieldLabel(name: string): string {
    return FIELD_LABELS[name] ?? name.replace(/_/g, ' ');
}

function displayValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'not set';
    return typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value);
}

interface FieldProps {
    category: RenditionCategory;
    draft: CategoryDraft;
    role: string;
    kind: string;
    name: string;
    error: string | undefined;
    disabled: boolean;
    onChange: (name: string, value: unknown) => void;
}

function RoleField({ category, draft, role, kind, name, error, disabled, onChange }: FieldProps) {
    const type = fieldType(category, kind, name);
    const value = draft.roles[role]?.[name];
    const fallback = category.defaults[role]?.[name];
    const effective = category.effective.roles[role]?.[name];
    const isDefault = isDefaultValue(category, draft, role, name);
    const inEffect = !sameValue(effective, value) && effective !== undefined ? effective : undefined;
    const id = `media-rendering-${category.key}-${role}-${name}`;
    const className = `media-rendering-field${error ? ' is-invalid' : isDefault ? ' is-default' : ' is-changed'}`;
    const title = `Default: ${displayValue(fallback)}`;
    const help = error ?? (inEffect !== undefined ? `In effect: ${displayValue(inEffect)} (deployment file)` : undefined);
    let control;
    if (type === 'boolean') {
        control = <span className="media-rendering-field-switch">
            <input id={id} type="checkbox" role="switch" className="switch" checked={value === true} disabled={disabled} title={title} onChange={(event) => onChange(name, event.target.checked)} />
            <span className="dim">{value === true ? 'on' : 'off'}</span>
        </span>;
    } else if (type === 'choice') {
        const choices = category.choices[kind]?.[name] ?? [];
        const current = typeof value === 'string' ? value : '';
        control = <select id={id} className="input" value={current} disabled={disabled} title={title} onChange={(event) => onChange(name, event.target.value)}>
            <option value="">{fallback === undefined ? 'renderer default' : 'not set'}</option>
            {!choices.includes(current) && current !== '' && <option value={current}>{current}</option>}
            {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select>;
    } else if (type === 'number') {
        const [min, max] = category.limits[name] ?? [undefined, undefined];
        control = <input id={id} className="input" type="number" inputMode="numeric" min={min} max={max} step={1} disabled={disabled} title={title}
            placeholder={fallback === undefined ? 'renderer default' : String(fallback)} value={typeof value === 'number' ? value : ''}
            onChange={(event) => onChange(name, event.target.value)} />;
    } else {
        control = <input id={id} className="input" type="text" disabled={disabled} title={title} autoComplete="off" spellCheck={false}
            placeholder={PLACEHOLDERS[name] ?? (fallback === undefined ? 'renderer default' : String(fallback))} value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(name, event.target.value)} />;
    }
    return <div className={className}>
        <label className="field-label" htmlFor={id}>{fieldLabel(name)}</label>
        {control}
        {help && <span className={`field-help${error ? ' text-bad' : ''}`} role={error ? 'alert' : undefined}>{help}</span>}
    </div>;
}

function CategoryPanel({ category, categoryKey }: { category: RenditionCategory; categoryKey: string }) {
    const queryClient = useQueryClient();
    const rowsQuery = useQuery({ queryKey: rowQueryKey(category.key), queryFn: () => findCategoryRows(category.key), retry: false, refetchOnWindowFocus: false });
    const rows = rowsQuery.data ?? [];
    const row: SettingRow | null = rows[0] ?? null;
    const duplicates = rows.length > 1;
    const [draft, setDraft] = useState<CategoryDraft>(() => valueToDraft(category, category.override));
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const roles = Object.keys(category.defaults);
    const value = useMemo(() => draftToValue(category, draft), [category, draft]);
    const dirty = !sameOverride(value, category.override);
    // Hints wear the same slot and wording as a routed 400: the reason only, the role.field prefix is the label.
    const hints = useMemo(() => Object.fromEntries(validateDraft(category, draft).map((entry) => [`${entry.role}.${entry.field}`, routeRenditionError(entry.message).message])), [category, draft]);
    const hasH265 = roles.some((role) => category.defaults[role]?.codec === 'h265');

    const change = (role: string, name: string, raw: unknown) => {
        const kind = category.role_kinds[role] ?? '';
        const typed = coerceFieldValue(fieldType(category, kind, name), raw);
        setDraft((current) => ({ ...current, roles: { ...current.roles, [role]: { ...current.roles[role], [name]: typed } } }));
        setErrors((current) => { const next = { ...current }; delete next[`${role}.${name}`]; delete next[role]; return next; });
        setFormError('');
    };
    const toggleAutomatic = (role: string, on: boolean) => {
        setDraft((current) => ({ ...current, automatic: on ? [...current.automatic.filter((entry) => entry !== role), role] : current.automatic.filter((entry) => entry !== role) }));
        setErrors((current) => { const next = { ...current }; delete next[AUTOMATIC_KEY]; return next; });
        setFormError('');
    };
    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: OPTIONS_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: rowQueryKey(category.key) }),
        ]);
    };
    const fail = (reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'The rendition settings could not be saved';
        const routed = routeRenditionError(message, [...roles, AUTOMATIC_KEY]);
        if (routed.role === null) { setFormError(routed.message); return; }
        const key = routed.field ? `${routed.role}.${routed.field}` : routed.role;
        setErrors((current) => ({ ...current, [key]: routed.message }));
    };
    const save = async () => {
        setBusy(true); setFormError(''); setErrors({});
        try {
            await saveCategoryValue(category, row, value);
            toast.success(`${renditionCategoryLabel(categoryKey)} rendering saved`);
            await refresh();
        } catch (reason) {
            fail(reason);
        } finally {
            setBusy(false);
        }
    };
    const reset = async () => {
        const ok = await modal.confirm({
            title: `Reset ${renditionCategoryLabel(categoryKey).toLowerCase()} rendering to defaults?`,
            message: 'Every role goes back to the framework defaults and the default set of roles runs on upload. Existing files are not touched.',
            confirmText: 'Reset to defaults',
            danger: true,
        });
        if (!ok) return;
        setBusy(true); setFormError(''); setErrors({});
        try {
            await resetCategory(category, row);
            toast.success(`${renditionCategoryLabel(categoryKey)} rendering reset to defaults`);
            await refresh();
        } catch (reason) {
            fail(reason);
        } finally {
            setBusy(false);
        }
    };

    const disabled = busy || duplicates || rowsQuery.isPending;
    return <div className="media-rendering-panel">
        {hasH265 && <p className="media-rendering-note">
            <b>H.265 (HEVC)</b> encodes take several times longer than H.264 and do not play in every browser. Keep <code>video_mp4</code> as the H.264 compatibility rendition and enable <code>video_hevc</code> on upload only when the extra encode time is worth it.
        </p>}
        {rowsQuery.error && <div className="form-alert" role="alert">The current override could not be read: {rowsQuery.error.message} <button className="btn btn-compact" onClick={() => void rowsQuery.refetch()}>Retry</button></div>}
        {duplicates && <div className="form-alert" role="alert">
            More than one global row exists for <code>{category.key}</code> (ids {rows.map((entry) => entry.id).join(', ')}). The server reads an undefined one, so this page will not edit them; remove the duplicates on the server first.
        </div>}
        {formError && <div className="form-alert" role="alert">{formError}</div>}
        <div className="media-rendering-roles">
            {roles.map((role) => {
                const kind = category.role_kinds[role] ?? '';
                const hideMp4 = hidesMp4Options(category, draft, role);
                const names = orderFields(category.fields[kind] ?? Object.keys(category.defaults[role] ?? {})).filter((name) => !(hideMp4 && (MP4_ONLY_OPTIONS as readonly string[]).includes(name)));
                const roleError = errors[role];
                const automatic = draft.automatic.includes(role);
                const automaticDefault = category.automatic_default.includes(role);
                const automaticEffective = category.effective.automatic.includes(role);
                const rowHasError = Boolean(roleError) || names.some((name) => errors[`${role}.${name}`]);
                return <div key={role} className={`media-rendering-role${rowHasError ? ' has-error' : ''}`}>
                    <div className="media-rendering-role-head">
                        <b>{renditionRoleLabel(role)}</b>
                        <code>{role}</code>
                        <span><Badge tone="muted">{kind || 'option'}</Badge></span>
                    </div>
                    <div className="media-rendering-fields">
                        {names.map((name) => <RoleField key={name} category={category} draft={draft} role={role} kind={kind} name={name}
                            error={errors[`${role}.${name}`] ?? hints[`${role}.${name}`]} disabled={disabled} onChange={(field, raw) => change(role, field, raw)} />)}
                    </div>
                    <div className="media-rendering-upload">
                        <label className={automatic === automaticDefault ? 'dim' : undefined}>
                            <input type="checkbox" role="switch" className="switch" checked={automatic} disabled={disabled} onChange={(event) => toggleAutomatic(role, event.target.checked)} />
                            Runs on upload
                        </label>
                        {automatic !== automaticEffective && <span className="field-help">In effect: {automaticEffective ? 'runs' : 'does not run'} (deployment file)</span>}
                    </div>
                    {roleError && <p className="media-rendering-role-error" role="alert">{roleError}</p>}
                </div>;
            })}
        </div>
        {errors[AUTOMATIC_KEY] && <div className="form-alert" role="alert">Runs on upload: {errors[AUTOMATIC_KEY]}</div>}
        <div className="media-rendering-actions">
            <button className="btn btn-primary" disabled={disabled || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn" disabled={disabled || !row || category.override == null} onClick={() => void reset()}>Reset to defaults…</button>
            <span className="dim">{row ? `Override row #${row.id}` : 'No override row yet — Save creates one.'}</span>
        </div>
    </div>;
}

function MediaRenderingContent({ options }: { options: RenditionOptions }) {
    const categories = orderedCategories(options);
    const items = categories.map((categoryKey) => {
        const category = options.categories[categoryKey]!;
        return {
            key: categoryKey,
            label: renditionCategoryLabel(categoryKey),
            // Remount the panel whenever the override changes so the draft reseeds from the saved row.
            panel: <CategoryPanel key={`${category.key}:${JSON.stringify(category.override ?? null)}`} category={category} categoryKey={categoryKey} />,
        };
    });
    if (!items.length) return <div className="panel panel-pad">The backend declares no configurable rendition categories.</div>;
    return <Tabs items={items} variant="underline" ariaLabel="Media rendering categories" />;
}

export function MediaRenderingPage() {
    const query = useQuery({ queryKey: OPTIONS_QUERY_KEY, queryFn: readRenditionOptions, retry: false, refetchOnWindowFocus: false });
    return <div className="page media-rendering-page">
        <header className="page-header">
            <div>
                <div className="eyebrow">Infrastructure · Storage</div>
                <h1>Media rendering</h1>
                <p className="dim media-rendering-hint">
                    How thumbnails, previews and transcodes are produced, and which run after an upload. Only values that differ from the framework defaults are stored.
                    Changing these options does not touch existing files — open a file under Storage → Files and use <b>Regenerate renditions</b> to see the result.
                </p>
            </div>
        </header>
        {query.isPending && <div className="panel panel-pad">Loading rendition options…</div>}
        {query.error && <div className="panel panel-pad">
            <div className="form-alert" role="alert">{query.error.message}</div>
            <button className="btn" onClick={() => void query.refetch()}>Retry</button>
        </div>}
        {query.data && <div className="panel panel-pad">
            <MediaRenderingContent options={query.data} />
            <p className="dim media-rendering-engine" style={{ marginTop: 14 }}>
                Video engine: <code>{query.data.engine.effective}</code> ({query.data.engine.key} — edit on the Settings page when another engine exists). Descriptor: <code>{RENDITION_OPTIONS_ENDPOINT}</code>.
            </p>
        </div>}
    </div>;
}
