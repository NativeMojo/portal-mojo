// Metadata — two halves, both from the existing toolkit:
//   · the editable metadata blob via ui's MetadataSection (which IS the
//     AdminMetadataSection port — add/edit/remove, JSON-parsed values,
//     rejected saves keep the editor open), saving through the model cache
//     so every other section sees the new blob;
//   · the whole-record JSON view via DataView (the source section's "JSON
//     dump" reading) — inference-typed grid + collapsible JSON blocks.
import { useQueryClient } from '@tanstack/react-query';
import { DataView, Eyebrow, MetadataSection } from '../../../../ui';
import { UserModel, type UserRow } from '../models';

export function UserMetadataSection({ user, canManage }: { user: UserRow; canManage: boolean }) {
    const qc = useQueryClient();
    return (
        <>
            {canManage && <MetadataSection
                endpoint={UserModel.endpoint}
                id={user.id}
                metadata={(user.metadata ?? {}) as Record<string, unknown>}
                onSaved={(next) => {
                    // Owner write-back: paint the new blob into the one-record
                    // cache, then let invalidation refresh lists.
                    qc.setQueryData(UserModel.keys.one(user.id), { ...user, metadata: next });
                    void UserModel.invalidate(qc);
                }}
            />}

            <Eyebrow>Raw record</Eyebrow>
            <DataView
                data={user as unknown as Record<string, unknown>}
                exclude={['metadata']}
                columns={2}
            />
        </>
    );
}
