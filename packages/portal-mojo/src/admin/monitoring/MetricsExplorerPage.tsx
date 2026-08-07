import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { KPITile, MetricsChart } from '../../charts';
import { useAuthSnapshot, useMe } from '../../client/runtime';
import { modal } from '../../ui';
import {
    dedupeMetricSlugs,
    metricsDiscoveryKey,
    parseMetricAccount,
    replaceMetricSlugParams,
    type MetricGaugeValue,
    type MetricAccount,
    type MetricPoint,
} from './metrics-explorer-data';
import {
    discoverMetrics,
    fetchMetricPoints,
    loadExactMetricSeries,
    readMetricValue,
} from './metrics-explorer-client';
import { MetricsSourcePicker } from './MetricsSourcePicker';

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

const warnedFanoutModes = new Set<string>();
function normalizeFanoutMode(value: string | null): 'off' | 'sum' | 'breakdown' {
    if (value == null || value === 'off') return 'off';
    if (value === 'sum' || value === 'breakdown') return value;
    if (!warnedFanoutModes.has(value)) {
        warnedFanoutModes.add(value);
        console.warn(`MetricsExplorerPage: unknown fan-out mode "${value}" — falling back to off`);
    }
    return 'off';
}

function ScalarMetricDetail({ result, scale, onClose }: { result: MetricGaugeValue; scale: number; onClose: () => void }) {
    const scaled = typeof result.value === 'number' && Number.isFinite(result.value)
        ? result.value * scale
        : null;
    return (
        <div className="monitoring-inspector metrics-scalar-detail">
            <header className="monitoring-inspector-head">
                <div>
                    <div className="eyebrow">Exact scalar</div>
                    <h2>{result.slug}</h2>
                    <p><code>{result.account}</code></p>
                </div>
                <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}><i className="bi bi-x-lg" /></button>
            </header>
            <div className="monitoring-facts">
                <div className="monitoring-fact"><span>Raw value</span><strong>{typeof result.value === 'string' ? result.value : JSON.stringify(result.value)}</strong></div>
                <div className="monitoring-fact"><span>Display scale</span><strong>{scale.toLocaleString()}</strong></div>
                <div className="monitoring-fact"><span>Presented value</span><strong>{scaled == null ? 'Not numeric' : scaled.toLocaleString()}</strong></div>
            </div>
            <div className="monitoring-inspector-block">
                <p className="dim">Scale is presentation-only. This read does not record, set, classify, or discover scalar values.</p>
            </div>
        </div>
    );
}

export function MetricsExplorerPage() {
    const [params, setParams] = useSearchParams();
    const auth = useAuthSnapshot();
    const { data: me } = useMe();
    const queryClient = useQueryClient();
    // The token uid is synchronous and changes before the async `me` query.
    // Hold every protected read until both identities agree, so neither boot
    // nor a direct login switch can cache data under a shared placeholder.
    const callerId = auth.uid ?? 'anonymous';
    const identityReady = auth.authenticated && auth.uid != null
        && me != null && String(me.id) === auth.uid;
    const account = params.get('account') ?? 'global';
    const category = params.get('category') ?? '';
    let parsedAccount: MetricAccount | null = null;
    let accountError: string | null = null;
    try { parsedAccount = parseMetricAccount(account); } catch (error) { accountError = errorMessage(error, 'Invalid metric account.'); }
    let selectedSlugs: string[] = [];
    let slugUrlError: string | null = null;
    try { selectedSlugs = dedupeMetricSlugs(params.getAll('slug')); } catch (error) { slugUrlError = errorMessage(error, 'Invalid metric slug selection.'); }

    const [accountSearch, setAccountSearch] = useState('');
    const [accountStart, setAccountStart] = useState(0);
    const [categorySearch, setCategorySearch] = useState('');
    const [categoryStart, setCategoryStart] = useState(0);
    const [slugSearch, setSlugSearch] = useState('');
    const [slugStart, setSlugStart] = useState(0);
    const [pointWhen, setPointWhen] = useState(() => Math.floor(Date.now() / 1000));
    const [scalarSlug, setScalarSlug] = useState('');
    const [scalarScale, setScalarScale] = useState('1');
    const [scalarPending, setScalarPending] = useState(false);
    const [scalarError, setScalarError] = useState<string | null>(null);

    const accountRequest = { resource: 'accounts' as const, search: accountSearch, start: accountStart, size: 50 };
    const accountQuery = useQuery({
        queryKey: metricsDiscoveryKey(callerId, accountRequest),
        queryFn: () => discoverMetrics(accountRequest),
        enabled: identityReady,
    });

    const categoryRequest = { resource: 'categories' as const, account, search: categorySearch, start: categoryStart, size: 50 };
    const categoryQuery = useQuery({
        queryKey: metricsDiscoveryKey(callerId, categoryRequest),
        queryFn: () => discoverMetrics(categoryRequest),
        enabled: identityReady && parsedAccount != null,
    });

    const slugRequest = { resource: 'slugs' as const, account, category, search: slugSearch, start: slugStart, size: 50 };
    const slugQuery = useQuery({
        queryKey: metricsDiscoveryKey(callerId, slugRequest),
        queryFn: () => discoverMetrics(slugRequest),
        enabled: identityReady && parsedAccount != null && category !== '',
    });

    const commitParams = useCallback((next: URLSearchParams) => setParams(next, { replace: true }), [setParams]);
    const changeAccount = (nextAccount: string) => {
        let exact: string;
        try { exact = parseMetricAccount(nextAccount).value; } catch {
            const next = new URLSearchParams(params);
            next.set('account', nextAccount.trim());
            next.delete('category');
            next.delete('slug');
            next.delete('fanout');
            next.delete('child_kind');
            setCategoryStart(0);
            setSlugStart(0);
            commitParams(next);
            return;
        }
        const next = new URLSearchParams(params);
        next.set('account', exact);
        next.delete('category');
        next.delete('slug');
        next.delete('fanout');
        next.delete('child_kind');
        setCategoryStart(0);
        setSlugStart(0);
        commitParams(next);
    };
    const changeCategory = (nextCategory: string) => {
        const next = new URLSearchParams(params);
        if (nextCategory) next.set('category', nextCategory); else next.delete('category');
        next.delete('slug');
        setSlugStart(0);
        commitParams(next);
    };
    const setSlugs = (slugs: string[]) => commitParams(replaceMetricSlugParams(params, slugs));
    const toggleSlug = (slug: string) => setSlugs(selectedSlugs.includes(slug)
        ? selectedSlugs.filter((selected) => selected !== slug)
        : [...selectedSlugs, slug]);

    const fanout = parsedAccount?.kind === 'group' ? normalizeFanoutMode(params.get('fanout')) : 'off';
    const childKind = params.get('child_kind') ?? '';
    const setFanout = (mode: string) => {
        const next = new URLSearchParams(params);
        if (mode === 'off') next.delete('fanout'); else next.set('fanout', mode);
        if (mode === 'breakdown' && selectedSlugs.length > 1) {
            next.delete('slug');
            next.append('slug', selectedSlugs[0]!);
        }
        commitParams(next);
    };
    const setChildKind = (value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set('child_kind', value); else next.delete('child_kind');
        commitParams(next);
    };

    const chartSlugs = fanout === 'breakdown' ? selectedSlugs.slice(0, 1) : selectedSlugs;
    const chartReady = identityReady && parsedAccount != null && chartSlugs.length > 0
        && (fanout === 'off' || childKind.trim() !== '');
    const chartCacheKey = `metrics-explorer:${callerId}:exact-history`;
    const seriesLabels = useMemo(() => Object.fromEntries(chartSlugs.map((slug) => [slug, slug])), [chartSlugs]);

    const pointsQuery = useQuery({
        queryKey: ['metrics-series', callerId, account, selectedSlugs, 'hours', pointWhen],
        queryFn: () => fetchMetricPoints({ account, slugs: selectedSlugs, granularity: 'hours', when: pointWhen }),
        enabled: identityReady && parsedAccount != null && selectedSlugs.length > 0 && fanout === 'off',
    });

    const readScalar = async () => {
        setScalarPending(true);
        setScalarError(null);
        try {
            const slug = scalarSlug.trim();
            const result = await queryClient.fetchQuery({
                queryKey: ['metrics-value', callerId, account, slug],
                queryFn: () => readMetricValue(account, slug),
                staleTime: 0,
            });
            const parsedScale = Number(scalarScale);
            const scale = Number.isFinite(parsedScale) ? parsedScale : 1;
            await modal.detail((close) => <ScalarMetricDetail result={result} scale={scale} onClose={() => close(null)} />);
        } catch (error) {
            setScalarError(errorMessage(error, 'Failed to read scalar value.'));
        } finally {
            setScalarPending(false);
        }
    };

    return (
        <div className="monitoring-page metrics-explorer">
            <header className="monitoring-page-head">
                <div>
                    <div className="eyebrow">Observability</div>
                    <h1>Metrics Explorer</h1>
                    <p>Browse recorded time-series metrics without changing data or permissions.</p>
                </div>
            </header>

            <MetricsSourcePicker
                account={account}
                parsedAccount={parsedAccount}
                accountError={accountError}
                accountsPage={accountQuery.data}
                accountsPending={accountQuery.isPending}
                accountsError={accountQuery.isError ? errorMessage(accountQuery.error, 'Account discovery failed.') : null}
                accountSearch={accountSearch}
                onAccountSearch={(value) => { setAccountSearch(value); setAccountStart(0); }}
                onAccountPage={setAccountStart}
                onRetryAccounts={() => void accountQuery.refetch()}
                onChange={changeAccount}
            />

            <section className="panel panel-pad metrics-discovery-card" aria-labelledby="metrics-discovery-heading">
                <div className="metrics-section-head">
                    <div>
                        <div className="eyebrow">Registry</div>
                        <h2 id="metrics-discovery-heading">Category and full slugs</h2>
                        <p>Colon-bearing slugs remain exact identities. Changing source clears downstream selections; retrying does not.</p>
                    </div>
                </div>
                {accountError ? (
                    <div className="metrics-compact-state metrics-compact-error">Fix the exact account before browsing its registry.</div>
                ) : (
                    <div className="metrics-discovery-grid">
                        <div className="metrics-discovery-column">
                            <label className="field">
                                <span className="field-label">Categories</span>
                                <input className="input" value={categorySearch} maxLength={128} onChange={(event) => { setCategorySearch(event.target.value); setCategoryStart(0); }} placeholder="Search categories…" />
                            </label>
                            {categoryQuery.isPending && <div className="metrics-compact-state">Loading categories…</div>}
                            {categoryQuery.isError && (
                                <div className="metrics-compact-state metrics-compact-error">
                                    <span>{errorMessage(categoryQuery.error, 'Category discovery failed.')}</span>
                                    <button type="button" className="btn btn-compact" onClick={() => void categoryQuery.refetch()}>Retry</button>
                                    <button type="button" className="btn btn-compact" onClick={() => document.getElementById('metrics-account-input')?.focus()}>Change account</button>
                                </div>
                            )}
                            {categoryQuery.data && (
                                <>
                                    <div className="metrics-choice-list" role="listbox" aria-label="Metric category">
                                        {categoryQuery.data.data.map((value) => (
                                            <button type="button" role="option" aria-selected={category === value} key={value} className={`metrics-choice${category === value ? ' metrics-choice-active' : ''}`} onClick={() => changeCategory(value)}><code>{value}</code></button>
                                        ))}
                                        {categoryQuery.data.data.length === 0 && <span className="metrics-compact-state">No categories found.</span>}
                                    </div>
                                    <div className="metrics-pager">
                                        <span>{categoryQuery.data.pageCount} of {categoryQuery.data.count}</span>
                                        <button type="button" className="btn btn-compact" disabled={categoryQuery.data.start === 0} onClick={() => setCategoryStart(Math.max(0, categoryQuery.data.start - categoryQuery.data.size))}>Previous</button>
                                        <button type="button" className="btn btn-compact" disabled={categoryQuery.data.nextStart == null} onClick={() => setCategoryStart(categoryQuery.data.nextStart ?? categoryQuery.data.start)}>Next</button>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="metrics-discovery-column">
                            <label className="field">
                                <span className="field-label">Full slugs</span>
                                <input className="input" value={slugSearch} maxLength={128} disabled={!category} onChange={(event) => { setSlugSearch(event.target.value); setSlugStart(0); }} placeholder={category ? 'Search slugs…' : 'Choose a category first'} />
                            </label>
                            {slugUrlError && <div className="metrics-compact-state metrics-compact-error">{slugUrlError}</div>}
                            {!category && <div className="metrics-compact-state">Choose a category to browse its exact slug registry.</div>}
                            {slugQuery.isPending && category && <div className="metrics-compact-state">Loading slugs…</div>}
                            {slugQuery.isError && (
                                <div className="metrics-compact-state metrics-compact-error"><span>{errorMessage(slugQuery.error, 'Slug discovery failed.')}</span><button type="button" className="btn btn-compact" onClick={() => void slugQuery.refetch()}>Retry</button></div>
                            )}
                            {slugQuery.data && (
                                <>
                                    <div className="metrics-choice-list metrics-slug-list">
                                        {slugQuery.data.data.map((slug) => (
                                            <label className="metrics-slug-choice" key={slug}>
                                                <input type="checkbox" checked={selectedSlugs.includes(slug)} disabled={fanout === 'breakdown' && selectedSlugs.length === 1 && !selectedSlugs.includes(slug)} onChange={() => toggleSlug(slug)} />
                                                <code>{slug}</code>
                                            </label>
                                        ))}
                                        {slugQuery.data.data.length === 0 && <span className="metrics-compact-state">No slugs found.</span>}
                                    </div>
                                    <div className="metrics-pager">
                                        <span>{slugQuery.data.pageCount} of {slugQuery.data.count}</span>
                                        <button type="button" className="btn btn-compact" disabled={slugQuery.data.start === 0} onClick={() => setSlugStart(Math.max(0, slugQuery.data.start - slugQuery.data.size))}>Previous</button>
                                        <button type="button" className="btn btn-compact" disabled={slugQuery.data.nextStart == null} onClick={() => setSlugStart(slugQuery.data.nextStart ?? slugQuery.data.start)}>Next</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </section>

            {parsedAccount?.kind === 'group' && selectedSlugs.length > 0 && (
                <section className="panel panel-pad metrics-fanout-card">
                    <div className="metrics-section-head">
                        <div><div className="eyebrow">Group fan-out</div><h2>Aggregate active child groups</h2><p>Sum supports every selected slug. Breakdown preserves child labels and requires one slug.</p></div>
                    </div>
                    <div className="metrics-fanout-controls">
                        <label className="field"><span className="field-label">Mode</span><select className="input" value={fanout} onChange={(event) => setFanout(event.target.value)}><option value="off">Off</option><option value="sum">Sum children</option><option value="breakdown">Break down one slug</option></select></label>
                        <label className="field"><span className="field-label">Child kind</span><input className="input" value={childKind} maxLength={64} disabled={fanout === 'off'} onChange={(event) => setChildKind(event.target.value)} placeholder="team" /></label>
                    </div>
                </section>
            )}

            {chartReady ? (
                <MetricsChart
                    title={fanout === 'breakdown' ? `${chartSlugs[0]} by ${childKind}` : `${category || 'Selected'} metrics`}
                    account={account}
                    slugs={chartSlugs}
                    seriesLabels={seriesLabels}
                    preserveSeriesLabels
                    loadSeries={loadExactMetricSeries}
                    seriesCacheKey={chartCacheKey}
                    childKind={fanout === 'off' ? undefined : childKind.trim()}
                    breakdown={fanout === 'breakdown' ? true : undefined}
                />
            ) : (
                <div className="panel metrics-empty-chart"><i className="bi bi-graph-up" /><h2>Choose metrics to chart</h2><p>{fanout !== 'off' && !childKind.trim() ? 'Enter a child kind to run fan-out.' : 'Select one or more full slugs from an authorized category.'}</p></div>
            )}

            {selectedSlugs.length > 0 && fanout === 'off' && (
                <section className="metrics-kpi-section" aria-labelledby="metrics-kpi-heading">
                    <div className="metrics-section-head">
                        <div><div className="eyebrow">Point comparison</div><h2 id="metrics-kpi-heading">Current hour vs previous</h2></div>
                        <button type="button" className="btn btn-compact" disabled={pointsQuery.isFetching} onClick={() => setPointWhen(Math.floor(Date.now() / 1000))}><i className={`bi bi-arrow-clockwise${pointsQuery.isFetching ? ' spin' : ''}`} /> Refresh</button>
                    </div>
                    {pointsQuery.isError && <div className="metrics-compact-state metrics-compact-error"><span>{errorMessage(pointsQuery.error, 'Point comparison failed.')}</span><button type="button" className="btn btn-compact" onClick={() => void pointsQuery.refetch()}>Retry</button></div>}
                    <div className="metrics-kpi-grid">
                        {(pointsQuery.data ?? selectedSlugs.map<MetricPoint>((slug) => ({ slug, value: 0, previous: 0, delta: 0 }))).map((point) => (
                            <KPITile key={point.slug} label={point.slug} value={pointsQuery.data ? point.value : null} delta={pointsQuery.data ? point.delta : null} deltaPct={pointsQuery.data ? point.deltaPct : null} loading={pointsQuery.isPending} />
                        ))}
                    </div>
                </section>
            )}

            <section className="panel panel-pad metrics-scalar-card" aria-labelledby="metrics-scalar-heading">
                <div className="metrics-section-head">
                    <div><div className="eyebrow">Known scalar</div><h2 id="metrics-scalar-heading">Read one exact slug</h2><p>Scalar browsing and health semantics are intentionally unavailable. Enter a known full slug for a raw read.</p></div>
                </div>
                <div className="metrics-scalar-controls">
                    <label className="field"><span className="field-label">Full scalar slug</span><input className="input" value={scalarSlug} onChange={(event) => setScalarSlug(event.target.value)} placeholder="limits:max_users" /></label>
                    <label className="field"><span className="field-label">Display scale</span><input className="input" type="number" step="any" value={scalarScale} onChange={(event) => setScalarScale(event.target.value)} /></label>
                    <button type="button" className="btn btn-primary" disabled={scalarPending || !identityReady || !parsedAccount || !scalarSlug.trim()} onClick={() => void readScalar()}>{scalarPending ? 'Reading…' : 'Read value'}</button>
                </div>
                {scalarError && <div className="metrics-compact-state metrics-compact-error">{scalarError}</div>}
            </section>
        </div>
    );
}
