// Password strength + generation — ported from web-mojo MOJOUtils
// (src/core/utils/MOJOUtils.js: checkPasswordStrength, generatePassword).
// The REST of MOJOUtils stays unported (sweep verdict: bulk fails the value
// bar); these two earn their port as the C3 reset-form pieces.
//
// Porting notes:
//   · checkPasswordStrength keeps the EXACT scoring semantics — length
//     bands, +1/+1/+1/+2 variety, the -1 common-pattern penalty (applied
//     once), the -3 common-password floor at 0, the same strength
//     thresholds and the same feedback strings. The returned score is
//     floored at 0 (source parity) but the strength class is derived from
//     the raw (possibly negative) running score, exactly like the source.
//   · generatePassword keeps the option surface and guarantees (defaults,
//     charsets, excludeAmbiguous strips, customChars override that SKIPS
//     the per-class required chars, min-length-4 throw, empty-pool throw,
//     one guaranteed char per included class, final shuffle) — but draws
//     randomness from crypto.getRandomValues. web-mojo used Math.random and
//     a `sort(() => Math.random() - 0.5)` shuffle — a non-crypto RNG plus a
//     biased shuffle is a trap deliberately NOT carried into a password
//     generator (Fisher–Yates over rejection-sampled uniform draws here).

// ── checkPasswordStrength ─────────────────────────────────────────────

export type PasswordStrengthClass = 'invalid' | 'very-weak' | 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordStrengthDetails {
    length: number;
    hasLowercase: boolean;
    hasUppercase: boolean;
    hasNumbers: boolean;
    hasSpecialChars: boolean;
    hasCommonPatterns: boolean;
    isCommonPassword: boolean;
}

export interface PasswordStrength {
    /** Final score, floored at 0. Practical range 0–9. */
    score: number;
    strength: PasswordStrengthClass;
    feedback: string[];
    details: PasswordStrengthDetails;
}

const COMMON_PATTERNS: RegExp[] = [
    /123/,          // sequential numbers
    /abc/i,         // sequential letters
    /qwerty/i,      // keyboard patterns
    /asdf/i,        // keyboard patterns
    /(.)\1{2,}/,    // repeated characters (aaa, 111)
    /password/i,
    /admin/i,
    /user/i,
    /login/i,
];

const COMMON_PASSWORDS = [
    '123456', 'password', '123456789', '12345678', '12345',
    '1234567', '1234567890', 'qwerty', 'abc123', '111111',
    '123123', 'admin', 'letmein', 'welcome', 'monkey',
    'password123', '123qwe', 'qwerty123', '000000', 'dragon',
    'sunshine', 'princess', 'azerty', '1234', 'iloveyou',
    'trustno1', 'superman', 'shadow', 'master', 'jennifer',
];

/** Score a password. Exact web-mojo semantics — see the header note. */
export function checkPasswordStrength(password: string): PasswordStrength {
    if (!password || typeof password !== 'string') {
        return {
            score: 0,
            strength: 'invalid',
            feedback: ['Password must be a non-empty string'],
            details: {
                length: 0,
                hasLowercase: false,
                hasUppercase: false,
                hasNumbers: false,
                hasSpecialChars: false,
                hasCommonPatterns: false,
                isCommonPassword: false,
            },
        };
    }

    const feedback: string[] = [];
    const details: PasswordStrengthDetails = {
        length: password.length,
        hasLowercase: /[a-z]/.test(password),
        hasUppercase: /[A-Z]/.test(password),
        hasNumbers: /[0-9]/.test(password),
        hasSpecialChars: /[^a-zA-Z0-9]/.test(password),
        hasCommonPatterns: false,
        isCommonPassword: false,
    };

    let score = 0;

    // Length scoring
    if (password.length < 6) {
        feedback.push('Password should be at least 6 characters long');
    } else if (password.length < 8) {
        score += 1;
        feedback.push('Consider using at least 8 characters for better security');
    } else if (password.length < 12) {
        score += 3;
    } else {
        score += 4;
    }

    // Character variety scoring
    if (details.hasLowercase) score += 1;
    else feedback.push('Include lowercase letters');

    if (details.hasUppercase) score += 1;
    else feedback.push('Include uppercase letters');

    if (details.hasNumbers) score += 1;
    else feedback.push('Include numbers');

    if (details.hasSpecialChars) score += 2;
    else feedback.push('Include special characters (!@#$%^&* etc.)');

    // Common patterns: at most ONE -1, first match breaks (source parity).
    for (const pattern of COMMON_PATTERNS) {
        if (pattern.test(password)) {
            details.hasCommonPatterns = true;
            score -= 1;
            feedback.push('Avoid common patterns and dictionary words');
            break;
        }
    }

    if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
        details.isCommonPassword = true;
        score = Math.max(0, score - 3);
        feedback.push('This password is too common and easily guessed');
    }

    // Strength class from the RAW running score (can sit below 0 here).
    let strength: PasswordStrengthClass;
    if (score < 2) strength = 'very-weak';
    else if (score < 4) strength = 'weak';
    else if (score < 6) strength = 'fair';
    else if (score < 8) strength = 'good';
    else strength = 'strong';

    // Positive feedback for strong passwords (source-exact conditions).
    if (score >= 7 && feedback.length === 0) {
        feedback.push('Strong password! Consider using a password manager.');
    } else if (score >= 5 && feedback.length <= 1) {
        feedback.push('Good password strength. Consider adding more variety.');
    }

    return { score: Math.max(0, score), strength, feedback, details };
}

// ── generatePassword ──────────────────────────────────────────────────

export interface GeneratePasswordOptions {
    /** Password length (default 12; minimum 4 — below throws). */
    length?: number;
    includeLowercase?: boolean;
    includeUppercase?: boolean;
    includeNumbers?: boolean;
    includeSpecialChars?: boolean;
    /** Custom character pool; when set, the include* flags and the
     *  one-per-class guarantee are skipped (source parity). */
    customChars?: string;
    /** Strip look-alikes: i/l, I/O/L, 0/1, | (source's exact strip sets). */
    excludeAmbiguous?: boolean;
}

/** Uniform integer in [0, max) via rejection sampling over crypto RNG. */
function randomIndex(max: number): number {
    if (max <= 0) throw new Error('randomIndex: empty range');
    const limit = Math.floor(0x100000000 / max) * max; // largest multiple of max
    const buf = new Uint32Array(1);
    for (;;) {
        crypto.getRandomValues(buf);
        const v = buf[0]!;
        if (v < limit) return v % max;
    }
}

function pick(pool: string): string {
    return pool[randomIndex(pool.length)]!;
}

/**
 * Generate a password. Option semantics are web-mojo-exact (see header);
 * randomness is crypto-grade (the one documented deviation).
 */
export function generatePassword(options: GeneratePasswordOptions = {}): string {
    const config = {
        length: 12,
        includeLowercase: true,
        includeUppercase: true,
        includeNumbers: true,
        includeSpecialChars: true,
        customChars: '',
        excludeAmbiguous: false,
        ...options,
    };

    if (config.length < 4) {
        throw new Error('Password length must be at least 4 characters');
    }

    let lowercase = 'abcdefghijklmnopqrstuvwxyz';
    let uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let numbers = '0123456789';
    let specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (config.excludeAmbiguous) {
        lowercase = lowercase.replace(/[il]/g, '');
        uppercase = uppercase.replace(/[IOL]/g, '');
        numbers = numbers.replace(/[01]/g, '');
        specialChars = specialChars.replace(/[|]/g, '');
    }

    let charPool = '';
    const requiredChars: string[] = [];

    if (config.customChars) {
        charPool = config.customChars;
    } else {
        if (config.includeLowercase) { charPool += lowercase; requiredChars.push(pick(lowercase)); }
        if (config.includeUppercase) { charPool += uppercase; requiredChars.push(pick(uppercase)); }
        if (config.includeNumbers) { charPool += numbers; requiredChars.push(pick(numbers)); }
        if (config.includeSpecialChars) { charPool += specialChars; requiredChars.push(pick(specialChars)); }
    }

    if (!charPool) {
        throw new Error('No character types selected for password generation');
    }

    const chars: string[] = [...requiredChars];
    while (chars.length < config.length) chars.push(pick(charPool));

    // Fisher–Yates (web-mojo's sort(() => Math.random() - 0.5) is biased).
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
}

// ── PasswordStrengthMeter ─────────────────────────────────────────────

const STRENGTH_LABEL: Record<PasswordStrengthClass, string> = {
    invalid: 'Enter a password',
    'very-weak': 'Very weak',
    weak: 'Weak',
    fair: 'Fair',
    good: 'Good',
    strong: 'Strong',
};

const STRENGTH_SEGMENTS: Record<PasswordStrengthClass, number> = {
    invalid: 0, 'very-weak': 1, weak: 2, fair: 3, good: 4, strong: 5,
};

export interface PasswordStrengthMeterProps {
    password: string;
    /** Show the scoring feedback lines under the bar. Default true. */
    showFeedback?: boolean;
    className?: string;
}

/**
 * Live strength meter: 5-segment bar + label + feedback, colored by tokens
 * (very-weak/weak → --bad, fair → --warn, good → --info, strong → --ok) via
 * the `data-strength` attribute — both themes for free. Scoring is exactly
 * `checkPasswordStrength`; the ONE presentation nicety is that an empty
 * password renders as an unlit idle state instead of the scorer's
 * "must be a non-empty string" complaint.
 */
export function PasswordStrengthMeter({ password, showFeedback = true, className }: PasswordStrengthMeterProps) {
    const result = checkPasswordStrength(password);
    const empty = password.length === 0;
    const strength: PasswordStrengthClass = empty ? 'invalid' : result.strength;
    const lit = STRENGTH_SEGMENTS[strength];

    return (
        <div className={`pw-meter${className ? ` ${className}` : ''}`} data-strength={strength}>
            <div className="pw-meter-bars" role="meter" aria-label="Password strength"
                aria-valuemin={0} aria-valuemax={5} aria-valuenow={lit} aria-valuetext={STRENGTH_LABEL[strength]}>
                {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={`pw-meter-seg${n <= lit ? ' pw-meter-lit' : ''}`} />
                ))}
            </div>
            <div className="pw-meter-row">
                <span className="pw-meter-label">{STRENGTH_LABEL[strength]}</span>
                {!empty && <span className="pw-meter-score">{result.score}</span>}
            </div>
            {showFeedback && !empty && result.feedback.length > 0 && (
                <ul className="pw-meter-feedback">
                    {result.feedback.map((line) => <li key={line}>{line}</li>)}
                </ul>
            )}
        </div>
    );
}
