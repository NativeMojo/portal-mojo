import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../client';
import {
    CollectionSelect, modal, toast, type CollectionSelectValue,
} from '../../ui';
import {
    SettingModel, saveSettingAtomic, settingGroupLabel,
    type SettingDraft, type SettingGroup, type SettingRow,
} from './model';

function initialGroup(row: SettingRow | null): number | null {
    if (row?.group == null) return null;
    return typeof row.group === 'number' ? row.group : row.group.id;
}

function SettingEditor({ row, close }: {
    row: SettingRow | null;
    close: (result: SettingRow | null) => void;
}) {
    const queryClient = useQueryClient();
    const { can: canChooseGroup } = useCan('sys.groups');
    const valueRef = useRef<HTMLTextAreaElement>(null);
    const valueTouched = useRef(false);
    const [key, setKey] = useState(row?.key ?? '');
    const [isSecret, setIsSecret] = useState(row?.is_secret ?? false);
    const [group, setGroup] = useState<number | null>(initialGroup(row));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const changeSecrecy = (next: boolean) => {
        setIsSecret(next);
        valueTouched.current = false;
        if (valueRef.current) valueRef.current.value = '';
        setError('');
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const draft: SettingDraft = {
            key,
            value: valueRef.current?.value ?? '',
            valueTouched: valueTouched.current,
            is_secret: isSecret,
            group,
        };
        setBusy(true);
        setError('');
        try {
            const saved = await saveSettingAtomic(row, draft);
            if (saved) {
                queryClient.setQueryData(SettingModel.keys.one(saved.id), saved);
                await queryClient.invalidateQueries({ queryKey: SettingModel.keys.root });
                toast.success(row ? 'Setting updated' : 'Setting created');
                close(saved);
            } else {
                close(row);
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Setting could not be saved');
        } finally {
            setBusy(false);
        }
    };

    const valueHelp = row?.is_secret && isSecret
        ? 'Leave blank to preserve the existing secret. Enter a value only to replace it.'
        : isSecret
            ? 'The value becomes write-only after save and will not be returned by the API.'
            : 'Plain settings may intentionally contain an empty string.';

    return (
        <form className="modal-pad" onSubmit={submit} noValidate>
            <h2 className="modal-title">{row ? `Edit setting — ${row.key}` : 'Create setting'}</h2>
            {error && <div className="form-alert">{error}</div>}
            <div className="form-grid">
                <div className="col-12">
                    <label className="field">
                        <span className="field-label">Key <em>*</em></span>
                        <input
                            className="input"
                            value={key}
                            disabled={row != null}
                            placeholder="WEBHOOK_SECRET"
                            onChange={(event) => setKey(event.target.value)}
                        />
                        <span className="field-help">Keys are immutable after creation.</span>
                    </label>
                </div>
                <div className="col-12">
                    <label className="switch-row">
                        <input
                            type="checkbox"
                            role="switch"
                            className="switch"
                            checked={isSecret}
                            onChange={(event) => changeSecrecy(event.target.checked)}
                        />
                        <span className="field-label">Secret</span>
                    </label>
                    {row && row.is_secret !== isSecret && (
                        <span className="field-help">Changing secret status requires an explicit replacement value.</span>
                    )}
                </div>
                <div className="col-12">
                    <label className="field">
                        <span className="field-label">{isSecret ? 'Secret replacement' : 'Value'}</span>
                        <textarea
                            ref={valueRef}
                            className="input"
                            rows={4}
                            defaultValue={row && !row.is_secret ? (row.value ?? row.display_value ?? '') : ''}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={() => { valueTouched.current = true; setError(''); }}
                        />
                        <span className="field-help">{valueHelp}</span>
                    </label>
                </div>
                <div className="col-12">
                    {canChooseGroup ? (
                        <CollectionSelect<SettingGroup>
                            endpoint="/api/group"
                            value={group as CollectionSelectValue}
                            onChange={(id) => setGroup(id == null ? null : Number(id))}
                            label="Group scope"
                            placeholder="Search groups…"
                            help="Clear the selection for a global setting."
                        />
                    ) : (
                        <div className="field">
                            <span className="field-label">Group scope</span>
                            <div className="input" aria-readonly="true">
                                {row ? settingGroupLabel(row.group) : 'Global'}
                            </div>
                            <span className="field-help">
                                Scope changes require the system Groups permission.
                            </span>
                        </div>
                    )}
                </div>
            </div>
            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => close(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
                    {busy ? 'Saving…' : row ? 'Save changes' : 'Create setting'}
                </button>
            </div>
        </form>
    );
}

export function showSettingEditor(row: SettingRow | null = null): Promise<SettingRow | null> {
    return modal.open<SettingRow | null>((close) => (
        <SettingEditor row={row} close={close} />
    ), { size: 'md' });
}
