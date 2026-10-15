import { SchemaForm, modal, type Field, type FormData } from '../../../ui';
import type { MemberScope } from './member-scope';

/** Focused form stays mounted through the write; abort/dismiss fences its continuations. */
export async function memberForm<T = FormData>(scope: MemberScope, opts: {
    title: string; fields: Field[]; initial?: FormData; submitText?: string;
}, submit?: (data: FormData, current: () => boolean) => Promise<T>): Promise<T | null> {
    let open = true;
    let pending = false;
    const current = () => open && scope.current();
    try {
        return await modal.open<T>((close) => (
            <div className="modal-pad">
                <h2 className="modal-title">{opts.title}</h2>
                <SchemaForm {...opts}
                    onCancel={() => { open = false; close(null as T); }}
                    onBusyChange={(busy) => { pending = busy; }}
                    onSubmit={async (data) => {
                        if (!current() || pending) return;
                        pending = true;
                        try {
                            const result = submit ? await submit(data, current) : data as T;
                            if (current()) close(result);
                        } catch (error) {
                            if (current()) throw error;
                        } finally { pending = false; }
                    }} />
            </div>
        ), { signal: scope.signal, canDismiss: () => !pending });
    } finally { open = false; }
}
