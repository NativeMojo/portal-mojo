// TimezoneSelect demos — the IANA picker over ComboBox. Every readout below
// only moves on a COMMIT (click an option / Enter on the highlighted one /
// blur onto an exact zone name): typed filter text is a draft that reverts,
// which is the web-mojo bug this port makes impossible.
import { useState } from 'react';
import {
    TimezoneSelect,
    localTimezone,
    resolveTimezone,
    type TimezoneChangeEvent,
} from 'portal-mojo/ui';

// Module constants: a fixed list identity must be stable, or the labels
// re-map on every render (harmless, but pointless work).
const OPS_ZONES = [
    'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Asia/Tokyo',
];
const EU_ZONES = ['Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Athens'];

const show = (v: string | null) => (v === null || v === '' ? '(empty)' : v);
const showEvent = (e: TimezoneChangeEvent | null) =>
    (e ? `{ value: "${e.value}", oldValue: ${e.oldValue === null ? 'null' : `"${e.oldValue}"`} }` : '—');

export function TimezoneSelectDemo() {
    const [zone, setZone] = useState<string | null>(null);
    const [last, setLast] = useState<TimezoneChangeEvent | null>(null);
    const [changes, setChanges] = useState(0);

    const [ops, setOps] = useState<string | null>(null);
    const [eu, setEu] = useState<string | null>(null);
    // A zone as django-mojo stores it — the modern IANA primary, which V8's
    // zone list does NOT carry (it lists the ICU-canonical Asia/Calcutta).
    const [stored, setStored] = useState<string | null>('Asia/Kolkata');
    const [optional, setOptional] = useState<string | null>(null);
    const [formZone, setFormZone] = useState<string | null>(null);
    const [posted, setPosted] = useState('—');

    const commit = (e: TimezoneChangeEvent) => {
        setZone(e.value);
        setLast(e);
        setChanges((n) => n + 1);
    };

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">Default — the local zone, offset-annotated</div>
                <p className="dim" style={{ margin: '0 0 10px' }}>
                    Zones come from <code>Intl.supportedValuesOf('timeZone')</code> (~420 of them, plus
                    <code> UTC</code>, which V8 omits); each label carries the zone's <b>current</b> UTC offset with a
                    Unicode minus — <code>America/New_York (UTC−05:00)</code>. Labels are recomputed on every gesture
                    that opens the list, so a tab left open across a DST change relabels itself on the next open.
                    Search runs over the whole label — zone name and offset as displayed.
                </p>
                <div style={{ maxWidth: 420 }}>
                    <TimezoneSelect value={zone} onChange={commit} />
                </div>
                <p className="dim" style={{ margin: '10px 0 0' }}>
                    state: <code>{show(zone)}</code> · effective (<code>getFormValue</code>):{' '}
                    <code>{show(resolveTimezone(zone))}</code> · commits: <code>{changes}</code> · last onChange:{' '}
                    <code>{showEvent(last)}</code>
                </p>
                <p className="dim" style={{ margin: '6px 0 0' }}>
                    The state starts <b>empty</b> and the picker shows your browser's zone
                    (<code>{localTimezone()}</code>) — an empty value <i>displays</i> the local default; it does not
                    commit one (a mount-time commit would trip FormView's autosave). Seed your state with
                    <code> localTimezone()</code> when you need the two identical from the first paint.
                    <b> Commit-only proof:</b> type <code>zzz</code> and click away — the display reverts and the
                    counter above does not move.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">timezones — a fixed list overrides the engine</div>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ width: 300 }}>
                        <TimezoneSelect
                            timezones={OPS_ZONES}
                            value={ops}
                            onChange={(e) => setOps(e.value)}
                        />
                        <p className="dim" style={{ margin: '8px 0 0' }}>
                            7 ops zones, order preserved · state: <code>{show(ops)}</code> · effective:{' '}
                            <code>{show(resolveTimezone(ops, { timezones: OPS_ZONES }))}</code>
                        </p>
                    </div>
                    <div style={{ width: 300 }}>
                        <TimezoneSelect
                            timezones={EU_ZONES}
                            value={eu}
                            onChange={(e) => setEu(e.value)}
                        />
                        <p className="dim" style={{ margin: '8px 0 0' }}>
                            list without your zone · state: <code>{show(eu)}</code> · effective:{' '}
                            <code>{show(resolveTimezone(eu, { timezones: EU_ZONES }))}</code>
                        </p>
                    </div>
                </div>
                <p className="dim" style={{ margin: '10px 0 0' }}>
                    A fixed list constrains the choice, so the default only stays local when the list contains it
                    (left); otherwise it falls back to the list's first entry (right) rather than defaulting to
                    something unpickable.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Stored zones the engine doesn't list (aliases)</div>
                <div style={{ maxWidth: 420 }}>
                    <TimezoneSelect value={stored} onChange={(e) => setStored(e.value)} />
                </div>
                <p className="dim" style={{ margin: '10px 0 0' }}>
                    state: <code>{show(stored)}</code> — starts at <code>Asia/Kolkata</code>, which V8's zone list
                    does <b>not</b> contain: it reports the ICU-canonical ids (<code>Asia/Calcutta</code>,
                    <code> Europe/Kiev</code>, <code>America/Godthab</code>) while Python's <code>zoneinfo</code> — so
                    django-mojo — stores the modern primaries. The committed zone is therefore always prepended to the
                    options: it is labelled with its offset, sits at the top of the dropdown, and survives a
                    browse-and-come-back. Without that, a stored record could not be saved unchanged.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">disabled · no default · native form post</div>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ width: 260 }}>
                        <TimezoneSelect value="Asia/Tokyo" disabled />
                        <p className="dim" style={{ margin: '6px 0 0' }}>disabled — no focus, no chevron</p>
                    </div>
                    <div style={{ width: 260 }}>
                        <TimezoneSelect
                            value={optional}
                            defaultToLocal={false}
                            placeholder="No timezone…"
                            onChange={(e) => setOptional(e.value)}
                        />
                        <p className="dim" style={{ margin: '6px 0 0' }}>
                            <code>defaultToLocal={'{false}'}</code> — empty stays empty · state:{' '}
                            <code>{show(optional)}</code>
                        </p>
                    </div>
                    <form
                        style={{ width: 280 }}
                        onSubmit={(e) => {
                            e.preventDefault();
                            const data = new FormData(e.currentTarget);
                            setPosted(String(data.get('timezone') ?? ''));
                        }}
                    >
                        <div className="demo-row">
                            <div style={{ flex: 1 }}>
                                <TimezoneSelect
                                    name="timezone"
                                    timezones={OPS_ZONES}
                                    value={formZone}
                                    onChange={(e) => setFormZone(e.value)}
                                />
                            </div>
                            <button type="submit" className="btn btn-compact">Post</button>
                        </div>
                        <p className="dim" style={{ margin: '6px 0 0' }}>
                            <code>name</code> renders a hidden input — posts the plain IANA string, never the
                            offset label · posted: <code>{posted}</code>
                        </p>
                    </form>
                </div>
            </div>
        </>
    );
}
