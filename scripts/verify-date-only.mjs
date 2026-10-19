// verify:date-only — a date-only value ('YYYY-MM-DD', 'YYYY-MM', 'YYYY') shows
// its own calendar day, month or year in every browser zone (#8626). The
// parent re-runs this file under three TZ values; each child asserts:
//   - fmt.date / fmt.datetime / groupByDay show the value's own fields, at
//     its own precision, with no invented time;
//   - an ISO datetime and an epoch format exactly as v0.2.18 did in that
//     zone (pinned literals, measured on main 60c2f40c);
//   - the form wire round trip for a date-only field returns the same
//     'YYYY-MM-DD' it read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ZONES = ['America/Los_Angeles', 'UTC', 'Asia/Tokyo'];
const self = fileURLToPath(import.meta.url);

if (!process.env.VERIFY_DATE_ONLY_CHILD) {
    let failed = false;
    for (const zone of ZONES) {
        const run = spawnSync(process.execPath, [self], {
            env: { ...process.env, TZ: zone, VERIFY_DATE_ONLY_CHILD: '1' },
            stdio: 'inherit',
        });
        if (run.status !== 0) failed = true;
    }
    if (failed) process.exit(1);
    console.log(`verify:date-only — ${ZONES.length} zones passed`);
    process.exit(0);
}

const { createServer } = await import('vite');
globalThis.window = { setTimeout, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const zone = process.env.TZ;

// What v0.2.18 printed for instants, per zone — these must not move.
const ISO = '2026-10-17T15:30:00Z';
const EPOCH = 1792207800; // 2026-10-17T03:30:00Z: the previous evening in Los Angeles
const PINNED = {
    'America/Los_Angeles': {
        [ISO]: ['10/17/2026', 'Oct 17, 2026, 8:30 AM', '2026-10-17'],
        [EPOCH]: ['10/16/2026', 'Oct 16, 2026, 8:30 PM', '2026-10-16'],
    },
    UTC: {
        [ISO]: ['10/17/2026', 'Oct 17, 2026, 3:30 PM', '2026-10-17'],
        [EPOCH]: ['10/17/2026', 'Oct 17, 2026, 3:30 AM', '2026-10-17'],
    },
    'Asia/Tokyo': {
        [ISO]: ['10/18/2026', 'Oct 18, 2026, 12:30 AM', '2026-10-18'],
        [EPOCH]: ['10/17/2026', 'Oct 17, 2026, 12:30 PM', '2026-10-17'],
    },
};

// The same in every zone: the value's own fields.
const DATE_ONLY = {
    '2026-10-17': ['10/17/2026', 'Oct 17, 2026', '2026-10-17'],
    '2026-03-08': ['03/08/2026', 'Mar 8, 2026', '2026-03-08'],
    '2026-11-01': ['11/01/2026', 'Nov 1, 2026', '2026-11-01'],
    '2026-10': ['10/2026', 'Oct 2026', '2026-10-01'],
    '2026': ['2026', '2026', '2026-01-01'],
};

try {
    const fmt = await server.ssrLoadModule('/packages/portal-mojo/src/ui/format.ts');
    const grouping = await server.ssrLoadModule('/packages/portal-mojo/src/ui/grouping.ts');
    const wire = await server.ssrLoadModule('/packages/portal-mojo/src/ui/field-wire.ts');
    const dayKey = grouping.groupByDay((row) => row.value).groupBy;
    const shown = (value) => [fmt.date(value), fmt.datetime(value), dayKey({ value })];

    for (const [value, expected] of Object.entries(DATE_ONLY)) {
        assert.deepEqual(shown(value), expected, `${zone}: date-only ${value} must show its own day`);
    }
    assert.deepEqual(shown('  2026-10-17 '), DATE_ONLY['2026-10-17'], `${zone}: padded date-only string`);

    const pinned = PINNED[zone];
    assert.ok(pinned, `no pinned literals for zone ${zone}`);
    assert.deepEqual(shown(ISO), pinned[ISO], `${zone}: ISO datetime display changed`);
    assert.deepEqual(shown(EPOCH), pinned[EPOCH], `${zone}: epoch display changed`);
    assert.deepEqual(shown(String(EPOCH)), pinned[EPOCH], `${zone}: epoch-string display changed`);

    assert.equal(fmt.date(null), '—');
    assert.equal(fmt.datetime('not a date', 'x'), 'x');

    // Wire boundary unchanged: a date-only field reads and writes its own day.
    const field = { name: 'dob', type: 'datepicker' };
    const control = wire.wireToField(field, '2026-10-17');
    assert.equal(control, '2026-10-17', `${zone}: wire → control`);
    assert.equal(wire.fieldToWire(field, control), '2026-10-17', `${zone}: control → wire`);
    const epochField = { name: 'as_of', type: 'datepicker' };
    const utcMidnight = Date.UTC(2026, 9, 17) / 1000;
    const fromEpoch = wire.wireToField(epochField, utcMidnight);
    assert.equal(fromEpoch, '2026-10-17', `${zone}: epoch wire → control`);
    assert.equal(wire.fieldToWire(epochField, fromEpoch), utcMidnight, `${zone}: control → epoch wire`);

    console.log(`verify:date-only — ${zone} passed`);
} finally {
    await server.close();
}
