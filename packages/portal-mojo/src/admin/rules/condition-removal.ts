/** Empty ALL and ANY condition sets both match every event server-side. */
export function conditionRemovalEffect(parent: { match_by: number; is_active: boolean }, count: number, selected: number): string {
    if (parent.match_by !== 0 && parent.match_by !== 1) throw new Error('Unknown matching mode; refresh and inspect before removing conditions.');
    if (selected < 1 || selected > count) throw new Error('Condition selection changed; refresh before removing conditions.');
    if (count === selected) return `${parent.is_active ? 'This active' : 'This inactive'} rule set becomes catch-all: either matching mode accepts every event without conditions.`;
    return parent.match_by === 0 ? 'ALL mode: removal broadens matching because fewer conditions must hold.' : 'ANY mode: removal narrows matching because fewer alternatives can match.';
}
