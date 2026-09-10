import { useQuery } from '@tanstack/react-query';
import type { MemberLike } from '../../client/me';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileReference } from '../../client/record-feed';
import { memberHasPermission, mojoCall, mojoList, useCan, useMe, useRealtime, useRealtimeStatus } from '../../client/runtime';
import { Badge, DetailView, FlatRow, fmt, modal } from '../../ui';
import { AssistantFeed } from './AssistantFeed';
import { ASSISTANT_PERMISSIONS } from './AssistantPanel';
import { deleteAssistantMemory, getAssistantConversation, getAssistantMemory, getAssistantSkill, listAssistantConversations, listAssistantSkills, saveAssistantMemory, sendAssistantMessage } from './api';
import { setAssistantSkillActive } from './skill-lifecycle';
import { AssistantOutcomeUnknownError, chooseAssistantTransport, startAssistantRealtimeTurn, type AssistantRealtimeTurn } from './streaming';
import type { AssistantConversation, AssistantConversationSummary, AssistantSkill } from './types';

function PageState({ loading, error, retry }: { loading: boolean; error: string; retry(): void }) { if (loading) return <div className="panel panel-pad dim">Loading…</div>; if (error) return <div className="panel panel-pad"><div className="form-alert" role="alert">{error}</div><button type="button" className="btn" onClick={retry}>Retry</button></div>; return null; }
function Heading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="admin-page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div></header>; }

function ConversationInspect({ id, close }: { id: number; close(): void }) {
    const { data: me } = useMe(); const { can: canAssistant } = useCan(ASSISTANT_PERMISSIONS); const { can: canViewAdmin } = useCan('sys.view_admin');
    const realtime = useRealtime(); const realtimeStatus = useRealtimeStatus();
    const [data, setData] = useState<AssistantConversation | null>(null); const [loading, setLoading] = useState(true); const [responding, setResponding] = useState(false); const [error, setError] = useState('');
    const stream = useRef<AssistantRealtimeTurn | null>(null); const seenMessageIds = useRef(new Set<number | string>());
    const load = useCallback(async () => { setLoading(true); setError(''); try { const next = await getAssistantConversation(id); seenMessageIds.current = new Set(next.messages.map((message) => message.id)); setData(next); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Conversation unavailable'); } finally { setLoading(false); } }, [id]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => () => { stream.current?.cancel(); stream.current = null; }, []);
    useEffect(() => { if (!canAssistant) { stream.current?.cancel(); stream.current = null; setResponding(false); close(); } }, [canAssistant, close]);
    useEffect(() => { if (!canViewAdmin && stream.current) { stream.current.cancel(); stream.current = null; setResponding(false); void load(); } }, [canViewAdmin, load]);
    if (loading || error || !data || !me) return <div className="modal-pad"><PageState loading={loading} error={error || (!data ? 'Conversation unavailable' : '')} retry={() => void load()} /><button type="button" className="btn" onClick={close}>Close</button></div>;
    const owner = data.user.id === me.id;
    const send = async (message: string, attachments: readonly FileReference[] = []) => {
        if (!owner || responding) return;
        setResponding(true); const now = Math.floor(Date.now() / 1000);
        const userMessage = { id: `inspect-user-${Date.now()}`, role: 'user' as const, content: message, created: now, blocks: attachments.length ? [{ type: 'attachment' as const, files: [...attachments] }] : [] };
        setData((current) => current ? { ...current, messages: [...current.messages, userMessage] } : current);
        try {
            const transport = chooseAssistantTransport({ owner, textOnly: attachments.length === 0, hasViewAdmin: canViewAdmin, realtimeStatus: realtimeStatus.status });
            if (transport === 'websocket') {
                const turn = startAssistantRealtimeTurn(realtime, { message, conversationId: data.id, seenMessageIds: seenMessageIds.current }, {
                    onConversation: () => {},
                    onText: (next) => setData((current) => current ? { ...current, messages: [...current.messages, next] } : current),
                    onProgress: () => {},
                    onResponse: (next) => setData((current) => current ? { ...current, modified: now, messages: current.messages.some((item) => item.id === next.id) ? current.messages : [...current.messages, next] } : current),
                    onReconcile: setData,
                    onUnknown: () => { window.dispatchEvent(new CustomEvent('portal-mojo:assistant-list-refresh')); },
                });
                stream.current = turn; await turn.promise; stream.current = null;
            } else {
                const reply = await sendAssistantMessage(message, data.id, attachments);
                setData((current) => current ? { ...current, modified: now, messages: [...current.messages, { id: `inspect-assistant-${Date.now()}`, role: 'assistant', content: reply.response, created: now, blocks: reply.blocks }] } : current);
            }
        } catch (cause) {
            if (!(cause instanceof AssistantOutcomeUnknownError)) setData((current) => current ? { ...current, messages: current.messages.filter((item) => item.id !== userMessage.id) } : current);
            throw cause;
        } finally { stream.current = null; setResponding(false); }
    };
    return <DetailView title={data.title} subtitle={`Conversation #${data.id} · ${data.user.display_name} · updated ${fmt.datetime(data.modified)}`} icon="bi-chat-dots" onClose={close} sections={[{ key: 'conversation', label: 'Conversation', icon: 'bi-chat-text', render: () => <AssistantFeed messages={data.messages} user={{ id: me.id, display_name: me.display_name ?? 'You' }} onSend={send} responding={responding} disabled={!owner} attachmentKey={data.id} /> }]} />;
}

export function ConversationsPage() {
    const { data: me } = useMe(); const [rows, setRows] = useState<AssistantConversationSummary[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
    const load = useCallback(async () => { setLoading(true); setError(''); try { setRows((await listAssistantConversations()).rows); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Conversations unavailable'); } finally { setLoading(false); } }, []);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => { const refresh = () => { void load(); }; window.addEventListener('portal-mojo:assistant-list-refresh', refresh); return () => window.removeEventListener('portal-mojo:assistant-list-refresh', refresh); }, [load]);

    return <div><Heading eyebrow="Assistant" title="Conversations" description="Inspect Assistant history. Only the owner may continue a conversation." /><PageState loading={loading} error={error} retry={() => void load()} />{!loading && !error && <div className="panel assistant-list"><table><thead><tr><th>Conversation</th><th>Owner</th><th>Updated</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><button className="link-button" type="button" onClick={() => void modal.detail((close) => <ConversationInspect id={row.id} close={() => close(null)} />)}>{row.title}</button><small>#{row.id}</small></td><td>{row.user.display_name}{row.user.id === me?.id && <Badge tone="info">You</Badge>}</td><td>{fmt.datetime(row.modified)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="empty">No conversations.</p>}</div>}</div>;
}

function SkillInspect({ id, close }: { id: number; close(): void }) {
    const [skill, setSkill] = useState<AssistantSkill | null>(null);
    const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
    const canManage = useCan('sys.view_admin').can;
    useEffect(() => { void getAssistantSkill(id).then(setSkill, cause => setError(cause instanceof Error ? cause.message : 'Skill unavailable')); }, [id]);
    const toggle = async (next: boolean) => { if (!canManage || busy) return; setBusy(true); setError(''); try { setSkill(await setAssistantSkillActive(id, next)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'State change failed'); } finally { setBusy(false); } };
    return <DetailView title={skill?.name ?? 'Skill'} subtitle={skill?.description || `Skill #${id}`} icon="bi-stars" onClose={close}
        active={canManage && skill ? { value: skill.is_active, disabled: busy, onChange: next => void toggle(next) } : undefined}
        contextMenu={canManage && skill ? [{ label: skill.is_active ? 'Deactivate' : 'Reactivate', disabled: busy, onSelect: () => void toggle(!skill.is_active) }] : []}
        sections={[{ key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="detail-section">{error && <div className="form-alert">{error}</div>}{skill ? <><FlatRow label="Tier">{skill.tier}</FlatRow><FlatRow label="Active">{skill.is_active ? 'Yes' : 'No'}</FlatRow><FlatRow label="Auto execute">{skill.auto_execute ? 'Yes' : 'No'}</FlatRow><h3>Triggers</h3><ul>{skill.triggers.map(trigger => <li key={trigger}>{trigger}</li>)}</ul><h3>Steps</h3><ol>{skill.steps.map((step, index) => <li key={index}><code>{JSON.stringify(step)}</code></li>)}</ol></> : <p>Loading…</p>}</div> }]} />;
}

export function SkillsPage() {
    const [rows, setRows] = useState<AssistantSkill[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
    const load = useCallback(async () => { setLoading(true); setError(''); try { setRows((await listAssistantSkills()).rows); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Skills unavailable'); } finally { setLoading(false); } }, []);
    useEffect(() => { void load(); }, [load]);
    return <div><Heading eyebrow="Assistant" title="Skills" description="Inspect and manage the skill catalog without removing its history." /><PageState loading={loading} error={error} retry={() => void load()} />{!loading && !error && <div className="panel assistant-list"><table><thead><tr><th>Skill</th><th>Tier</th><th>Status</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><button className="link-button" onClick={() => void modal.detail(close => <SkillInspect id={row.id} close={() => { close(null); void load(); }} />)}>{row.name}</button><small>{row.description}</small></td><td>{row.tier}</td><td><Badge tone={row.is_active ? 'success' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Badge></td></tr>)}</tbody></table>{rows.length === 0 && <p className="empty">No skills.</p>}</div>}</div>;
}

interface GroupChoice { id: number; name: string }
type MemoryTier = 'global' | 'user' | 'group';
export function MemoriesPage() {
    const { can: systemAllowed, me } = useCan('sys.assistant');
    const [tier, setTier] = useState<MemoryTier>('user');
    const [groups, setGroups] = useState<GroupChoice[]>([]); const [group, setGroup] = useState<number | null>(null);
    const [entries, setEntries] = useState<Record<string, unknown>>({}); const [key, setKey] = useState(''); const [value, setValue] = useState('');
    const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
    const member = useQuery({ queryKey: ['assistant-memory-member', me?.id, group], enabled: systemAllowed && tier === 'group' && group != null && !me?.is_superuser, queryFn: async () => (await mojoCall(`/api/group/${group}/member`)).data as MemberLike });
    const canManage = systemAllowed && (tier !== 'group' || group != null && (Boolean(me?.is_superuser) || memberHasPermission(member.data ?? null, 'assistant')));
    const scopeKey = `${me?.id}:${tier}:${group ?? ''}`;
    const scope = useRef({ key: scopeKey, allowed: canManage, mounted: true }); scope.current.key = scopeKey; scope.current.allowed = canManage;
    const generation = useRef(0); const lock = useRef(false);
    useEffect(() => { scope.current.mounted = true; return () => { scope.current.mounted = false; generation.current++; }; }, []);
    useEffect(() => { if (!systemAllowed) { setGroups([]); return; } let cancelled = false; void mojoList<GroupChoice>('/api/group', { start: 0, size: 50, sort: 'name' }).then(page => { if (!cancelled) setGroups(page.rows.map(row => ({ id: Number(row.id), name: String(row.name) }))); }, () => { if (!cancelled) setGroups([]); }); return () => { cancelled = true; }; }, [systemAllowed]);
    const load = useCallback(async () => {
        const request = ++generation.current; const captured = scopeKey;
        setEntries({}); setError('');
        if (!systemAllowed || tier === 'group' && group == null) { setLoading(false); return; }
        setLoading(true);
        try { const next = await getAssistantMemory(tier, tier === 'group' ? group! : undefined); if (scope.current.mounted && request === generation.current && scope.current.key === captured) setEntries(next); }
        catch (cause) { if (scope.current.mounted && request === generation.current && scope.current.key === captured) setError(cause instanceof Error ? cause.message : 'Memory unavailable'); }
        finally { if (scope.current.mounted && request === generation.current && scope.current.key === captured) setLoading(false); }
    }, [scopeKey, systemAllowed, tier, group]);
    useEffect(() => { void load(); }, [load]);
    const validKey = /^[a-z0-9:_-]{1,64}$/.test(key); const validValue = value.length > 0 && value.length <= 500;
    const mutate = async (operation: () => Promise<void>, captured: string) => {
        if (lock.current || !scope.current.mounted || !scope.current.allowed || scope.current.key !== captured) return;
        lock.current = true; setBusy(true); setError('');
        try { await operation(); if (scope.current.mounted && scope.current.key === captured) await load(); }
        catch (cause) { if (scope.current.mounted && scope.current.key === captured) setError(cause instanceof Error ? cause.message : 'Memory change failed'); }
        finally { lock.current = false; if (scope.current.mounted) setBusy(false); }
    };
    const save = async () => { if (!validKey || !validValue) return; await mutate(() => saveAssistantMemory(tier, key, value, tier === 'group' ? group! : undefined), scopeKey); };
    const remove = async (entryKey: string) => {
        const frozen = { tier, group: tier === 'group' ? group! : undefined, key: scopeKey };
        if (!canManage) return;
        const confirmed = await modal.confirm({ title: 'Remove memory key?', message: `Remove “${entryKey}” from ${frozen.tier} memory${frozen.group == null ? '' : ` for group #${frozen.group} (${groups.find(item => item.id === frozen.group)?.name ?? 'Unknown'})`}? The previous value cannot be restored by this action.`, confirmText: 'Remove key', danger: true });
        if (confirmed) await mutate(() => deleteAssistantMemory(frozen.tier, entryKey, frozen.group), frozen.key);
    };
    return <div><Heading eyebrow="Assistant" title="Memory" description="Manage global, personal, or explicitly selected group memory without ambient group state." />
        <div className="panel panel-pad assistant-memory-controls"><div className="seg">{(['global', 'user', 'group'] as MemoryTier[]).map(item => <button key={item} disabled={busy} className={`seg-btn${tier === item ? ' seg-active' : ''}`} onClick={() => setTier(item)}>{item}</button>)}</div>
        {tier === 'group' && <label className="field"><span className="field-label">Group (bounded first 50)</span><select className="input" value={group ?? ''} disabled={busy} onChange={event => setGroup(event.target.value ? Number(event.target.value) : null)}><option value="">Choose a group</option>{groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {!canManage && <p className="dim">Memory editing requires system Assistant permission and, for a selected group, inherited member Assistant authority or superuser access.</p>}
        <div className="assistant-memory-form"><label className="field"><span className="field-label">Key</span><input className="input" disabled={!canManage || busy} maxLength={64} value={key} onChange={event => setKey(event.target.value)} placeholder="lowercase:key" /></label><label className="field"><span className="field-label">Value</span><textarea className="input" disabled={!canManage || busy} maxLength={500} rows={2} value={value} onChange={event => setValue(event.target.value)} /></label><button className="btn btn-primary" disabled={!canManage || busy || !validKey || !validValue || loading} onClick={() => void save()}>Save</button></div>{error && <div className="form-alert" role="alert">{error}</div>}</div>
        <div className="panel assistant-list">{loading ? <p className="empty">Loading…</p> : Object.entries(entries).length ? <table><thead><tr><th>Key</th><th>Value</th><th /></tr></thead><tbody>{Object.entries(entries).slice(0, 100).map(([entryKey, entryValue]) => <tr key={entryKey}><td><code>{entryKey}</code></td><td>{String(entryValue).slice(0, 500)}</td><td>{canManage && <button className="btn-icon" disabled={busy} aria-label={`Remove ${entryKey}`} onClick={() => void remove(entryKey)}><i className="bi bi-trash" /></button>}</td></tr>)}</tbody></table> : <p className="empty">No {tier} memory.</p>}</div></div>;
}
