import { useEffect, useState } from 'react';
import {
  CHAT_FONT_SIZE_EVENT,
  CHAT_FONT_SIZE_KEY,
  getChatFontSize,
  getChatFontSizeValue,
  type ChatFontSize,
} from '../utils/chatFontSize';

/** Подписка на размер шрифта чата без polling localStorage. */
export function useChatFontSize(): { fontSize: ChatFontSize; fontSizeValue: string } {
  const [fontSize, setFontSize] = useState<ChatFontSize>(() => getChatFontSize());

  useEffect(() => {
    const apply = (next?: ChatFontSize) => {
      setFontSize(next && ['small', 'medium', 'large'].includes(next) ? next : getChatFontSize());
    };

    const onCustom = (e: Event) => {
      apply((e as CustomEvent<ChatFontSize>).detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === CHAT_FONT_SIZE_KEY || e.key === null) apply();
    };

    window.addEventListener(CHAT_FONT_SIZE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHAT_FONT_SIZE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return { fontSize, fontSizeValue: getChatFontSizeValue(fontSize) };
}
