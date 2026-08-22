import { useEffect, useState } from 'react';
import {
  getActiveSkillRefs,
  SKILL_SELECTION_CHANGED_EVENT,
  type ActiveSkillRef,
} from '../utils/skillSelectionStorage';

/** Активные skills текущего чата из localStorage + событие выбора. */
export function useActiveSkillIndicators(chatId?: string | null): ActiveSkillRef[] {
  const [skills, setSkills] = useState<ActiveSkillRef[]>(() => getActiveSkillRefs(chatId));

  useEffect(() => {
    const sync = (e?: Event) => {
      const detailChatId = (e as CustomEvent<{ chatId?: string }> | undefined)?.detail?.chatId;
      if (detailChatId && chatId && detailChatId !== chatId) return;
      setSkills(getActiveSkillRefs(chatId));
    };
    sync();
    window.addEventListener(SKILL_SELECTION_CHANGED_EVENT, sync as EventListener);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SKILL_SELECTION_CHANGED_EVENT, sync as EventListener);
      window.removeEventListener('storage', sync);
    };
  }, [chatId]);

  return skills;
}
