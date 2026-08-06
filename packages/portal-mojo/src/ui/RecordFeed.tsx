import {
    useLayoutEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    RecordFeedAdapter,
    RecordFeedAuthor,
    RecordFeedId,
    RecordFeedItem,
    RecordFeedPage,
} from '../client/record-feed';
import { MarkdownView } from './MarkdownView';
import { initials, relative } from './format';

interface RecordFeedCommonProps {
    variant?: 'compact' | 'bubbles';
    currentUserId?: RecordFeedId | null;
    currentUser?: RecordFeedAuthor;
    className?: string;
    showInput?: boolean;
    placeholder?: string;
    sendLabel?: string;
    emptyLabel?: string;
    ariaLabel?: string;
    /** Extra item content (actions, reference cards, tool summaries). */
    renderAddon?: (item: RecordFeedItem) => ReactNode;
    /** Thinking/streaming state rendered after the item list. */
    pending?: ReactNode;
    disabled?: boolean;
}

export interface AdapterRecordFeedProps extends RecordFeedCommonProps {
    adapter: RecordFeedAdapter;
    items?: never;
    onSend?: never;
    isSending?: never;
    error?: never;
}

export interface ControlledRecordFeedProps extends RecordFeedCommonProps {
    adapter?: never;
    items: readonly RecordFeedItem[];
    onSend: (text: string) => void | Promise<void>;
    isSending?: boolean;
    error?: ReactNode;
}

export type RecordFeedProps = AdapterRecordFeedProps | ControlledRecordFeedProps;

interface ComposerProps {
    draft: string;
    setDraft: (value: string) => void;
    onSubmit: (text: string, originalDraft: string) => void;
    busy: boolean;
    disabled: boolean;
    placeholder: string;
    sendLabel: string;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function Composer({
    draft,
    setDraft,
    onSubmit,
    busy,
    disabled,
    placeholder,
    sendLabel,
    textareaRef,
}: ComposerProps) {
    const draftId = useId();
    useLayoutEffect(() => {
        const input = textareaRef.current;
        if (!input) return;
        input.style.height = 'auto';
        const capped = Math.min(input.scrollHeight, 144);
        input.style.height = `${Math.max(capped, 38)}px`;
        input.style.overflowY = input.scrollHeight > 144 ? 'auto' : 'hidden';
    }, [draft, textareaRef]);

    const submit = (event?: FormEvent) => {
        event?.preventDefault();
        const text = draft.trim();
        if (!text || busy || disabled) return;
        onSubmit(text, draft);
    };

    const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const native = event.nativeEvent as globalThis.KeyboardEvent;
        if (
            event.key === 'Enter'
            && !event.shiftKey
            && !event.isDefaultPrevented()
            && !event.currentTarget.disabled
            && !native.isComposing
        ) {
            event.preventDefault();
            submit();
        }
    };

    return (
        <form className="record-feed-composer" onSubmit={submit}>
            <label className="sr-only" htmlFor={draftId}>Add a note</label>
            <textarea
                id={draftId}
                ref={textareaRef}
                className="record-feed-input"
                rows={1}
                value={draft}
                placeholder={placeholder}
                disabled={busy || disabled}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={keyDown}
            />
            <button
                className="record-feed-send"
                type="submit"
                disabled={busy || disabled || !draft.trim()}
                aria-label={busy ? 'Sending note' : sendLabel}
            >
                <i className={`bi ${busy ? 'bi-arrow-repeat record-feed-spin' : 'bi-send-fill'}`} aria-hidden="true" />
                <span>{busy ? 'Sending…' : sendLabel}</span>
            </button>
            <span className="record-feed-composer-hint">Enter to send · Shift+Enter for a new line</span>
        </form>
    );
}

function Avatar({ item, mine }: { item: RecordFeedItem; mine: boolean }) {
    if (item.kind === 'assistant') {
        return <span className="record-feed-avatar record-feed-avatar-assistant" aria-hidden="true"><i className="bi bi-stars" /></span>;
    }
    if (item.author.avatarUrl) {
        return <img className="record-feed-avatar" src={item.author.avatarUrl} alt="" />;
    }
    return (
        <span className={`record-feed-avatar${mine ? ' record-feed-avatar-mine' : ''}`} aria-hidden="true">
            {initials(item.author.name)}
        </span>
    );
}

function StatusItem({ item }: { item: Extract<RecordFeedItem, { kind: 'status' }> }) {
    return (
        <div className="record-feed-event-content">
            <i className="bi bi-arrow-left-right" aria-hidden="true" />
            <span>Status changed</span>
            <span className="record-feed-status">{item.from ?? 'unknown'}</span>
            <i className="bi bi-arrow-right" aria-hidden="true" />
            <span className="record-feed-status record-feed-status-to">{item.to ?? 'unknown'}</span>
            <time dateTime={wireDateTime(item.created)}>{relative(item.created)}</time>
        </div>
    );
}

function SystemItem({ item }: { item: Extract<RecordFeedItem, { kind: 'system' }> }) {
    return (
        <div className="record-feed-event-content">
            <i className="bi bi-info-circle" aria-hidden="true" />
            {item.event && <span className="record-feed-event-kind">{item.event.replaceAll('_', ' ')}</span>}
            <span className="record-feed-event-note">{item.content || 'System activity'}</span>
            <time dateTime={wireDateTime(item.created)}>{relative(item.created)}</time>
        </div>
    );
}

function wireDateTime(value: number | string): string {
    const parsed = typeof value === 'number'
        ? new Date(value < 1e12 ? value * 1000 : value)
        : new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function FeedItem({
    item,
    variant,
    currentUserId,
    renderAddon,
}: {
    item: RecordFeedItem;
    variant: 'compact' | 'bubbles';
    currentUserId?: RecordFeedId | null;
    renderAddon?: (item: RecordFeedItem) => ReactNode;
}) {
    if (item.kind === 'status') {
        return <li className="record-feed-event record-feed-event-status"><StatusItem item={item} /></li>;
    }
    if (item.kind === 'system') {
        return <li className="record-feed-event"><SystemItem item={item} /></li>;
    }

    const mine = item.kind === 'comment'
        && currentUserId !== null
        && currentUserId !== undefined
        && item.author.id === currentUserId;
    const displayName = item.kind === 'assistant' ? 'AI Agent' : item.author.name;
    const addon = renderAddon?.(item);

    return (
        <li
            className={[
                'record-feed-message',
                mine ? 'record-feed-message-mine' : null,
                item.kind === 'assistant' ? 'record-feed-message-assistant' : null,
                item.pending ? 'record-feed-message-pending' : null,
                variant === 'bubbles' ? 'record-feed-message-bubble' : null,
            ].filter(Boolean).join(' ')}
            aria-label={`${displayName}, ${relative(item.created)}${item.pending ? ', sending' : ''}`}
        >
            <Avatar item={item} mine={mine} />
            <div className="record-feed-message-main">
                <div className="record-feed-message-meta">
                    <strong>{displayName}</strong>
                    {mine && <span className="record-feed-you">You</span>}
                    {item.pending && <span className="record-feed-pending-label">Sending…</span>}
                    <time dateTime={wireDateTime(item.created)}>{relative(item.created)}</time>
                </div>
                <div className="record-feed-message-body">
                    <MarkdownView source={item.content} renderer="client" />
                </div>
                {addon && <div className="record-feed-addon">{addon}</div>}
            </div>
        </li>
    );
}

interface FeedFrameProps extends RecordFeedCommonProps {
    items: readonly RecordFeedItem[];
    loading?: boolean;
    loadError?: Error | null;
    onRetry?: () => void;
    hasEarlier?: boolean;
    mutationError?: ReactNode;
    sending: boolean;
    draft: string;
    setDraft: (value: string) => void;
    onSubmit: (text: string, originalDraft: string) => void;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    ownSendRef: React.MutableRefObject<boolean>;
}

function FeedFrame({
    items,
    variant = 'compact',
    currentUserId,
    className,
    showInput = true,
    placeholder = 'Add a note…',
    sendLabel = 'Send',
    emptyLabel = 'No activity yet.',
    ariaLabel = 'Record activity',
    renderAddon,
    pending,
    disabled = false,
    loading = false,
    loadError,
    onRetry,
    hasEarlier = false,
    mutationError,
    sending,
    draft,
    setDraft,
    onSubmit,
    textareaRef,
    ownSendRef,
}: FeedFrameProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const nearBottomRef = useRef(true);
    const initialPinRef = useRef(false);
    const signature = useMemo(
        () => items.map((item) => `${item.id}:${item.content.length}:${item.pending ? 1 : 0}`).join('|'),
        [items],
    );

    useLayoutEffect(() => {
        const scroll = scrollRef.current;
        if (!scroll || loading) return;
        const shouldPin = !initialPinRef.current || ownSendRef.current || nearBottomRef.current;
        initialPinRef.current = true;
        ownSendRef.current = false;
        if (!shouldPin) return;
        const frame = requestAnimationFrame(() => {
            scroll.scrollTop = scroll.scrollHeight;
            nearBottomRef.current = true;
        });
        return () => cancelAnimationFrame(frame);
    }, [signature, Boolean(pending), loading, ownSendRef]);

    const onScroll = () => {
        const scroll = scrollRef.current;
        if (!scroll) return;
        nearBottomRef.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 48;
    };

    return (
        <section className={`record-feed record-feed-${variant}${className ? ` ${className}` : ''}`} aria-label={ariaLabel}>
            <div
                ref={scrollRef}
                className="record-feed-scroll"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-busy={loading || sending || undefined}
                onScroll={onScroll}
            >
                {hasEarlier && <div className="record-feed-earlier">Showing the latest 100 of this record’s activity</div>}
                {loading ? (
                    <div className="record-feed-state" role="status"><i className="bi bi-arrow-repeat record-feed-spin" /> Loading activity…</div>
                ) : loadError ? (
                    <div className="record-feed-state record-feed-error" role="alert">
                        <span>{loadError.message || 'Could not load activity.'}</span>
                        {onRetry && <button className="btn btn-compact" type="button" onClick={onRetry}>Retry</button>}
                    </div>
                ) : items.length === 0 && !pending ? (
                    <div className="record-feed-state">{emptyLabel}</div>
                ) : (
                    <ol className="record-feed-list" role="list">
                        {items.map((item) => (
                            <FeedItem
                                key={item.id}
                                item={item}
                                variant={variant}
                                currentUserId={currentUserId}
                                renderAddon={renderAddon}
                            />
                        ))}
                    </ol>
                )}
                {pending && <div className="record-feed-thinking" role="status">{pending}</div>}
            </div>
            {mutationError && <div className="record-feed-mutation-error" role="alert">{mutationError}</div>}
            {showInput && (
                <Composer
                    draft={draft}
                    setDraft={setDraft}
                    onSubmit={onSubmit}
                    busy={sending}
                    disabled={disabled || Boolean(loadError)}
                    placeholder={placeholder}
                    sendLabel={sendLabel}
                    textareaRef={textareaRef}
                />
            )}
        </section>
    );
}

interface MutationContext {
    snapshot: RecordFeedPage | undefined;
    tempId: string;
}

interface SendVariables {
    text: string;
}

function AdapterFeed(props: AdapterRecordFeedProps) {
    const { adapter } = props;
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const ownSendRef = useRef(false);
    // The unsanitized restoration draft stays component-local. It never enters
    // MutationCache or Query cache for sensitive adapters.
    const restoreDraftRef = useRef('');
    const query = useQuery({
        queryKey: adapter.queryKey,
        queryFn: () => adapter.fetch(),
    });
    const author = props.currentUser ?? {
        id: props.currentUserId ?? null,
        name: 'You',
    };

    const mutation = useMutation<RecordFeedItem, Error, SendVariables, MutationContext>({
        mutationFn: ({ text }) => adapter.addNote(text),
        onMutate: async ({ text }) => {
            await queryClient.cancelQueries({ queryKey: adapter.queryKey, exact: true });
            const snapshot = queryClient.getQueryData<RecordFeedPage>(adapter.queryKey);
            const tempId = `record-feed-temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const temporary: RecordFeedItem = {
                id: tempId,
                kind: 'comment',
                created: Math.floor(Date.now() / 1000),
                content: text,
                author,
                metadata: {},
                raw: {},
                pending: true,
            };
            queryClient.setQueryData<RecordFeedPage>(adapter.queryKey, (current) => ({
                items: [...(current?.items ?? []), temporary],
                count: (current?.count ?? 0) + 1,
                hasEarlier: current?.hasEarlier ?? false,
            }));
            return { snapshot, tempId };
        },
        onSuccess: (saved, _variables, context) => {
            queryClient.setQueryData<RecordFeedPage>(adapter.queryKey, (current) => {
                if (!current) return { items: [saved], count: 1, hasEarlier: false };
                const found = current.items.some((item) => item.id === context.tempId);
                return {
                    ...current,
                    items: found
                        ? current.items.map((item) => item.id === context.tempId ? saved : item)
                        : [...current.items, saved],
                };
            });
            requestAnimationFrame(() => textareaRef.current?.focus());
        },
        onError: (_error, _variables, context) => {
            if (context?.snapshot) {
                queryClient.setQueryData(adapter.queryKey, context.snapshot);
            } else {
                queryClient.removeQueries({ queryKey: adapter.queryKey, exact: true });
            }
            setDraft(restoreDraftRef.current);
            requestAnimationFrame(() => textareaRef.current?.focus());
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: adapter.queryKey, exact: true });
        },
    });

    const changeDraft = (value: string) => {
        if (mutation.error) mutation.reset();
        setDraft(value);
    };
    const submit = (text: string, originalDraft: string) => {
        if (mutation.isPending) return;
        ownSendRef.current = true;
        restoreDraftRef.current = originalDraft;
        setDraft('');
        mutation.mutate({ text: adapter.sanitizeDraft ? adapter.sanitizeDraft(text) : text });
    };

    return (
        <FeedFrame
            {...props}
            items={query.data?.items ?? []}
            loading={query.isPending}
            loadError={query.error}
            onRetry={() => { void query.refetch(); }}
            hasEarlier={query.data?.hasEarlier}
            mutationError={mutation.error?.message}
            sending={mutation.isPending}
            draft={draft}
            setDraft={changeDraft}
            onSubmit={submit}
            textareaRef={textareaRef}
            ownSendRef={ownSendRef}
        />
    );
}

function ControlledFeed(props: ControlledRecordFeedProps) {
    const [draft, setDraft] = useState('');
    const [localSending, setLocalSending] = useState(false);
    const [localError, setLocalError] = useState<Error | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const ownSendRef = useRef(false);
    const sending = Boolean(props.isSending) || localSending;

    const changeDraft = (value: string) => {
        setLocalError(null);
        setDraft(value);
    };
    const submit = (text: string, originalDraft: string) => {
        if (sending) return;
        ownSendRef.current = true;
        setDraft('');
        setLocalError(null);
        setLocalSending(true);
        Promise.resolve().then(() => props.onSend(text)).then(
            () => requestAnimationFrame(() => textareaRef.current?.focus()),
            (error: unknown) => {
                setDraft(originalDraft);
                setLocalError(error instanceof Error ? error : new Error(String(error)));
                requestAnimationFrame(() => textareaRef.current?.focus());
            },
        ).finally(() => setLocalSending(false));
    };

    return (
        <FeedFrame
            {...props}
            items={props.items}
            mutationError={props.error ?? localError?.message}
            sending={sending}
            draft={draft}
            setDraft={changeDraft}
            onSubmit={submit}
            textareaRef={textareaRef}
            ownSendRef={ownSendRef}
        />
    );
}

/**
 * Record-scoped activity/comment feed. Adapter mode owns Query + exact
 * optimistic cache behavior; controlled mode is ready for streaming owners.
 */
export function RecordFeed(props: RecordFeedProps) {
    return 'adapter' in props && props.adapter
        // A record/group switch is a new composer and scroll context, not
        // just a new Query. Remounting on the structural key prevents draft,
        // mutation/error, and bottom-pin refs from crossing records.
        ? <AdapterFeed key={JSON.stringify(props.adapter.queryKey)} {...props} />
        : <ControlledFeed {...props as ControlledRecordFeedProps} />;
}
