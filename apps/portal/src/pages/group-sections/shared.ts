// group-sections/shared.ts — tiny helpers shared across the group sections.
import type { Params } from 'portal-mojo/client';
import type { Tone } from 'portal-mojo/ui';

/** Audit log level → Timeline tone (GroupView.js LOG_LEVEL_TONE). */
export const LOG_TONE: Record<string, Tone> = {
    error: 'danger',
    critical: 'danger',
    warning: 'warning',
    warn: 'warning',
    info: 'info',
};

/**
 * The group's OBJECT logs — what the source's shared audit collection
 * fetched (LogList {model_name:'account.Group', model_id:<id>}), feeding the
 * Overview activity feed, the Audit timeline, and the Audit rail badge.
 */
export function groupAuditParams(groupId: number): Params {
    return { model_name: 'account.Group', model_id: groupId, sort: '-created' };
}
