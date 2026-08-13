// Rule-4 warnings (unknown value → default + console.warn) fire from render
// paths, so a table would flood the console. One warning per distinct message.
// Shared by format.ts and safe-node.tsx; other modules keep local copies with
// differing signatures (DataView's takes an err arg) — consolidating them is a
// separate cleanup.
const warned = new Set<string>();

export function warnOnce(message: string): void {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(message);
}
