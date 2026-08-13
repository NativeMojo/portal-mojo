// Formatter gallery — every `fmt.*` function against representative input,
// edge cases included (null, 0, negative, huge). The outputs below are LIVE
// calls, not transcribed strings: if a formatter regresses, this page shows it.
//
// Nothing here may fire a console.warn — the rule-4 warnings (unknown currency
// code, unknown duration unit) are described in prose instead, so browser
// verification still sees a clean console.
import { fmt } from 'portal-mojo/ui';

const NOW_SEC = Math.floor(Date.now() / 1000);
const HASH = 'd41d8cd98f00b204e9800998ecf8427e';
const SENTENCE = 'The quick brown fox jumps over the lazy dog';

interface Sample {
    /** The call, written out — the left column. */
    call: string;
    /** Its actual return value. */
    out: string;
}

interface FmtCard {
    sig: string;
    note?: string;
    samples: Sample[];
}

function Card({ card }: { card: FmtCard }) {
    return (
        <div className="panel panel-pad">
            <div className="eyebrow">{card.sig}</div>
            {card.note ? (
                <p className="dim" style={{ margin: '4px 0 10px', fontSize: 12, lineHeight: 1.5 }}>{card.note}</p>
            ) : (
                <div style={{ height: 8 }} />
            )}
            <table className="demo-table" style={{ width: '100%' }}>
                <tbody>
                    {card.samples.map((s) => (
                        <tr key={s.call}>
                            <td><code>{s.call}</code></td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {s.out === '' ? <span className="dim">(empty string)</span> : s.out}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CardGrid({ title, cards }: { title: string; cards: FmtCard[] }) {
    return (
        <>
            <div className="eyebrow" style={{ marginTop: 2 }}>{title}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 16 }}>
                {cards.map((c) => <Card key={c.sig} card={c} />)}
            </div>
        </>
    );
}

function numberCards(): FmtCard[] {
    return [
        {
            sig: 'fmt.number(v, decimals=0)',
            note: 'Thousands separators at a fixed en-US locale. Source defaulted to 2 decimals; portal columns are counts, so 0.',
            samples: [
                { call: 'number(1234567)', out: fmt.number(1234567) },
                { call: 'number(0)', out: fmt.number(0) },
                { call: 'number(-98765.4)', out: fmt.number(-98765.4) },
                { call: 'number(1234.5678, 2)', out: fmt.number(1234.5678, 2) },
                { call: "number('12 items')", out: fmt.number('12 items') },
                { call: 'number(null)', out: fmt.number(null) },
            ],
        },
        {
            sig: "fmt.currency(v, code='USD', opts?)",
            note: 'Input is CENTS by default — django-mojo stores money as integer minor units so it never touches a float. Arg 2 is an ISO code, not a symbol.',
            samples: [
                { call: 'currency(129900)', out: fmt.currency(129900) },
                { call: 'currency(0)', out: fmt.currency(0) },
                { call: 'currency(-4999)', out: fmt.currency(-4999) },
                { call: "currency(129900, 'EUR')", out: fmt.currency(129900, 'EUR') },
                { call: "currency(1299, 'JPY', {unit:'major'})", out: fmt.currency(1299, 'JPY', { unit: 'major' }) },
                { call: 'currency(null)', out: fmt.currency(null) },
            ],
        },
        {
            sig: 'fmt.percent(v, decimals=0, multiply=true)',
            note: 'multiply scales a 0–1 ratio; pass false when the value is already a percentage.',
            samples: [
                { call: 'percent(0.856)', out: fmt.percent(0.856) },
                { call: 'percent(0)', out: fmt.percent(0) },
                { call: 'percent(-0.25)', out: fmt.percent(-0.25) },
                { call: 'percent(85.6, 1, false)', out: fmt.percent(85.6, 1, false) },
                { call: 'percent(null)', out: fmt.percent(null) },
            ],
        },
        {
            sig: 'fmt.compact(v, decimals=1)',
            note: 'Uppercase K/M/B (source casing), capped at B. Below 1,000 the raw number passes through.',
            samples: [
                { call: 'compact(1234)', out: fmt.compact(1234) },
                { call: 'compact(999)', out: fmt.compact(999) },
                { call: 'compact(-2500)', out: fmt.compact(-2500) },
                { call: 'compact(3400000)', out: fmt.compact(3400000) },
                { call: 'compact(1e12)', out: fmt.compact(1e12) },
                { call: 'compact(null)', out: fmt.compact(null) },
            ],
        },
        {
            sig: 'fmt.filesize(v, binary=false, decimals=1)',
            note: 'Decimal units (1000/KB) by default; binary switches to 1024/KiB. Whole bytes stay integral. Caps at TB.',
            samples: [
                { call: 'filesize(1536)', out: fmt.filesize(1536) },
                { call: 'filesize(1536, true)', out: fmt.filesize(1536, true) },
                { call: 'filesize(0)', out: fmt.filesize(0) },
                { call: 'filesize(-500)', out: fmt.filesize(-500) },
                { call: 'filesize(1e15)', out: fmt.filesize(1e15) },
                { call: 'filesize(null)', out: fmt.filesize(null) },
            ],
        },
        {
            sig: 'fmt.ordinal(v, suffixOnly=false)',
            note: 'The suffix is computed on the absolute value, so negatives read -1st rather than the source’s -1th.',
            samples: [
                { call: 'ordinal(1)', out: fmt.ordinal(1) },
                { call: 'ordinal(11)', out: fmt.ordinal(11) },
                { call: 'ordinal(102)', out: fmt.ordinal(102) },
                { call: 'ordinal(0)', out: fmt.ordinal(0) },
                { call: 'ordinal(-1)', out: fmt.ordinal(-1) },
                { call: 'ordinal(null)', out: fmt.ordinal(null) },
            ],
        },
    ];
}

function stringCards(): FmtCard[] {
    return [
        {
            sig: "fmt.code(v, fallback='')",
            note: 'FK-safe display for graph-shaped wire fields: the same field arrives as "GC", {id, code, name, …}, or the bare pk depending on the graph. An object with no usable code/name warns once and falls back.',
            samples: [
                { call: "code('GC')", out: fmt.code('GC') },
                { call: "code({id: 1, code: 'GC', name: 'Gold Coin'})", out: fmt.code({ id: 1, code: 'GC', name: 'Gold Coin' }) },
                { call: "code({name: 'Gold Coin'})", out: fmt.code({ name: 'Gold Coin' }) },
                { call: 'code(3)', out: fmt.code(3) },
                { call: "code({id: 7}, '—')", out: fmt.code({ id: 7 }, '—') },
                { call: 'code(null)', out: fmt.code(null) },
            ],
        },
        {
            sig: "fmt.truncate(v, length=50, suffix='...')",
            note: 'Cuts to length and THEN appends the suffix, so the result runs longer than length (source behavior).',
            samples: [
                { call: 'truncate(sentence, 18)', out: fmt.truncate(SENTENCE, 18) },
                { call: "truncate('short', 18)", out: fmt.truncate('short', 18) },
                { call: "truncate('')", out: fmt.truncate('') },
                { call: 'truncate(null)', out: fmt.truncate(null) },
            ],
        },
        {
            sig: "fmt.truncateMiddle(v, size=8, replace='***')",
            note: 'Keeps both ends so an id stays recognizable; size is the TOTAL kept, split in half.',
            samples: [
                { call: 'truncateMiddle(md5hash)', out: fmt.truncateMiddle(HASH) },
                { call: 'truncateMiddle(md5hash, 16)', out: fmt.truncateMiddle(HASH, 16) },
                { call: "truncateMiddle('abc')", out: fmt.truncateMiddle('abc') },
                { call: 'truncateMiddle(null)', out: fmt.truncateMiddle(null) },
            ],
        },
        {
            sig: "fmt.truncateFront(v, length=8, prefix='...')",
            note: 'Keeps only the tail — for keys whose ending disambiguates.',
            samples: [
                { call: 'truncateFront(apiKey)', out: fmt.truncateFront('sk_live_51H8xQ2eZvKY') },
                { call: 'truncateFront(apiKey, 4)', out: fmt.truncateFront('sk_live_51H8xQ2eZvKY', 4) },
                { call: "truncateFront('abc')", out: fmt.truncateFront('abc') },
                { call: 'truncateFront(null)', out: fmt.truncateFront(null) },
            ],
        },
        {
            sig: "fmt.slug(v, separator='-')",
            note: 'The one documented ’’ fallback (a slug of nothing is nothing). Accents fold to ASCII; the separator is regex-escaped.',
            samples: [
                { call: "slug('Hello World! Café')", out: fmt.slug('Hello World! Café') },
                { call: "slug('  --Mixed__Case--  ')", out: fmt.slug('  --Mixed__Case--  ') },
                { call: "slug('Report 2026', '_')", out: fmt.slug('Report 2026', '_') },
                { call: "slug('***')", out: fmt.slug('***') },
                { call: 'slug(null)', out: fmt.slug(null) },
            ],
        },
        {
            sig: "fmt.mask(v, char='*', showLast=4)",
            note: 'Values no longer than showLast come back intact — there is nothing left to hide.',
            samples: [
                { call: 'mask(cardNumber)', out: fmt.mask('4111111111111111') },
                { call: "mask(apiKey, '•', 6)", out: fmt.mask('sk_live_51H8xQ2eZvKY', '•', 6) },
                { call: "mask('1234')", out: fmt.mask('1234') },
                { call: 'mask(null)', out: fmt.mask(null) },
            ],
        },
        {
            sig: 'fmt.phone(v)',
            note: 'DISPLAY ONLY — E.164 stays the wire shape; django-mojo rejects pretty formats on save. Non-US numbers come back unchanged rather than mangled.',
            samples: [
                { call: "phone('+15555550142')", out: fmt.phone('+15555550142') },
                { call: "phone('5555550142')", out: fmt.phone('5555550142') },
                { call: "phone('+442079460958')", out: fmt.phone('+442079460958') },
                { call: "phone('n/a')", out: fmt.phone('n/a') },
                { call: 'phone(null)', out: fmt.phone(null) },
            ],
        },
    ];
}

function timeCards(): FmtCard[] {
    return [
        {
            sig: "fmt.duration(v, unit='ms', opts?)",
            note: 'Short form is the default (source was long); precision caps the unit count at 2. An unknown unit falls back to ms with one console.warn.',
            samples: [
                { call: 'duration(8040000)', out: fmt.duration(8040000) },
                { call: "duration(8040, 's')", out: fmt.duration(8040, 's') },
                { call: "duration(8040000, 'ms', {short:false})", out: fmt.duration(8040000, 'ms', { short: false }) },
                { call: "duration(90061000, 'ms', {precision:4})", out: fmt.duration(90061000, 'ms', { precision: 4 }) },
                { call: 'duration(500)', out: fmt.duration(500) },
                { call: 'duration(0)', out: fmt.duration(0) },
                { call: 'duration(-3600000)', out: fmt.duration(-3600000) },
                { call: 'duration(null)', out: fmt.duration(null) },
            ],
        },
        {
            sig: 'fmt.relativeShort(v)',
            note: 'Magnitude only — a future date reads the same as a past one. Epoch SECONDS in, like every date formatter here.',
            samples: [
                { call: 'relativeShort(now - 30s)', out: fmt.relativeShort(NOW_SEC - 30) },
                { call: 'relativeShort(now - 3h)', out: fmt.relativeShort(NOW_SEC - 3600 * 3) },
                { call: 'relativeShort(now - 21d)', out: fmt.relativeShort(NOW_SEC - 86400 * 21) },
                { call: 'relativeShort(now - 400d)', out: fmt.relativeShort(NOW_SEC - 86400 * 400) },
                { call: 'relativeShort(now + 10d)', out: fmt.relativeShort(NOW_SEC + 86400 * 10) },
                { call: 'relativeShort(null)', out: fmt.relativeShort(null) },
            ],
        },
        {
            sig: 'fmt.yesNo(v, opts?)',
            note: 'String-false forms and empty collections read No; null/undefined/empty read —, because unset is not the same answer as No.',
            samples: [
                { call: 'yesNo(true)', out: fmt.yesNo(true) },
                { call: 'yesNo(0)', out: fmt.yesNo(0) },
                { call: "yesNo('false')", out: fmt.yesNo('false') },
                { call: 'yesNo([])', out: fmt.yesNo([]) },
                { call: "yesNo(true, {yes:'Active'})", out: fmt.yesNo(true, { yes: 'Active' }) },
                { call: 'yesNo(null)', out: fmt.yesNo(null) },
            ],
        },
        {
            sig: 'fmt.date / datetime / relative / initials',
            note: 'The pre-existing set, for completeness — all epoch-seconds aware (the django-mojo wire shape).',
            samples: [
                { call: 'date(epochSeconds)', out: fmt.date(NOW_SEC) },
                { call: 'datetime(now - 3d)', out: fmt.datetime(NOW_SEC - 86400 * 3) },
                { call: 'relative(now - 21d)', out: fmt.relative(NOW_SEC - 86400 * 21) },
                { call: 'relative(null)', out: fmt.relative(null) },
                { call: "initials('Ada Lovelace')", out: fmt.initials('Ada Lovelace') },
                { call: 'initials(null)', out: fmt.initials(null) },
            ],
        },
    ];
}

export function FormatDemo() {
    return (
        <>
            <div className="panel panel-pad">
                <p className="dim" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                    Every value below is a live call — nothing is transcribed. Two invariants bind the
                    namespace: a formatter <strong>never throws</strong> (bad input degrades to <code>—</code>,
                    or <code>''</code> for <code>slug</code>), and every one formats at a fixed{' '}
                    <code>en-US</code> locale rather than the browser&apos;s. The trailing{' '}
                    <code>fallback</code> param overrides the dash — pass <code>''</code> when composing a
                    string instead of filling a cell.
                </p>
                <p className="dim" style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.6 }}>
                    Deliberately absent: the <strong>pipe-string parser</strong>{' '}
                    (<code>&quot;filesize|muted&quot;</code>) — a do-not-recreate item, since pipe strings
                    defeat the type checker and were the source&apos;s silent-failure vector — and the
                    HTML-emitting formatters (badge, avatar, linkify, clipboard), which are components.
                    Rule-4 warnings (unknown currency code → USD, unknown duration unit → ms) each log{' '}
                    <em>once</em>; they are described here rather than fired, so this page leaves the
                    console clean.
                </p>
            </div>
            <CardGrid title="Numbers" cards={numberCards()} />
            <CardGrid title="Strings" cards={stringCards()} />
            <CardGrid title="Duration, relative age, booleans" cards={timeCards()} />
        </>
    );
}
