import { confirmGuardrail } from '../../ui';
import type { GroupApiKeyRow } from './models';

/** The stop in front of `is_active: false` — copy states what the backend does. */
export function confirmDeactivateKey(row: GroupApiKeyRow): Promise<boolean> {
    return confirmGuardrail({
        title: `Deactivate API key "${row.name}"?`,
        effect: <>The key stops authenticating the moment this saves.</>,
        why: [
            <>Every integration holding this key gets <b>401</b> on its next call — the caller sees an auth failure, not a notice.</>,
            <>The key is <b>not rotated</b>: the same secret stays on file, so anyone who holds it regains access the instant it is re-enabled.</>,
        ],
        undo: 'Re-enabling restores the same key; no integration needs a new secret.',
        confirmText: 'Deactivate key',
    });
}

