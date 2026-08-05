// Password demos — the C3 password piece (ui/password.tsx): live strength
// scoring on the exact web-mojo MOJOUtils semantics, and the crypto-grade
// generator with its full option surface. The reset page pairs both; here
// each contract point is exercised on its own.
//
// MERGE-WIRE: rail — suggested registry entry (Forms group):
//   { key: 'password', title: 'Password tools', icon: 'bi-shield-lock',
//     blurb: 'checkPasswordStrength (web-mojo-exact scoring) + PasswordStrengthMeter + crypto generatePassword — the reset-form pieces.',
//     render: () => <PasswordDemo /> }
import { useState } from 'react';
import { toast } from 'portal-mojo/ui';
// MERGE-WIRE: portal-mojo/ui
import {
    checkPasswordStrength, generatePassword, PasswordStrengthMeter,
    type GeneratePasswordOptions,
} from '../../../../../packages/portal-mojo/src/ui/password';

const SAMPLES: { label: string; value: string }[] = [
    { label: 'common', value: '123456' },
    { label: 'word', value: 'password123' },
    { label: 'short', value: 'aB3!' },
    { label: 'fair', value: 'Zyxwvuts' },
    { label: 'good', value: 'Goodpass!' },
    { label: 'strong', value: 'K7#mQ2vw9$Lp' },
];

function FlagChip({ on, label }: { on: boolean; label: string }) {
    return <span className={`chip ${on ? 'chip-success' : 'chip-muted'}`}>{label}</span>;
}

export function PasswordDemo() {
    const [pw, setPw] = useState('Goodpass!');
    const result = checkPasswordStrength(pw);

    const [len, setLen] = useState(16);
    const [opts, setOpts] = useState({
        includeLowercase: true,
        includeUppercase: true,
        includeNumbers: true,
        includeSpecialChars: true,
        excludeAmbiguous: true,
    });
    const [generated, setGenerated] = useState('');
    const [genError, setGenError] = useState('');

    const generate = () => {
        try {
            const config: GeneratePasswordOptions = { length: len, ...opts };
            const value = generatePassword(config);
            setGenerated(value);
            setGenError('');
        } catch (err) {
            // The two contract throws: length < 4, and no classes selected.
            setGenerated('');
            setGenError(err instanceof Error ? err.message : String(err));
        }
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(generated);
            toast.success('Copied to clipboard');
        } catch {
            toast.error('Clipboard unavailable');
        }
    };

    const toggle = (key: keyof typeof opts) => setOpts((prev) => ({ ...prev, [key]: !prev[key] }));

    return (
        <div className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {/* ── Live scoring ─────────────────────────────────────── */}
            <div>
                <h3 className="panel-subtitle">Strength meter — live scoring</h3>
                <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                        className="input"
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        placeholder="Type a password to score it"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <PasswordStrengthMeter password={pw} />
                    <div className="demo-row">
                        {SAMPLES.map((s) => (
                            <button key={s.label} className="btn btn-compact" onClick={() => setPw(s.value)}>
                                {s.label}
                            </button>
                        ))}
                        <button className="btn btn-compact" onClick={() => setPw('')}>clear</button>
                    </div>
                    <div className="chip-row">
                        <span className="chip chip-primary">score {result.score}</span>
                        <span className="chip chip-primary cap">{result.strength}</span>
                        <FlagChip on={result.details.hasLowercase} label="a-z" />
                        <FlagChip on={result.details.hasUppercase} label="A-Z" />
                        <FlagChip on={result.details.hasNumbers} label="0-9" />
                        <FlagChip on={result.details.hasSpecialChars} label="!@#" />
                        {result.details.hasCommonPatterns && <span className="chip chip-warning">common pattern</span>}
                        {result.details.isCommonPassword && <span className="chip chip-danger">common password</span>}
                    </div>
                </div>
            </div>

            {/* ── Generator ────────────────────────────────────────── */}
            <div>
                <h3 className="panel-subtitle">Generator — crypto RNG, web-mojo option surface</h3>
                <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="demo-row">
                        <label className="page-size">
                            length
                            <input
                                type="range" min={4} max={32} value={len}
                                onChange={(e) => setLen(Number(e.target.value))}
                            />
                            <code>{len}</code>
                        </label>
                    </div>
                    <div className="demo-row">
                        {([
                            ['includeLowercase', 'a-z'],
                            ['includeUppercase', 'A-Z'],
                            ['includeNumbers', '0-9'],
                            ['includeSpecialChars', '!@#'],
                            ['excludeAmbiguous', 'no 0/O/l/1'],
                        ] as const).map(([key, label]) => (
                            <label key={key} className="auth-remember">
                                <input
                                    type="checkbox" className="tbl-check"
                                    checked={opts[key]} onChange={() => toggle(key)}
                                />
                                <span>{label}</span>
                            </label>
                        ))}
                    </div>
                    <div className="demo-row">
                        <button className="btn btn-primary" onClick={generate}>
                            <i className="bi bi-stars" /> Generate
                        </button>
                        {generated && (
                            <>
                                <code className="demo-pre" style={{ margin: 0, padding: '7px 11px', userSelect: 'all' }}>{generated}</code>
                                <button className="btn-icon" title="Copy" onClick={() => void copy()}>
                                    <i className="bi bi-clipboard" />
                                </button>
                                <button className="btn btn-compact" onClick={() => setPw(generated)}>score it</button>
                            </>
                        )}
                    </div>
                    {genError && <div className="form-alert">{genError}</div>}
                    <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>
                        Guarantees carried from web-mojo: one char from every included class, length ≥ 4
                        (below throws), empty pool throws, <code>excludeAmbiguous</code> strips i/l · I/O/L ·
                        0/1 · |. Deviation (documented): crypto.getRandomValues + Fisher–Yates instead of
                        Math.random and a biased sort-shuffle. Turn every class off or drop length under 4
                        to see the contract errors surface.
                    </p>
                </div>
            </div>
        </div>
    );
}
