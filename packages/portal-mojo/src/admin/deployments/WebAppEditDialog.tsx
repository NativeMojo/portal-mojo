import { useRef, useState } from 'react';
import { useMe } from '../../client/runtime';
import { getWebApp, resolveAppAuthority, saveWebAppProfile } from './api';
import { assertOwner, isInteractive } from './permissions';
import { makeReceipt, receiptsFor, settleReceipt } from './receipts';
import { useDeploymentOwner } from './useDeploymentObservation';
import { DeploymentHelp, ErrorNotice, useCloseOnOwnerChange, useWrite } from './shared';
import type { WebAppObject } from './types';

type Profile = { display_name: string; environment: string; github_repository: string; deployment_ref: string; build_output: string };
const profile = (app: WebAppObject): Profile => ({ display_name: app.display_name, environment: app.environment, github_repository: app.repository, deployment_ref: app.deployment_ref, build_output: app.build_output });

export function WebAppEditDialog({ app, onClose, onChanged, onBusy }: {
    app: WebAppObject;
    onClose: () => void;
    onChanged: () => void;
    onBusy: (busy: boolean) => void;
}) {
    const s = useDeploymentOwner(), me = useMe(), write = useWrite(s.owner, s.signal, onBusy);
    const [base, setBase] = useState(() => profile(app)), [draft, setDraft] = useState(() => profile(app)), [notice, setNotice] = useState('');
    const form = useRef<HTMLFormElement>(null);
    useCloseOnOwnerChange(s.key, onClose);
    const pending = receiptsFor(s.owner).some(receipt => receipt.kind === 'profile' && receipt.app === app.id && receipt.submitted && !receipt.settled);
    const dirty = JSON.stringify(base) !== JSON.stringify(draft);
    const change = (key: keyof Profile, value: string) => { setNotice(''); setDraft(previous => ({ ...previous, [key]: value })); };
    const reload = () => write.run(async () => {
        const current = await getWebApp(s.owner, app.id, s.signal);
        assertOwner(s.owner, s.signal);
        if (current.group.id !== app.group.id) throw new Error('App ownership changed. Reopen the app before editing.');
        setBase(profile(current)); setDraft(profile(current));
        for (const receipt of receiptsFor(s.owner)) if (receipt.kind === 'profile' && receipt.app === app.id && !receipt.settled) settleReceipt(receipt);
        setNotice('Current saved settings loaded. Review them before making another change.'); onChanged();
    });
    const save = () => write.run(async () => {
        if (!form.current?.reportValidity() || !dirty || pending || !isInteractive()) return;
        const current = await getWebApp(s.owner, app.id, s.signal);
        if (current.group.id !== app.group.id) throw new Error('App ownership changed. Reopen the app before editing.');
        const authority = await resolveAppAuthority(s.owner, me.data, current, 'release', s.signal);
        if (!authority.release) throw new Error('App edit authority is unavailable.');
        const fresh = profile(current), patch = { ...draft };
        if (Object.keys(patch).some(key => fresh[key as keyof Profile] !== base[key as keyof Profile])) throw new Error('Saved settings changed. Reload saved settings and review before saving.');
        const receipt = makeReceipt(s.owner, 'profile', `${app.id}:profile`, app.id, 'profile');
        await saveWebAppProfile(s.owner, receipt, current, patch, s.signal);
        const observed = await getWebApp(s.owner, app.id, s.signal); assertOwner(s.owner, s.signal);
        if (observed.group.id !== app.group.id) throw new Error('Saved app ownership changed. Reopen the app.');
        const saved = profile(observed);
        if (Object.entries(patch).some(([key, value]) => saved[key as keyof Profile] !== value)) throw new Error('Saved settings do not match this change. Reload saved settings to review.');
        settleReceipt(receipt); onChanged(); onClose();
    });
    return <form ref={form} className="modal-pad admin-deployments" onSubmit={event => { event.preventDefault(); void save(); }}><h2 className="modal-title">Edit {app.display_name || app.slug}</h2>
        {pending && <p role="status" className="text-warn">A previous save has an unconfirmed outcome. Reload saved settings to review current values. The save will not be repeated.</p>}
        <fieldset disabled={write.busy || pending} className="deployment-fields"><label>Name<input maxLength={120} value={draft.display_name} onChange={event => change('display_name', event.target.value)}/></label><label>Environment<select value={draft.environment} onChange={event => change('environment', event.target.value)}>{!['production', 'staging', 'preview', 'development'].includes(draft.environment) && <option value={draft.environment} disabled>{draft.environment || 'Unknown environment'}</option>}{['production', 'staging', 'preview', 'development'].map(value => <option value={value} key={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label><label>GitHub repository<input maxLength={255} placeholder="owner/repository" value={draft.github_repository} onChange={event => change('github_repository', event.target.value)}/></label><div className="deployment-form"><label>Branch<input required maxLength={255} value={draft.deployment_ref} onChange={event => change('deployment_ref', event.target.value)}/></label><label>Build output <DeploymentHelp label="build output">The directory CI builds, such as dist. Changing this profile does not deploy a release.</DeploymentHelp><input required maxLength={255} value={draft.build_output} onChange={event => change('build_output', event.target.value)}/></label></div></fieldset>
        {write.error && <ErrorNotice>{write.error}</ErrorNotice>}{notice && <p role="status">{notice}</p>}
        <div className="modal-actions"><button type="button" className="btn" disabled={write.busy} onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={write.busy} onClick={() => void reload()}>Reload saved settings</button><button type="submit" className="btn btn-primary" disabled={write.busy || pending || !dirty}>Save changes</button></div>
    </form>;
}
