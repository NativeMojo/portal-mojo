import { downloadBlob, mojoList } from './client';
import type { Params } from './types';

export interface SafeExportField<T> {
    key: string;
    label?: string;
    value?: (row: T) => unknown;
}

export interface SafeExporterOptions<T> {
    endpoint: string;
    filename: string;
    fields: readonly SafeExportField<T>[];
    sanitizeRow: (row: T) => T;
    pageSize?: number;
    maxRows?: number;
}

function scalar(value: unknown): string | number | boolean | null {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value ?? null;
    return JSON.stringify(value) ?? String(value);
}

function csvCell(value: unknown): string {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Build a bounded, client-side exporter for domains whose server formats
 * expose unsafe fields. Rows are sanitized before they are accumulated and
 * only the declared projection can reach the resulting file.
 */
export function createSafeExporter<T>(options: SafeExporterOptions<T>) {
    const pageSize = Math.min(250, Math.max(1, options.pageSize ?? 100));
    const maxRows = Math.max(pageSize, options.maxRows ?? 10_000);
    return async (format: 'csv' | 'json', normalizedParams: Params): Promise<void> => {
        const base: Params = { ...normalizedParams };
        for (const key of ['start', 'size', 'page', 'download_format', 'filename']) delete base[key];
        const projected: Record<string, string | number | boolean | null>[] = [];
        let start = 0;
        let count = Infinity;
        while (start < count && projected.length < maxRows) {
            const page = await mojoList<T>(options.endpoint, { ...base, start, size: pageSize });
            count = page.count;
            for (const wireRow of page.rows) {
                const row = options.sanitizeRow(wireRow);
                const record: Record<string, string | number | boolean | null> = {};
                for (const field of options.fields) {
                    const value = field.value
                        ? field.value(row)
                        : (row as unknown as Record<string, unknown>)[field.key];
                    record[field.label ?? field.key] = scalar(value);
                }
                projected.push(record);
                if (projected.length >= maxRows) break;
            }
            if (!page.rows.length) break;
            start += page.rows.length;
        }
        if (count > maxRows) throw new Error(`Export exceeds the ${maxRows.toLocaleString()} row safety limit; narrow the filters and try again.`);
        const filename = `${options.filename}.${format}`;
        if (format === 'json') {
            downloadBlob(new Blob([JSON.stringify(projected, null, 2)], { type: 'application/json' }), filename);
            return;
        }
        const headers = options.fields.map((field) => field.label ?? field.key);
        const body = [headers.map(csvCell).join(','), ...projected.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\r\n');
        downloadBlob(new Blob([body], { type: 'text/csv;charset=utf-8' }), filename);
    };
}
