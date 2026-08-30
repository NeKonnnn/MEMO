/** Размер шрифта чата — единый источник + событие вместо N×setInterval. */

export type ChatFontSize = 'small' | 'medium' | 'large';

export const CHAT_FONT_SIZE_KEY = 'chat-font-size';
export const CHAT_FONT_SIZE_EVENT = 'astra-chat-font-size';

export function getChatFontSize(): ChatFontSize {
  const saved = localStorage.getItem(CHAT_FONT_SIZE_KEY) as ChatFontSize | null;
  return saved && ['small', 'medium', 'large'].includes(saved) ? saved : 'medium';
}

export function getChatFontSizeValue(size: ChatFontSize): string {
  switch (size) {
    case 'small':
      return '0.875rem';
    case 'large':
      return '1.125rem';
    default:
      return '1rem';
  }
}

export function setChatFontSize(size: ChatFontSize): void {
  localStorage.setItem(CHAT_FONT_SIZE_KEY, size);
  window.dispatchEvent(new CustomEvent(CHAT_FONT_SIZE_EVENT, { detail: size }));
}
