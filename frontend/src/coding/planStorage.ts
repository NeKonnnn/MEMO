const APPROVED_PLAN_KEY = 'astrachat_coding_approved_plan';
const DRAFT_PLAN_KEY = 'astrachat_coding_draft_plan';

function scopedKey(base: string, chatId: string | null | undefined): string {
  return chatId ? `${base}:${chatId}` : base;
}

export function getApprovedPlan(chatId: string | null | undefined): string {
  try {
    return localStorage.getItem(scopedKey(APPROVED_PLAN_KEY, chatId)) || '';
  } catch {
    return '';
  }
}

export function setApprovedPlan(chatId: string | null | undefined, plan: string): void {
  try {
    const key = scopedKey(APPROVED_PLAN_KEY, chatId);
    const text = (plan || '').trim();
    if (!text) localStorage.removeItem(key);
    else localStorage.setItem(key, text);
    window.dispatchEvent(new CustomEvent('astrachatCodingPlanChanged'));
  } catch {
    /* ignore */
  }
}

export function clearApprovedPlan(chatId: string | null | undefined): void {
  setApprovedPlan(chatId, '');
}

export function getDraftPlan(chatId: string | null | undefined): string {
  try {
    return localStorage.getItem(scopedKey(DRAFT_PLAN_KEY, chatId)) || '';
  } catch {
    return '';
  }
}

export function setDraftPlan(chatId: string | null | undefined, plan: string): void {
  try {
    const key = scopedKey(DRAFT_PLAN_KEY, chatId);
    const text = (plan || '').trim();
    if (!text) localStorage.removeItem(key);
    else localStorage.setItem(key, text);
    window.dispatchEvent(new CustomEvent('astrachatCodingPlanChanged'));
  } catch {
    /* ignore */
  }
}
