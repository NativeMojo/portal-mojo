import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBootstrap, getOperation, getOptions, precheckAddress, createApp, chooseOnboarding, cancelOnboarding } from './api';
import { canReadBootstrap, canOnboard, isInteractive } from './permissions';
import { useMe } from '../../client/runtime';
import { useDeploymentObservation, useDeploymentOwner } from './useDeploymentObservation';
import { managedChoice, onboardingGeneration, onboardingPollable, onboardingTerminal } from './onboarding-state';
import { makeReceipt, receiptsFor, saveReceipt, settleReceipt, type ActionReceipt } from './receipts';
import { ErrorNotice, Facts, Status, useWrite } from './shared';
import type { AddressPrecheck, Bootstrap, OnboardingOperation } from './types';
export function WebAppOnboardingDialog({ bootstrap, resume, onClose, onBusy }: {
    bootstrap?: Bootstrap;
    resume?: ActionReceipt;
    onClose: () => void;
    onBusy: (v: boolean) => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), w = useWrite(s.owner, s.signal, onBusy);
    const initial = resume ?? receiptsFor(s.owner).find(r => r.kind === 'create' && !r.settled);
    const [receipt, setReceipt] = useState<ActionReceipt | undefined>(initial), [operation, setOperation] = useState<OnboardingOperation | null>(null), [workspace, setWorkspace] = useState(String(initial?.profile?.group ?? bootstrap?.groups[0]?.id ?? 'new')), [name, setName] = useState(initial?.profile?.display_name ?? ''), [slug, setSlug] = useState(initial?.profile?.slug ?? ''), [address, setAddress] = useState(''), [checked, setChecked] = useState<AddressPrecheck | null>(null), [repository, setRepository] = useState(initial?.profile?.github_repository ?? ''), [ref, setRef] = useState(initial?.profile?.deployment_ref ?? 'main'), [output, setOutput] = useState(initial?.profile?.build_output ?? 'dist'), [githubMode, setGithubMode] = useState<'skip' | 'verify' | 'attest'>('skip'), [environment, setEnvironment] = useState(initial?.profile?.environment ?? 'production');
    const intent = workspace === 'new' ? { group_intent: 'new' as const } : { group: Number(workspace) };
    const eligible = !!bootstrap && (workspace === 'new' ? bootstrap.can_create_webapp_group : bootstrap.groups.some(g => g.id === Number(workspace)));
    const options = useQuery({
        queryKey: ['deployments', s.key, 'onboarding-options', workspace], queryFn: ({ signal }) => getOptions(s.owner, intent, signal), enabled: !receipt && eligible && isInteractive(), retry: false
    });
    const observer = useDeploymentObservation(s.owner, receipt?.operation ?? null, signal => getOperation(s.owner, receipt!.operation, signal), onboardingTerminal, onboardingPollable);
    const latest = observer.value ?? operation;
    const generation = latest ? onboardingGeneration(latest) : '';
    const choiceSent = useRef(new Set<string>());
    useEffect(() => { if (latest && receipt) {
        const next = {
            ...receipt, app: latest.resources.webapp ?? receipt.app, settled: onboardingTerminal(latest)
        };
        saveReceipt(next);
    } }, [generation, latest?.status]);
    const optionsReady = !!options.data?.destination && !!options.data?.apps_domain && !!options.data.buckets.length;
    const verifyAddress = () => w.run(async () => { const result = await precheckAddress(s.owner, intent, address || `${slug}.${options.data?.apps_domain?.name ?? ''}`, s.signal); setChecked(result); });
    const create = () => w.run(async () => { if (!bootstrap || !eligible || !optionsReady || checked?.verdict !== 'ready' || !checked.domain)
        return; if (repository && !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository))
        throw new Error('Use a GitHub OWNER/REPOSITORY identifier'); if (!/^[a-z0-9_./-]{1,255}$/i.test(ref) || ref.includes('..'))
        throw new Error('Use a valid branch or tag'); if (!/^[a-z0-9_./-]{1,255}$/i.test(output) || output.startsWith('/') || output.split('/').some(p => !p || p === '..' || p === '.'))
        throw new Error('Use a relative build output directory'); const fresh = await getBootstrap(s.owner, s.signal); if (!canOnboard(fresh) || (workspace !== 'new' && !fresh.groups.some(g => g.id === Number(workspace))) || (workspace === 'new' && !fresh.can_create_webapp_group))
        throw new Error('Workspace eligibility changed'); const r = makeReceipt(s.owner, 'create', crypto.randomUUID()); const profile = {
        operation_id: r.operation, ...intent, slug, display_name: name, environment, bucket: options.data!.buckets[0]!, github_repository: repository, deployment_ref: ref, build_output: output
    }; const frozen = saveReceipt({
        ...r, profile, address: { domain: checked.domain.id, label: checked.label }
    }); setReceipt(frozen); const result = await createApp(s.owner, frozen, profile, s.signal); setOperation(result); observer.refresh(); });
    const retryCreate = () => w.run(async () => { if (!receipt?.profile)
        return; try {
        const observed = await getOperation(s.owner, receipt.operation, s.signal);
        setOperation(observed);
        observer.refresh();
    }
    catch (error) {
        if (!(error && typeof error === 'object' && 'status' in error && error.status === 404))
            throw new Error('The operation could not be observed. Refresh before retrying create.');
        const result = await createApp(s.owner, receipt, receipt.profile!, s.signal);
        setOperation(result);
        observer.refresh();
    } });
    const choose = () => w.run(async () => { if (!latest || !receipt)
        return; const fresh = await getOperation(s.owner, latest.operation_id, s.signal); setOperation(fresh); if (onboardingGeneration(fresh) !== generation)
        throw new Error('Setup changed. Review the observed cursor and choose again.'); let choice = managedChoice(fresh, receipt.address?.domain ?? checked?.domain?.id ?? options.data?.apps_domain?.id ?? 0, receipt.address?.label ?? checked?.label ?? slug); if (fresh.cursor === 'github' && githubMode !== 'skip') {
        if (!repository.trim())
            throw new Error('Enter an OWNER/REPOSITORY before requesting verification');
        choice = {
            repository: repository.trim(), ref, output, ...(githubMode === 'attest' ? { attest_unavailable: true } : {})
        };
    } if (!choice)
        throw new Error('This cursor needs a managed address choice. Recheck the address or use Domains & Serving setup.'); if (choiceSent.current.has(generation))
        throw new Error('That observed choice was already submitted. Refresh the server operation.'); choiceSent.current.add(generation); const action = makeReceipt(s.owner, 'create', `${generation}:choice`); try {
        setOperation(await chooseOnboarding(s.owner, action, fresh, choice, s.signal));
        settleReceipt(action);
    }
    finally {
        observer.refresh();
    } });
    const cancel = () => w.run(async () => { if (!latest || !receipt)
        return; const r = makeReceipt(s.owner, 'create', `${latest.operation_id}:cancel`); const result = await cancelOnboarding(s.owner, r, latest.operation_id, s.signal); settleReceipt(r); setOperation(result); observer.refresh(); });
    if (!isInteractive() || (!receipt && !canReadBootstrap(me.data)))
        return <div className="modal-pad"><p>Interactive setup authority unavailable.</p><button className="btn" onClick={onClose}>Close</button></div>;
    return <div className="modal-pad admin-deployments"><h2 className="modal-title">{receipt ? 'Resume WebApp setup' : 'New WebApp'}</h2><p className="modal-message">Closing keeps server setup work. Resume uses its exact operation receipt; it never creates a replacement app.</p>{!receipt ? <><div className="deployment-form"><label>Workspace<select value={workspace} disabled={w.busy} onChange={e => { setWorkspace(e.target.value); setChecked(null); }}>{bootstrap?.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}{bootstrap?.can_create_webapp_group && <option value="new">New workspace</option>}</select></label><label>Name<input value={name} maxLength={120} disabled={w.busy} onChange={e => setName(e.target.value)}/></label><label>App label<input value={slug} maxLength={64} disabled={w.busy} onChange={e => { setSlug(e.target.value); setChecked(null); }} placeholder="my-app"/></label><label>Public address<input value={address} disabled={w.busy} onChange={e => { setAddress(e.target.value); setChecked(null); }} placeholder={options.data?.apps_domain ? `${slug || 'my-app'}.${options.data.apps_domain.name}` : 'No managed apps domain'}/></label></div>{options.isPending ? <p>Resolving available destination and bucket…</p> : options.isError ? <ErrorNotice>Setup options unavailable.</ErrorNotice> : !optionsReady ? <ErrorNotice>{options.data?.destination_error || options.data?.apps_domain_error || 'No allowed release bucket. Complete installation setup before creating an app.'}</ErrorNotice> : <p className="dim">Production · bucket {options.data.buckets[0]} · managed domain {options.data.apps_domain?.name}. Custom domains and purchases use Domains & Serving.</p>}<details><summary>Repository and build options</summary><div className="deployment-form"><label>GitHub OWNER/REPOSITORY (optional)<input value={repository} disabled={w.busy} onChange={e => setRepository(e.target.value)}/></label><label>Branch<input value={ref} disabled={w.busy} onChange={e => setRef(e.target.value)}/></label><label>Build output<input value={output} disabled={w.busy} onChange={e => setOutput(e.target.value)}/></label><label>Environment<select value={environment} disabled={w.busy} onChange={e => setEnvironment(e.target.value)}>{(options.data?.environments ?? ['production']).map(e => <option key={e}>{e}</option>)}</select></label></div></details><button className="btn" disabled={w.busy || !optionsReady || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)} onClick={() => void verifyAddress()}>Check public address</button>{checked && <p role="status">{checked.verdict}: {checked.hostname} {checked.reason}</p>}</> : <><Facts rows={[['Operation', receipt.operation], ['Status', <Status value={latest?.status ?? 'unknown'}/>], ['Current server cursor', latest?.cursor], ['Revision', latest?.revision], ['Observation', observer.state], ['Last observed', observer.observedAt ? new Date(observer.observedAt).toLocaleTimeString() : 'Not observed'], ['Message', latest?.last_error]]}/>{latest?.evidence.github.status && <p>GitHub: {latest.evidence.github.status} · {latest.evidence.github.reason}. Unavailable verification is not repository attestation.</p>}{latest?.status === 'waiting' && !latest.next_attempt_at && <p>Setup is parked waiting for the choice below; automatic reads have stopped.</p>}{!latest && <p>Delivery may be uncertain. Read the saved operation before explicitly retrying its identical create receipt.</p>}{latest?.cursor === 'github' && <label>GitHub verification<select value={githubMode} disabled={w.busy} onChange={e => setGithubMode(e.target.value as 'skip' | 'verify' | 'attest')}><option value="skip">Skip optional repository verification</option><option value="verify">Verify the submitted repository</option>{latest.evidence.github.status === 'unavailable' && <option value="attest">I attest this repository when verification is unavailable</option>}</select>{githubMode !== 'skip' && <input aria-label="Repository to verify" value={repository} disabled={w.busy} onChange={e => setRepository(e.target.value)}/>}</label>}{latest?.activity.map((a, i) => <p key={i}>{a.message}</p>)}</>}{w.error && <ErrorNotice>{w.error}</ErrorNotice>}<div className="modal-actions"><button className="btn" disabled={w.busy} onClick={onClose}>Close</button>{receipt ? <><button className="btn" disabled={w.busy} onClick={observer.refresh}>Refresh / Resume observation</button>{!latest && receipt.profile && <button className="btn" disabled={w.busy} onClick={() => void retryCreate()}>Reconcile / retry same create</button>}{latest && !onboardingTerminal(latest) && <><button className="btn" disabled={w.busy} onClick={() => void cancel()}>Cancel server setup</button><button className="btn btn-primary" disabled={w.busy || choiceSent.current.has(generation) || !['app', 'address', 'github', 'verify'].includes(latest.cursor)} onClick={() => void choose()}>{latest.cursor === 'github' ? (githubMode === 'skip' ? 'Skip GitHub verification' : githubMode === 'attest' ? 'Attest unavailable verification' : 'Verify repository') : `Continue ${latest.cursor}`}</button></>}</> : <button className="btn btn-primary" disabled={w.busy || !optionsReady || !name.trim() || checked?.verdict !== 'ready'} onClick={() => void create()}>Create WebApp</button>}</div></div>;
}
