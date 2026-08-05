// TanStack Query wraps the client: caching, dedup, background refetch,
// loading/error states — everything Collection.fetch + fetch:start/end
// events + stale guards did by hand in web-mojo.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mojoGet, mojoList, mojoSave } from './client';
import type { Params } from './types';

export function useModelList<T>(endpoint: string, params: Params = {}) {
    return useQuery({
        queryKey: [endpoint, params],
        queryFn: () => mojoList<T>(endpoint, params),
        // Old page stays visible while the next loads — no skeleton flash on
        // page/sort changes (web-mojo needed careful fetch-event juggling for
        // this; here it's one option).
        placeholderData: keepPreviousData,
    });
}

export function useModel<T>(endpoint: string, id: number | string | null) {
    return useQuery({
        queryKey: [endpoint, 'one', id],
        queryFn: () => mojoGet<T>(endpoint, id!),
        enabled: id != null,
    });
}

/** Save mutation; invalidates every query for the endpoint on success. */
export function useSaveModel<T>(endpoint: string) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, changes }: { id: number | string | null; changes: Record<string, unknown> }) =>
            mojoSave<T>(endpoint, id, changes),
        onSuccess: () => qc.invalidateQueries({ queryKey: [endpoint] }),
    });
}
