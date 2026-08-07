import { useEffect, useState } from 'react';
import { useCan } from '../../client/runtime';
import { CollectionSelect } from '../../ui';
import type { MetricAccount, MetricsDiscoveryPage } from './metrics-explorer-data';

const GROUP_DIRECTORY_PERMISSIONS = ['sys.view_groups', 'sys.manage_groups', 'sys.groups'];
const USER_DIRECTORY_PERMISSIONS = ['sys.view_users', 'sys.manage_users', 'sys.users'];

interface DirectoryGroup { id: number; name: string }
interface DirectoryUser { id: number; display_name?: string; username?: string }

export interface MetricsSourcePickerProps {
    account: string;
    parsedAccount: MetricAccount | null;
    accountError: string | null;
    accountsPage?: MetricsDiscoveryPage;
    accountsPending: boolean;
    accountsError: string | null;
    accountSearch: string;
    onAccountSearch: (value: string) => void;
    onAccountPage: (start: number) => void;
    onRetryAccounts: () => void;
    onChange: (account: string) => void;
}

export function MetricsSourcePicker({
    account, parsedAccount, accountError, accountsPage, accountsPending, accountsError,
    accountSearch, onAccountSearch, onAccountPage, onRetryAccounts, onChange,
}: MetricsSourcePickerProps) {
    const [draft, setDraft] = useState(account);
    const groupDirectory = useCan(GROUP_DIRECTORY_PERMISSIONS).can;
    const userDirectory = useCan(USER_DIRECTORY_PERMISSIONS).can;

    useEffect(() => setDraft(account), [account]);

    const apply = () => onChange(draft);

    return (
        <section className="panel panel-pad metrics-source-card" aria-labelledby="metrics-source-heading">
            <div className="metrics-section-head">
                <div>
                    <div className="eyebrow">Source</div>
                    <h2 id="metrics-source-heading">Metric account</h2>
                    <p>Use a full public, global, group, user, or configured custom account. The backend authorizes every request.</p>
                </div>
                {parsedAccount && <code className="metrics-account-chip">{parsedAccount.value}</code>}
            </div>

            <div className="metrics-source-grid">
                <div className="metrics-source-manual">
                    <label className="field">
                        <span className="field-label">Exact account</span>
                        <div className="metrics-inline-control">
                            <input
                                id="metrics-account-input"
                                className={`input${accountError ? ' input-error' : ''}`}
                                value={draft}
                                maxLength={256}
                                spellCheck={false}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Enter') apply(); }}
                                placeholder="global or group-42"
                            />
                            <button type="button" className="btn btn-primary" onClick={apply}>Use account</button>
                        </div>
                        {accountError && <span className="field-error">{accountError}</span>}
                        {!accountError && <span className="field-help">Exact entry remains available for older unindexed accounts.</span>}
                    </label>
                </div>

                <div className="metrics-source-browse">
                    <label className="field">
                        <span className="field-label">Authorized accounts</span>
                        <input
                            className="input"
                            value={accountSearch}
                            maxLength={128}
                            onChange={(event) => onAccountSearch(event.target.value)}
                            placeholder="Search account registry…"
                        />
                    </label>
                    {accountsPending && <div className="metrics-compact-state">Loading accounts…</div>}
                    {accountsError && (
                        <div className="metrics-compact-state metrics-compact-error">
                            <span>{accountsError}</span>
                            <button type="button" className="btn btn-compact" onClick={onRetryAccounts}>Retry</button>
                        </div>
                    )}
                    {accountsPage && !accountsError && (
                        <>
                            <select
                                className="input"
                                value={accountsPage.data.includes(account) ? account : ''}
                                onChange={(event) => { if (event.target.value) onChange(event.target.value); }}
                                aria-label="Authorized metric account"
                            >
                                <option value="">Choose an authorized account…</option>
                                {accountsPage.data.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                            <div className="metrics-pager">
                                <span>{accountsPage.count === 0 ? 'No accounts' : `${accountsPage.start + 1}–${accountsPage.start + accountsPage.pageCount} of ${accountsPage.count}`}</span>
                                <button type="button" className="btn btn-compact" disabled={accountsPage.start === 0} onClick={() => onAccountPage(Math.max(0, accountsPage.start - accountsPage.size))}>Previous</button>
                                <button type="button" className="btn btn-compact" disabled={accountsPage.nextStart == null} onClick={() => onAccountPage(accountsPage.nextStart ?? accountsPage.start)}>Next</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {(groupDirectory || userDirectory) && (
                <div className="metrics-directory-grid">
                    {groupDirectory && (
                        <CollectionSelect<DirectoryGroup>
                            endpoint="/api/group"
                            value={parsedAccount?.kind === 'group' ? parsedAccount.id : null}
                            onChange={(id) => { if (id != null) onChange(`group-${id}`); }}
                            label="Group directory convenience"
                            labelField="name"
                            placeholder="Search groups…"
                        />
                    )}
                    {userDirectory && (
                        <CollectionSelect<DirectoryUser>
                            endpoint="/api/user"
                            value={parsedAccount?.kind === 'user' ? parsedAccount.id : null}
                            onChange={(id) => { if (id != null) onChange(`user-${id}`); }}
                            label="User directory convenience"
                            labelField="display_name"
                            placeholder="Search users…"
                        />
                    )}
                </div>
            )}
        </section>
    );
}
