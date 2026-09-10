import { mojoCall } from '../../client/runtime';
import { getAssistantSkill } from './api';
import type { AssistantSkill } from './types';

/** Lifecycle writes use existing REST save; conversation history is never removed. */
export async function setAssistantSkillActive(id: number, isActive: boolean): Promise<AssistantSkill> {
    await mojoCall(`/api/assistant/skill/${id}`, { method: 'POST', body: { is_active: isActive } });
    return getAssistantSkill(id);
}
