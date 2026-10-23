import type { FetchOpts } from '../../client/client';
import { mojoCall } from '../../client/client';
import { getAssistantSkill } from './api';
import type { AssistantSkill } from './types';

/** Lifecycle writes use existing REST save; conversation history is never removed. */
export async function setAssistantSkillActive(id: number, isActive: boolean, options: Pick<FetchOpts, 'signal' | 'beforeSend'> = {}): Promise<AssistantSkill> {
    await mojoCall(`/api/assistant/skill/${id}`, { ...options, method: 'POST', body: { is_active: isActive } });
    return getAssistantSkill(id, options);
}
