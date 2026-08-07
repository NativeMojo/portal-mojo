import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MojoList } from '../../client/runtime';
import { CertificateModel, type CertificateRow } from './models';
import { deriveCertificateRenewalHealth } from './certificate-data';

export const CERTIFICATE_POLL_INTERVAL_MS = 10_000;
export const CERTIFICATE_POLL_MAX_TICKS = 36;

interface Operation {
    kind: 'issuance' | 'renewal';
    ticks: number;
    sawIssuing: boolean;
    baseline: Pick<CertificateRow, 'attempts' | 'modified' | 'not_after' | 'renew_after' | 'last_error'>;
}

function domainId(row: CertificateRow): number {
    return typeof row.domain === 'number' ? row.domain : row.domain.id;
}

export function certificateNeedsLifecyclePolling(row: CertificateRow, nowSeconds = Date.now() / 1000): boolean {
    const health = deriveCertificateRenewalHealth(row, nowSeconds);
    return health === 'pending' || health === 'issuing' || health === 'due';
}

function cachedCertificates(value: unknown): CertificateRow[] {
    if (value == null || typeof value !== 'object') return [];
    if ('rows' in value && Array.isArray((value as MojoList<CertificateRow>).rows)) {
        return (value as MojoList<CertificateRow>).rows;
    }
    if ('id' in value && typeof (value as CertificateRow).id === 'number') return [value as CertificateRow];
    return [];
}

/**
 * One bounded timer for one mounted certificate surface. New issuance polls
 * pending/issuing rows. Due renewal remembers the active baseline and follows
 * the active -> issuing -> changed-active/error transition. An already-active
 * renewal error is terminal and never starts ordinary polling.
 */
export function CertificateLifecyclePoller({ domain, intervalMs = CERTIFICATE_POLL_INTERVAL_MS, maxTicks = CERTIFICATE_POLL_MAX_TICKS }: {
    domain?: number;
    intervalMs?: number;
    maxTicks?: number;
}) {
    const queryClient = useQueryClient();
    const operations = useRef(new Map<number, Operation>());
    const settled = useRef(new Set<number>());
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [version, setVersion] = useState(0);

    useEffect(() => queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === CertificateModel.endpoint) setVersion((value) => value + 1);
    }), [queryClient]);

    useEffect(() => {
        const rowsById = new Map<number, CertificateRow>();
        for (const [, value] of queryClient.getQueriesData({ queryKey: CertificateModel.keys.root })) {
            for (const row of cachedCertificates(value)) {
                if (domain == null || domainId(row) === domain) rowsById.set(row.id, row);
            }
        }

        for (const [id, operation] of operations.current) {
            const row = rowsById.get(id);
            if (!row || operation.ticks >= maxTicks) {
                operations.current.delete(id);
                settled.current.add(id);
                continue;
            }
            if (operation.kind === 'issuance') {
                if (row.status !== 'pending' && row.status !== 'issuing') {
                    operations.current.delete(id);
                    settled.current.add(id);
                }
                continue;
            }
            if (row.status === 'issuing') {
                operation.sawIssuing = true;
                continue;
            }
            if (row.status !== 'active') {
                operations.current.delete(id);
                settled.current.add(id);
                continue;
            }
            const observable = row.attempts !== operation.baseline.attempts
                || row.not_after !== operation.baseline.not_after
                || row.renew_after !== operation.baseline.renew_after
                || row.last_error !== operation.baseline.last_error;
            if (row.last_error || (observable && (operation.sawIssuing || row.attempts > operation.baseline.attempts))) {
                operations.current.delete(id);
                settled.current.add(id);
            }
        }

        for (const row of rowsById.values()) {
            if (settled.current.has(row.id) || operations.current.has(row.id)) continue;
            const health = deriveCertificateRenewalHealth(row);
            if (health === 'pending' || health === 'issuing') {
                operations.current.set(row.id, {
                    kind: 'issuance', ticks: 0, sawIssuing: row.status === 'issuing',
                    baseline: { attempts: row.attempts, modified: row.modified, not_after: row.not_after, renew_after: row.renew_after, last_error: row.last_error },
                });
            } else if (health === 'due') {
                operations.current.set(row.id, {
                    kind: 'renewal', ticks: 0, sawIssuing: false,
                    baseline: { attempts: row.attempts, modified: row.modified, not_after: row.not_after, renew_after: row.renew_after, last_error: row.last_error },
                });
            }
        }

        if (operations.current.size === 0) {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            return;
        }
        if (timer.current) return;
        timer.current = setTimeout(() => {
            timer.current = null;
            for (const operation of operations.current.values()) operation.ticks += 1;
            const tracked = [...operations.current.keys()].map((id) => CertificateModel.fetchOne(queryClient, id));
            void Promise.allSettled([
                ...tracked,
                queryClient.refetchQueries({
                    type: 'active',
                    predicate: (query) => query.queryKey[0] === CertificateModel.endpoint,
                }),
            ]).finally(() => setVersion((value) => value + 1));
        }, Math.max(250, intervalMs));
    }, [domain, intervalMs, maxTicks, queryClient, version]);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        operations.current.clear();
        settled.current.clear();
    }, []);

    return null;
}
