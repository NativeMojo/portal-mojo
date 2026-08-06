// Scheduled-task editor — the focused dialog that creates and edits a
// jobs.ScheduledTask, plus the client-side mirror of the model's `_validate`.
//
// Why a hand-built controlled form rather than SchemaForm/formModal: the wire
// shape is not flat. `run_days` is a list of INTS, `run_times` a list of at
// most two "HH:MM" strings, and `job_config` a type-specific nested dict whose
// required keys change with `task_type`. The Field language carries scalars and
// scalar arrays; expressing "two time strings, seven int toggles and a
// per-type config object" through it would mean a second value pipeline inside
// the field defs. One controlled state object, one commit path.
//
// The validation below is the whole point of the file. `ScheduledTask.save()`
// calls `_validate()`, which raises a plain Python `ValueError` — django-mojo
// turns that into a 400 whose body is the raw message. Every rule the model
// checks is checked here first, in the model's own order and with its own
// wording, so the common mistakes never become a server round-trip. The server
// stays authoritative: anything that still reaches it (the per-user cap, an
// undeclared channel under JOBS_ALLOWED_CHANNELS enforcement) surfaces
// VERBATIM through the rejecting save path.
//
// NOT offered here, deliberately: a "Run now" control. The capability exists
// only as the owner-scoped assistant tool `_tool_run_scheduled_task_now`;
// there is no REST route and no publish endpoint to synthesize one. Per the
// wave-7a precedent an unsupported operation stays ABSENT rather than shipping
// disabled — the gap is tracked as django-mojo #1309.
import { useState, type FormEvent, type ReactNode } from 'react';
import { modal } from '../../ui';
import {
    NOTIFY_CHANNELS,
    SCHEDULED_TASK_TYPE_OPTIONS,
    WEEKDAY_LABELS,
    type ScheduledTaskRow,
    type ScheduledTaskType,
} from './models';

// ── The draft ─────────────────────────────────────────────────────────

/** Every field a caller may write. `id`, `user`, `run_count`, `last_run` and
 *  `last_error` are server-owned and never appear here — the backend stamps
 *  `user` from the request, so there is no arbitrary-owner write to express. */
export interface ScheduledTaskDraft {
    name: string;
    description: string;
    enabled: boolean;
    run_once: boolean;
    task_type: ScheduledTaskType;
    run_times: string[];
    run_days: number[];
    job_config: Record<string, unknown>;
    notify: string[];
    channel: string;
    max_retries: number;
}

/** Model defaults: `enabled=True`, `channel="default"`, everything else empty. */
export function emptyScheduledTaskDraft(): ScheduledTaskDraft {
    return {
        name: '', description: '', enabled: true, run_once: false,
        task_type: 'llm', run_times: [], run_days: [], job_config: {},
        notify: [], channel: 'default', max_retries: 0,
    };
}

export function scheduledTaskDraft(task: ScheduledTaskRow): ScheduledTaskDraft {
    return {
        name: task.name ?? '',
        description: task.description ?? '',
        enabled: Boolean(task.enabled),
        run_once: Boolean(task.run_once),
        task_type: task.task_type,
        run_times: [...(task.run_times ?? [])],
        run_days: [...(task.run_days ?? [])],
        job_config: { ...(task.job_config ?? {}) },
        notify: [...(task.notify ?? [])],
        channel: task.channel ?? 'default',
        max_retries: Number(task.max_retries ?? 0),
    };
}

// ── Validation (ScheduledTask._validate, rule for rule) ───────────────

const TASK_TYPES = new Set<string>(SCHEDULED_TASK_TYPE_OPTIONS.map((option) => option.value));
/** `mojo.apps.jobs.CHANNEL_NAME_RE` verbatim. */
const CHANNEL_NAME_RE = /^[A-Za-z0-9_.\-]{1,100}$/;

/**
 * The model's messages, in the model's order. Returns [] when the draft would
 * save. A non-empty result is shown to the operator instead of being sent.
 *
 * The three `job_config` requirements at the end are NOT from `_validate` —
 * they are raised by `mojo/apps/jobs/asyncjobs.py` at dispatch time, hours
 * later, and land in a TaskResult nobody is watching. A task that can only
 * ever fail is not worth saving, so they are checked here too.
 */
export function validateScheduledTaskDraft(draft: ScheduledTaskDraft): string[] {
    const errors: string[] = [];

    if (!draft.name.trim()) errors.push('Name is required.');

    // run_times — max 2, each exactly "HH:MM".
    if (draft.run_times.length > 2) {
        errors.push('run_times cannot have more than 2 entries');
    }
    for (const time of draft.run_times) {
        if (typeof time !== 'string' || time.length !== 5 || time[2] !== ':') {
            errors.push(`Invalid time format: ${time}. Use HH:MM`);
            continue;
        }
        const hour = Number(time.slice(0, 2));
        const minute = Number(time.slice(3));
        if (!Number.isInteger(hour) || !Number.isInteger(minute)
            || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            errors.push(`Invalid time value: ${time}`);
        }
    }
    // A task with no times never matches an hour and so never runs — the model
    // permits it, the dispatcher silently skips it forever.
    if (draft.run_times.length === 0) {
        errors.push('Set at least one run time — a task with no times never matches an hour and never runs.');
    }

    // run_days — weekday ints, Mon=0.
    for (const day of draft.run_days) {
        if (!Number.isInteger(day) || day < 0 || day > 6) {
            errors.push(`Invalid weekday: ${day}. Must be 0-6 (Mon=0)`);
        }
    }

    if (!TASK_TYPES.has(draft.task_type)) errors.push(`Invalid task_type: ${draft.task_type}`);

    // channel — charset only; membership (JOBS_ALLOWED_CHANNELS) is a
    // deployment setting this client cannot see, so that one is left to the
    // server and surfaced verbatim when it rejects.
    const channel = draft.channel.trim();
    if (!channel) {
        errors.push("Job channel must be a non-empty string, got ''");
    } else if (!CHANNEL_NAME_RE.test(channel)) {
        errors.push(`Invalid job channel '${channel}': use only letters, digits, '_', '.' and '-' (max 100 chars).`);
    }

    for (const value of draft.notify) {
        if (!NOTIFY_CHANNELS.includes(value as (typeof NOTIFY_CHANNELS)[number])) {
            errors.push(`Invalid notify channel: ${value}`);
        }
    }

    if (!Number.isInteger(draft.max_retries) || draft.max_retries < 0) {
        errors.push('Max retries must be a whole number of 0 or more.');
    }

    // Dispatch-time requirements (asyncjobs._run_*_task).
    const config = draft.job_config;
    if (draft.task_type === 'llm' && !String(config.user_prompt ?? '').trim()) {
        errors.push('LLM task requires a user_prompt in job_config');
    }
    if (draft.task_type === 'webhook' && !String(config.url ?? '').trim()) {
        errors.push('Webhook task requires a url in job_config');
    }
    if (draft.task_type === 'job' && !String(config.func ?? '').trim()) {
        errors.push('Job task requires a func in job_config');
    }

    return errors;
}

/** The wire body for a save. Server-owned fields are never included. */
export function scheduledTaskChanges(draft: ScheduledTaskDraft): Record<string, unknown> {
    return {
        name: draft.name.trim(),
        description: draft.description,
        enabled: draft.enabled,
        run_once: draft.run_once,
        task_type: draft.task_type,
        run_times: draft.run_times,
        run_days: [...draft.run_days].sort((a, b) => a - b),
        job_config: draft.job_config,
        notify: draft.notify,
        channel: draft.channel.trim(),
        max_retries: draft.max_retries,
    };
}

// ── Small controlled inputs ───────────────────────────────────────────

function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
    return (
        <label className="jobs-field">
            <span>{label}</span>
            {children}
            {help && <small className="field-help">{help}</small>}
        </label>
    );
}

function Toggle({ label, checked, onChange, help }: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    help?: string;
}) {
    return (
        <label className="jobs-task-toggle">
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
            <span>
                {label}
                {help && <small className="dim"> — {help}</small>}
            </span>
        </label>
    );
}

/**
 * The `job_config` editor. `payload` (job) and `data` (webhook) are free-form
 * dicts, so they are edited as JSON text with a parse guard — an unparsable
 * blob keeps the last good value and shows an inline error rather than
 * silently writing a string where the backend wants an object.
 */
function ConfigEditor({ draft, patch }: {
    draft: ScheduledTaskDraft;
    patch: (config: Record<string, unknown>) => void;
}) {
    const config = draft.job_config;
    const [jsonText, setJsonText] = useState(() => {
        const blob = draft.task_type === 'webhook' ? config.data : config.payload;
        return JSON.stringify(blob ?? {}, null, 2);
    });
    const [jsonError, setJsonError] = useState<string | null>(null);

    const setBlob = (key: 'payload' | 'data', text: string) => {
        setJsonText(text);
        try {
            const parsed: unknown = text.trim() ? JSON.parse(text) : {};
            if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setJsonError('Must be a JSON object, e.g. {"key": "value"}.');
                return;
            }
            setJsonError(null);
            patch({ ...config, [key]: parsed as Record<string, unknown> });
        } catch (error) {
            setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
        }
    };

    if (draft.task_type === 'llm') {
        return (
            <>
                <Field label="System prompt" help="Optional. Sets the assistant’s role for every run.">
                    <textarea
                        className="input" rows={3}
                        value={String(config.system_prompt ?? '')}
                        onChange={(event) => patch({ ...config, system_prompt: event.target.value })}
                    />
                </Field>
                <Field label="User prompt" help="Required. The prompt run on schedule; its answer becomes the task result.">
                    <textarea
                        className={`input${String(config.user_prompt ?? '').trim() ? '' : ' input-invalid'}`}
                        rows={4}
                        value={String(config.user_prompt ?? '')}
                        onChange={(event) => patch({ ...config, user_prompt: event.target.value })}
                    />
                </Field>
            </>
        );
    }

    if (draft.task_type === 'webhook') {
        return (
            <>
                <Field label="URL" help="Required. Each run publishes a webhook job that POSTs to this URL.">
                    <input
                        type="url" className={`input${String(config.url ?? '').trim() ? '' : ' input-invalid'}`}
                        placeholder="https://example.com/hooks/mojo"
                        value={String(config.url ?? '')}
                        onChange={(event) => patch({ ...config, url: event.target.value })}
                    />
                </Field>
                <Field label="Body (JSON)" help={jsonError ? <span className="jobs-text-danger">{jsonError}</span> : 'Sent as the POST body.'}>
                    <textarea
                        className={`input jobs-task-code${jsonError ? ' input-invalid' : ''}`} rows={5}
                        value={jsonText}
                        onChange={(event) => setBlob('data', event.target.value)}
                    />
                </Field>
            </>
        );
    }

    return (
        <>
            <Field label="Function" help="Required. The dotted path the published job runs.">
                <input
                    type="text" className={`input${String(config.func ?? '').trim() ? '' : ' input-invalid'}`}
                    placeholder="mojo.apps.jobs.examples.sample_jobs.generate_report"
                    value={String(config.func ?? '')}
                    onChange={(event) => patch({ ...config, func: event.target.value })}
                />
            </Field>
            <Field label="Payload (JSON)" help={jsonError ? <span className="jobs-text-danger">{jsonError}</span> : 'Passed to the function on every run.'}>
                <textarea
                    className={`input jobs-task-code${jsonError ? ' input-invalid' : ''}`} rows={5}
                    value={jsonText}
                    onChange={(event) => setBlob('payload', event.target.value)}
                />
            </Field>
        </>
    );
}

// ── The dialog ────────────────────────────────────────────────────────

function ScheduledTaskEditor({ task, submit, onDone }: {
    task?: ScheduledTaskRow;
    submit: (changes: Record<string, unknown>) => Promise<unknown>;
    onDone: (saved: boolean) => void;
}) {
    const editing = task != null;
    const [draft, setDraft] = useState<ScheduledTaskDraft>(() => (task ? scheduledTaskDraft(task) : emptyScheduledTaskDraft()));
    const [attempted, setAttempted] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const patch = (changes: Partial<ScheduledTaskDraft>) => setDraft((prev) => ({ ...prev, ...changes }));
    const errors = validateScheduledTaskDraft(draft);

    // Times are two independent slots because the model caps run_times at two.
    // Editing them as one comma-separated string (the source's approach) is
    // what produced "Invalid time format" 400s in the first place.
    const setTime = (index: 0 | 1, value: string) => {
        const next = [draft.run_times[0] ?? '', draft.run_times[1] ?? ''];
        next[index] = value.trim();
        patch({ run_times: next.filter((time) => time !== '') });
    };

    const toggleDay = (day: number) => {
        const has = draft.run_days.includes(day);
        patch({ run_days: has ? draft.run_days.filter((d) => d !== day) : [...draft.run_days, day].sort((a, b) => a - b) });
    };

    const toggleNotify = (channel: string) => {
        const has = draft.notify.includes(channel);
        patch({ notify: has ? draft.notify.filter((value) => value !== channel) : [...draft.notify, channel] });
    };

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setAttempted(true);
        setServerError(null);
        if (errors.length > 0) return;
        setBusy(true);
        try {
            await submit(scheduledTaskChanges(draft));
            onDone(true);
        } catch (error) {
            // The rejecting save path is the safety net: the per-user cap and
            // an undeclared channel are only knowable server-side, and their
            // text is shown exactly as the backend wrote it.
            setServerError(error instanceof Error ? error.message : 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="modal-pad jobs-task-form" onSubmit={(event) => void onSubmit(event)}>
            <h2 className="modal-title">{editing ? `Edit ${task.name || 'scheduled task'}` : 'New scheduled task'}</h2>

            {!editing && (
                <p className="jobs-note jobs-note-info">
                    <i className="bi bi-person-badge" />
                    The task is created under <strong>your</strong> account — the backend stamps the owner from the
                    request, so a task cannot be filed on someone else’s behalf.
                </p>
            )}
            {serverError && <div className="form-alert">{serverError}</div>}
            {attempted && errors.length > 0 && (
                <div className="form-alert">
                    <ul className="jobs-task-errors">
                        {errors.map((message) => <li key={message}>{message}</li>)}
                    </ul>
                </div>
            )}

            <Field label="Name"><input type="text" className="input" value={draft.name} placeholder="Daily revenue digest" onChange={(event) => patch({ name: event.target.value })} /></Field>
            <Field label="Description">
                <textarea className="input" rows={2} value={draft.description} placeholder="What this task does…" onChange={(event) => patch({ description: event.target.value })} />
            </Field>

            <Field
                label="Task type"
                help={editing
                    ? 'Fixed after creation — the backend merges JSON bodies into job_config, so switching types would leave the old type’s keys behind.'
                    : 'Decides which configuration the task carries.'}
            >
                <select
                    className="input" value={draft.task_type} disabled={editing}
                    onChange={(event) => patch({ task_type: event.target.value as ScheduledTaskType, job_config: {} })}
                >
                    {SCHEDULED_TASK_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </Field>

            <div className="jobs-task-toggles">
                <Toggle label="Enabled" checked={draft.enabled} onChange={(enabled) => patch({ enabled })} help="only enabled tasks are dispatched" />
                <Toggle label="Run once" checked={draft.run_once} onChange={(run_once) => patch({ run_once })} help="disables itself after one successful run" />
            </div>

            <div className="jobs-task-times">
                <Field label="Run time" help="24-hour HH:MM, in the owner’s organization timezone.">
                    <input type="text" className="input" maxLength={5} placeholder="09:00" value={draft.run_times[0] ?? ''} onChange={(event) => setTime(0, event.target.value)} />
                </Field>
                <Field label="Second run time" help="Optional. The model allows at most two.">
                    <input type="text" className="input" maxLength={5} placeholder="17:00" value={draft.run_times[1] ?? ''} onChange={(event) => setTime(1, event.target.value)} />
                </Field>
            </div>

            <Field label="Run days" help={draft.run_days.length === 0 ? 'None selected — runs every day.' : 'Monday is 0, matching Python’s weekday().'}>
                <div className="seg jobs-task-days">
                    {WEEKDAY_LABELS.map((label, day) => (
                        <button
                            key={label} type="button"
                            className={`seg-btn${draft.run_days.includes(day) ? ' seg-active' : ''}`}
                            aria-pressed={draft.run_days.includes(day)}
                            onClick={() => toggleDay(day)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </Field>

            <Field label="Notify" help="Opt-in channels notified after a successful run.">
                <div className="jobs-task-checks">
                    {NOTIFY_CHANNELS.map((channel) => (
                        <label key={channel} className="jobs-task-toggle">
                            <input type="checkbox" checked={draft.notify.includes(channel)} onChange={() => toggleNotify(channel)} />
                            <span>{channel}</span>
                        </label>
                    ))}
                </div>
            </Field>

            <div className="jobs-task-times">
                <Field label="Channel" help="The job channel published runs target.">
                    <input type="text" className="input" value={draft.channel} placeholder="default" onChange={(event) => patch({ channel: event.target.value })} />
                </Field>
                <Field label="Max retries">
                    <input
                        type="number" className="input" min={0} step={1} value={draft.max_retries}
                        onChange={(event) => patch({ max_retries: Math.trunc(Number(event.target.value) || 0) })}
                    />
                </Field>
            </div>

            <div className="jobs-task-config">
                {/* Keyed on the type so switching it remounts the editor —
                    the JSON textarea holds its own parsed-text state. */}
                <ConfigEditor key={draft.task_type} draft={draft} patch={(job_config) => patch({ job_config })} />
                <p className="jobs-note jobs-note-info">
                    <i className="bi bi-info-circle" />
                    Configuration is <strong>merged</strong> server-side: a value you change is written, but a key you
                    delete here stays stored.
                </p>
            </div>

            <div className="modal-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
                </button>
            </div>
        </form>
    );
}

/**
 * Open the editor as a focused dialog. Stacks above `modal.detail` on the same
 * native `<dialog>` substrate. Resolves true once a save succeeded.
 *
 * `submit` belongs to the caller so the mutation (and its cache invalidation)
 * stays where the data lives — the dialog only collects and validates.
 */
export function openScheduledTaskEditor(args: {
    task?: ScheduledTaskRow;
    submit: (changes: Record<string, unknown>) => Promise<unknown>;
}): Promise<boolean> {
    return modal
        .open<boolean>((close) => (
            <ScheduledTaskEditor task={args.task} submit={args.submit} onDone={(saved) => close(saved)} />
        ))
        .then((value) => value === true);
}
