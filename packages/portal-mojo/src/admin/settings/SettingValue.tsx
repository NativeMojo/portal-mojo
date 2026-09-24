import { JsonBlock } from '../../ui';
import type { SettingRow } from './model';

function structuredValue(value: string): Record<string, unknown> | unknown[] | null {
    if (!/^[\s]*[\[{]/.test(value)) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> | unknown[] : null;
    } catch {
        return null;
    }
}

export function SettingValuePreview({ row }: { row: SettingRow }) {
    if (row.is_secret) return <code>{row.display_value || '******'}</code>;
    const value = row.display_value || '';
    const json = structuredValue(value);
    const compact = value.replace(/\s+/g, ' ');
    const shortened = compact.length > 80 || /[\r\n]/.test(value);
    if (!json && !shortened) return <code>{value || '—'}</code>;
    const summary = json
        ? `JSON ${Array.isArray(json) ? `array · ${json.length} items` : `object · ${Object.keys(json).length} keys`}`
        : `${compact.slice(0, 80)}${compact.length > 80 ? '…' : ''}`;
    return (
        <div style={{ maxWidth: '32ch' }}>
            <code style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</code>
        </div>
    );
}

export function SettingValue({ row }: { row: SettingRow }) {
    if (row.is_secret) return <code>{row.display_value || '******'}</code>;
    const value = row.value ?? row.display_value ?? '';
    const json = structuredValue(value);
    if (json) return <JsonBlock value={json} label="JSON value" defaultOpen />;
    return <pre style={{ margin: 0, maxHeight: '25rem', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}><code>{value || '—'}</code></pre>;
}
