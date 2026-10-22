import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from '../../ui/Tabs';
import { modal } from '../../ui/modal';
import { Link } from 'react-router-dom';
import { getBootstrap, getOperation, getOptions, precheckAddress, createApp, chooseOnboarding, cancelOnboarding } from './api';
import { canReadBootstrap, canReadWebApps, canOnboard, isInteractive } from './permissions';
import { useMe } from '../../client/runtime';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { managedChoice, onboardingGeneration, onboardingPollable, onboardingTerminal } from './onboarding-state';
import { makeReceipt, receiptsFor, saveReceipt, settleReceipt, type ActionReceipt } from './receipts';
import { ErrorNotice, Facts, Status, useWrite } from './shared';
import type { AddressPrecheck, Bootstrap, DeploymentsDestinations, OnboardingOperation } from './types';

export function WebAppOnboardingDialog({ bootstrap, resume, destinations, onClose, onBusy, onChanged }: {
    bootstrap?: Bootstrap;
    resume?: ActionReceipt;
    destinations?: DeploymentsDestinations;
    onClose: () => void;
    onBusy: (v: boolean) => void;
    onChanged?: () => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal, onBusy);
    const initial = resume ?? receiptsFor(s.owner).find(r => r.kind === 'create' && !r.settled);
    const [receipt, setReceipt] = useState<ActionReceipt | undefined>(initial);
    const [operation, setOperation] = useState<OnboardingOperation | null>(null);
    const [workspace, setWorkspace] = useState(String(initial?.profile?.group ?? bootstrap?.groups[0]?.id ?? 'new'));
    const [name, setName] = useState(initial?.profile?.display_name ?? ''), [slug, setSlug] = useState(initial?.profile?.slug ?? '');
    const [address, setAddress] = useState(''), [checked, setChecked] = useState<AddressPrecheck | null>(null);
    const [repository, setRepository] = useState(initial?.profile?.github_repository ?? '');
    const [ref, setRef] = useState(initial?.profile?.deployment_ref ?? 'main'), [output, setOutput] = useState(initial?.profile?.build_output ?? 'dist');
    const [githubMode, setGithubMode] = useState<'skip' | 'verify' | 'attest'>('skip');
    const [environment, setEnvironment] = useState(initial?.profile?.environment ?? 'production');
    const intent = workspace === 'new' ? { group_intent: 'new' as const } : { group: Number(workspace) };
    const eligible = !!bootstrap && (workspace === 'new' ? bootstrap.can_create_webapp_group : bootstrap.groups.some(g => g.id === Number(workspace)));
    const observer = useDeploymentObservation(s.owner, receipt?.operation ?? null,
        signal => getOperation(s.owner, receipt!.operation, signal), onboardingTerminal, onboardingPollable);
    const latest = observer.value ?? operation;
    const generation = latest ? onboardingGeneration(latest) : '';
    const choiceSent = useRef(new Set<string>());
    // The created operation, not a bootstrap guess or local group intent, owns continuation scope.
    const resolvedIntent = latest?.group.id ? { group: latest.group.id } : intent;
    const options = useQuery({
        queryKey: ['deployments', s.key, 'onboarding-options', latest?.group.id ?? workspace],
        queryFn: ({ signal }) => getOptions(s.owner, resolvedIntent, signal),
        enabled: isInteractive() && (receipt ? !!latest?.group.id : eligible), retry: false,
    });
    const acceptOperation = (value: OnboardingOperation, current: ActionReceipt) => {
        if (current.onboardingGroup && current.onboardingGroup !== value.group.id)
            throw new Error('The operation workspace identity changed. Observe the saved operation again.');
        const next = saveReceipt({ ...current, onboardingGroup: value.group.id,
            app: value.resources.webapp ?? current.app, settled: onboardingTerminal(value) });
        setReceipt(next); setOperation(value);
    };
    useEffect(() => {
        if (latest && receipt && (!receipt.onboardingGroup || receipt.app !== latest.resources.webapp || receipt.settled !== onboardingTerminal(latest)))
            acceptOperation(latest, receipt);
    }, [generation, latest?.status]);
    const changed = useRef('');
    useEffect(() => {
        if (!latest?.resources.webapp) return;
        const next = `${latest.resources.webapp}:${onboardingTerminal(latest) ? latest.status : 'created'}`;
        if (changed.current !== next) { changed.current = next; onChanged?.(); }
    }, [latest?.resources.webapp, latest?.status, onChanged]);
    const setupReady = !!options.data?.destination && !!options.data.buckets.length;
    const newIntent = !receipt && workspace === 'new';
    const addressReady = checked?.verdict === 'ready' && !!checked.domain;
    const savedAddress = receipt?.address;
    const addressChoiceReady = addressReady || !!savedAddress;
    const validSlug = /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
    const domainsPath = destinations?.domains;
    const domainLink = domainsPath && /^\/[a-z0-9/_-]+$/i.test(domainsPath) && canReadWebApps(me.data)
        ? <Link className="btn" to={domainsPath} onClick={onClose}>Open Domains to configure this workspace</Link> : null;
    const verifyAddress = () => w.run(async () => {
        const value = await precheckAddress(s.owner, resolvedIntent,
            address || `${slug}.${options.data?.apps_domain?.name ?? ''}`, s.signal);
        setChecked(value);
        if (receipt && value.verdict === 'ready' && value.domain) {
            const next = saveReceipt({ ...receipt, address: { domain: value.domain.id, label: value.label } });
            setReceipt(next);
        }
    });
    const create = () => w.run(async () => {
        if (!bootstrap || !eligible || !setupReady || !validSlug || (!newIntent && !addressReady)) return;
        if (repository && !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)) throw new Error('Use a GitHub OWNER/REPOSITORY identifier');
        if (!/^[a-z0-9_./-]{1,255}$/i.test(ref) || ref.includes('..')) throw new Error('Use a valid branch or tag');
        if (!/^[a-z0-9_./-]{1,255}$/i.test(output) || output.startsWith('/') || output.split('/').some(p => !p || p === '..' || p === '.'))
            throw new Error('Use a relative build output directory');
        const fresh = await getBootstrap(s.owner, s.signal);
        if (!canOnboard(fresh) || (workspace !== 'new' && !fresh.groups.some(g => g.id === Number(workspace))) ||
            (workspace === 'new' && !fresh.can_create_webapp_group)) throw new Error('Workspace eligibility changed');
        const action = makeReceipt(s.owner, 'create', crypto.randomUUID());
        const profile = { operation_id: action.operation, ...intent, slug, display_name: name, environment,
            bucket: options.data!.buckets[0]!, github_repository: repository, deployment_ref: ref, build_output: output };
        const frozen = saveReceipt({ ...action, profile,
            ...(!newIntent && checked?.domain ? { address: { domain: checked.domain.id, label: checked.label } } : {}) });
        setReceipt(frozen);
        acceptOperation(await createApp(s.owner, frozen, profile, s.signal), frozen);
        observer.refresh();
    });
    const retryCreate = () => w.run(async () => {
        if (!receipt?.profile) return;
        try { acceptOperation(await getOperation(s.owner, receipt.operation, s.signal), receipt); observer.refresh(); }
        catch (error) {
            if (!(error && typeof error === 'object' && 'status' in error && error.status === 404))
                throw new Error('The operation could not be observed. Refresh before retrying create.');
            acceptOperation(await createApp(s.owner, receipt, receipt.profile, s.signal), receipt); observer.refresh();
        }
    });
    const choose = () => w.run(async () => {
        if (!latest || !receipt) return;
        const fresh = await getOperation(s.owner, latest.operation_id, s.signal);
        acceptOperation(fresh, receipt);
        if (onboardingGeneration(fresh) !== generation) throw new Error('Setup changed. Review the observed cursor and choose again.');
        const selected = addressReady && checked?.domain ? { domain: checked.domain.id, label: checked.label } : receipt.address;
        let choice = managedChoice(fresh, selected?.domain ?? 0, selected?.label ?? slug);
        if (fresh.cursor === 'github' && githubMode !== 'skip') {
            if (!repository.trim()) throw new Error('Enter an OWNER/REPOSITORY before requesting verification');
            choice = { repository: repository.trim(), ref, output, ...(githubMode === 'attest' ? { attest_unavailable: true } : {}) };
        }
        if (!choice) throw new Error('Configure a domain for the operation workspace, refresh options, then check the public address.');
        if (choiceSent.current.has(generation)) throw new Error('That observed choice was already submitted. Refresh the server operation.');
        choiceSent.current.add(generation);
        const action = makeReceipt(s.owner, 'create', `${generation}:choice`);
        try { acceptOperation(await chooseOnboarding(s.owner, action, fresh, choice, s.signal), receipt); settleReceipt(action); }
        finally { observer.refresh(); }
    });
    const cancel = () => w.run(async () => {
        if (!latest || !receipt) return;
        const confirmed = await modal.open<boolean>(close => <div className="modal-pad"><h2 className="modal-title">Cancel server setup?</h2><p className="modal-message">Stop setup for {latest.profile.display_name || latest.profile.slug}. Resources already created may remain.</p><div className="modal-actions"><button className="btn" onClick={() => close(false)}>Keep setup</button><button className="btn btn-danger" onClick={() => close(true)}>Cancel setup</button></div></div>, { signal: s.signal, size: 'md' });
        if (!confirmed) return;
        const action = makeReceipt(s.owner, 'create', `${latest.operation_id}:cancel`);
        acceptOperation(await cancelOnboarding(s.owner, action, latest.operation_id, s.signal), receipt);
        settleReceipt(action); observer.refresh();
    });
    if (!isInteractive() || (!receipt && !canReadBootstrap(me.data)))
        return <div className="modal-pad"><p>Interactive setup authority unavailable.</p><button className="btn" onClick={onClose}>Close</button></div>;
    const addressFields = <><label>Public address<input value={address} disabled={w.busy} onChange={e => { setAddress(e.target.value); setChecked(null); }}
        placeholder={options.data?.apps_domain ? `${slug || 'my-app'}.${options.data.apps_domain.name}` : 'An address under this workspace’s configured domain'} /></label>
        <button className="btn" disabled={w.busy || !setupReady || (!address && !options.data?.apps_domain) || !validSlug} onClick={() => void verifyAddress()}>Check public address</button>
        {checked && <p role="status">{checked.verdict}: {checked.hostname} {checked.reason}</p>}</>;
    const setupDetails = () => { void modal.open(close => <div className="modal-pad admin-deployments"><h2 className="modal-title">{receipt ? 'Setup details' : 'Deployment destination'}</h2>{receipt ? <><Facts rows={[
        ['Operation', receipt.operation], ['Workspace', latest ? `${latest.group.name} (#${latest.group.id})` : 'Not observed'], ['Revision', latest?.revision], ['Server step', latest?.cursor], ['Observation', observer.state], ['Last observed', observer.observedAt ? new Date(observer.observedAt).toLocaleTimeString() : 'Not observed'],
    ]}/>{latest?.activity.length ? <><h3>Activity</h3>{latest.activity.map((a, i) => <p key={i}>{a.message}</p>)}</> : <p>No activity observed.</p>}</> : <Facts rows={[
        ['Environment', environment], ['Release bucket', options.data?.buckets[0]], ['Managed domain', options.data?.apps_domain?.name],
    ]}/>}<div className="modal-actions"><button className="btn" onClick={() => close(null)}>Close</button></div></div>, { signal: s.signal, size: 'md' }); };
    const steps = [{ key: 'app', label: 'App' }, { key: 'address', label: 'Address' }, { key: 'github', label: 'Repository' }, { key: 'verify', label: 'HTTPS' }];
    const currentStep = steps.findIndex(step => step.key === latest?.cursor);
    return <div className="modal-pad admin-deployments">
        <h2 className="modal-title">{receipt ? latest?.profile.display_name || 'WebApp setup' : 'New WebApp'}</h2>
        <p className="modal-message">You can close and resume setup at any time.</p>
        {!receipt ? <>
            <Tabs ariaLabel="New WebApp" items={[
                { key: 'app', label: 'App', panel: <><div className="deployment-form">
                    <label>Workspace<select value={workspace} disabled={w.busy} onChange={e => { setWorkspace(e.target.value); setChecked(null); }}>
                        {bootstrap?.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}{bootstrap?.can_create_webapp_group && <option value="new">New workspace</option>}
                    </select></label>
                    <label>Name<input value={name} maxLength={120} disabled={w.busy} onChange={e => setName(e.target.value)} /></label>
                    <label>App label<input value={slug} maxLength={64} disabled={w.busy} onChange={e => { setSlug(e.target.value); setChecked(null); }} placeholder="my-app" /></label>
                    {!newIntent && addressFields}
                </div>{newIntent && <p className="dim">Create the app first, then connect a domain to its new workspace and resume address setup.</p>}</> },
                { key: 'build', label: 'Build options', panel: <div className="deployment-form">
                    <label>GitHub OWNER/REPOSITORY (optional)<input value={repository} disabled={w.busy} onChange={e => setRepository(e.target.value)} /></label>
                    <label>Branch<input value={ref} disabled={w.busy} onChange={e => setRef(e.target.value)} /></label>
                    <label>Build output<input value={output} disabled={w.busy} onChange={e => setOutput(e.target.value)} /></label>
                    <label>Environment<select value={environment} disabled={w.busy} onChange={e => setEnvironment(e.target.value)}>{(options.data?.environments ?? ['production']).map(e => <option key={e}>{e}</option>)}</select></label>
                </div> },
            ]}/>
            {options.isPending ? <p>Resolving deployment destination…</p> : options.isError ? <ErrorNotice>Setup options unavailable.</ErrorNotice> :
                !setupReady ? <ErrorNotice>{options.data?.destination_error || 'No allowed release bucket. Complete installation setup before creating an app.'}</ErrorNotice> :
                    <button className="btn" onClick={setupDetails}><i className="bi bi-info-circle" aria-hidden="true"/> Deployment destination</button>}
        </> : <>
            <ol className="deployment-setup-progress" aria-label="Setup progress">{steps.map((step, index) => <li key={step.key} aria-current={index === currentStep && !!latest && !onboardingTerminal(latest) ? 'step' : undefined} className={latest?.status === 'succeeded' || index < currentStep ? 'is-complete' : index === currentStep ? 'is-current' : ''}>{step.label}</li>)}</ol>
            <div className="deployment-toolbar"><h3>{latest && onboardingTerminal(latest) ? latest.status === 'succeeded' ? 'Setup complete' : 'Setup stopped' : steps[currentStep]?.label || 'Observe saved setup'}</h3><Status value={latest?.status ?? 'unknown'}/></div>
            {latest?.last_error && <ErrorNotice>{latest.last_error}</ErrorNotice>}
            {(observer.state === 'error' || observer.state === 'stopped' && (!latest || onboardingPollable(latest))) && <p role="status" className="text-warn">Observation unavailable or stopped; outcome is unconfirmed. Refresh to check server setup.</p>}
            {latest?.cursor === 'address' && !onboardingTerminal(latest) && <section className="deployment-stack">
                <p>Choose a public address for {latest.group.name}.</p>
                {!options.data?.apps_domain && <p role="status">{options.data?.apps_domain_error || 'No managed apps domain was observed.'} Configure or connect a domain for {latest.group.name}, then refresh and check the public address.</p>}
                {domainLink}
                <div><button className="btn" disabled={w.busy || options.isFetching} onClick={() => void options.refetch()}>Refresh workspace address options</button></div>
                {addressFields}
            </section>}
            {latest?.cursor === 'github' && !onboardingTerminal(latest) && <section className="deployment-stack">
                {latest.evidence.github.status && <p role="status">Repository verification: {latest.evidence.github.status}{latest.evidence.github.reason && ` · ${latest.evidence.github.reason}`}</p>}
                <label>GitHub verification<select value={githubMode} disabled={w.busy} onChange={e => setGithubMode(e.target.value as 'skip' | 'verify' | 'attest')}>
                    <option value="skip">Skip optional repository verification</option><option value="verify">Verify the submitted repository</option>
                    {latest.evidence.github.status === 'unavailable' && <option value="attest">I attest this repository when verification is unavailable</option>}
                </select>{githubMode !== 'skip' && <input aria-label="Repository to verify" value={repository} disabled={w.busy} onChange={e => setRepository(e.target.value)} />}</label>
                {latest.evidence.github.status === 'unavailable' && <p className="dim">Unavailable verification does not attest repository ownership.</p>}
            </section>}
            {latest?.cursor === 'app' && !onboardingTerminal(latest) && <p>Continue to create the app in {latest.group.name}.</p>}
            {latest?.cursor === 'verify' && !onboardingTerminal(latest) && <p>Continue to check HTTPS for the configured public address.</p>}
            {latest?.status === 'waiting' && !latest.next_attempt_at && <p className="dim">Waiting for your choice. Automatic observation has paused.</p>}
            {!latest && <p>Delivery may be uncertain. Read the saved operation before explicitly retrying its identical create receipt.</p>}
            {latest && currentStep < 0 && !onboardingTerminal(latest) && <p className="text-warn">This setup step is not supported here. Refresh or inspect Setup details before continuing.</p>}
            <button className="btn" onClick={setupDetails}><i className="bi bi-info-circle" aria-hidden="true"/> Setup details</button>
        </>}
        {w.error && <ErrorNotice>{w.error}</ErrorNotice>}
        <div className="modal-actions"><button className="btn" disabled={w.busy} onClick={onClose}>Close</button>
            {receipt ? <><button className="btn" disabled={w.busy} onClick={observer.refresh}>Refresh / Resume observation</button>
                {!latest && receipt.profile && <button className="btn" disabled={w.busy} onClick={() => void retryCreate()}>Reconcile / retry same create</button>}
                {latest && !onboardingTerminal(latest) && <><button className="btn" disabled={w.busy} onClick={() => void cancel()}>Cancel server setup</button>
                    <button className="btn btn-primary" disabled={w.busy || choiceSent.current.has(generation) || !['app', 'address', 'github', 'verify'].includes(latest.cursor) || (latest.cursor === 'address' && !addressChoiceReady)} onClick={() => void choose()}>
                        {latest.cursor === 'github' ? (githubMode === 'skip' ? 'Skip GitHub verification' : githubMode === 'attest' ? 'Attest unavailable verification' : 'Verify repository') : `Continue ${latest.cursor}`}
                    </button></>}
            </> : <button className="btn btn-primary" disabled={w.busy || !setupReady || !name.trim() || !validSlug || (!newIntent && !addressReady)} onClick={() => void create()}>Create WebApp</button>}
        </div>
    </div>;
}
