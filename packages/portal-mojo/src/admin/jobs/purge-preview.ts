/** A preview is an estimate for an immutable filter tuple, never a snapshot. */
export interface PurgeParameters { daysOld: number; status: string | null }
export interface PurgePreviewIdentity { id: number; params: Readonly<PurgeParameters> }
export function createPurgePreviewGuard() {
    let generation = 0;
    let accepted: PurgePreviewIdentity | null = null;
    let disposed = false;
    return {
        begin(params: PurgeParameters): PurgePreviewIdentity {
            accepted = null;
            return { id: ++generation, params: Object.freeze({ ...params }) };
        },
        accept(identity: PurgePreviewIdentity): boolean {
            if (disposed || identity.id !== generation) return false;
            accepted = identity;
            return true;
        },
        execution(identity: PurgePreviewIdentity): Readonly<PurgeParameters> | null {
            return !disposed && accepted === identity && identity.id === generation ? identity.params : null;
        },
        current(identity: PurgePreviewIdentity) { return !disposed && identity.id === generation; },
        invalidate() { generation++; accepted = null; },
        dispose() { disposed = true; generation++; accepted = null; },
    };
}
