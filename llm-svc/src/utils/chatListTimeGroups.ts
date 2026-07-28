import type { Chat } from '../contexts/AppContext';

const RU_MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface TimeGroupMeta {
  key: string;
  label: string;
  /** 0 = фиксированные окна; 1 = месяц в текущем году; 2 = календарный год */
  tier: 0 | 1 | 2;
  /** Сортировка внутри tier (меньше — выше в списке) */
  tierSort: number;
}

function getTimeGroupMeta(updatedAtIso: string, now: Date): TimeGroupMeta {
  const raw = new Date(updatedAtIso);
  if (Number.isNaN(raw.getTime())) {
    return { key: 'unknown', label: 'Ранее', tier: 2, tierSort: -9999 };
  }

  const chatDay = startOfLocalDay(raw);
  const today = startOfLocalDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const sevenAgo = new Date(today);
  sevenAgo.setDate(sevenAgo.getDate() - 7);

  const thirtyAgo = new Date(today);
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);

  const cy = today.getFullYear();
  const y = chatDay.getFullYear();
  const m = chatDay.getMonth();

  if (isSameLocalDay(chatDay, today)) {
    return { key: 'today', label: 'Сегодня', tier: 0, tierSort: 0 };
  }

  if (isSameLocalDay(chatDay, yesterday)) {
    return { key: 'yesterday', label: 'Вчера', tier: 0, tierSort: 1 };
  }

  // От позавчера до конца окна «7 дней назад» (без сегодня и вчера)
  if (chatDay.getTime() >= sevenAgo.getTime() && chatDay.getTime() < yesterday.getTime()) {
    return { key: 'last7', label: 'Последние 7 дней', tier: 0, tierSort: 2 };
  }

  // Старше 7‑дневного окна, но не старше 30 дней
  if (chatDay.getTime() >= thirtyAgo.getTime() && chatDay.getTime() < sevenAgo.getTime()) {
    return { key: 'last30', label: 'Последние 30 дней', tier: 0, tierSort: 3 };
  }

  if (y === cy) {
    const label = `${RU_MONTHS[m]} ${y}`;
    return { key: `month-${y}-${m}`, label, tier: 1, tierSort: y * 100 + m };
  }

  return { key: `year-${y}`, label: String(y), tier: 2, tierSort: y };
}

function compareTimeGroups(a: TimeGroupMeta, b: TimeGroupMeta): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.tier === 1) return b.tierSort - a.tierSort;
  if (a.tier === 2) return b.tierSort - a.tierSort;
  return a.tierSort - b.tierSort;
}

export interface SidebarTimeSection<T = Chat> {
  key: string;
  label: string;
  chats: T[];
}

/** Группировка для «Все чаты»: сегодня → вчера → последние 7 дней (без них) → 30 дней → месяцы года → годы. */
export function groupChatsBySidebarTime<T extends { updatedAt: string }>(
  chats: T[],
  now: Date = new Date()
): SidebarTimeSection<T>[] {
  const sorted = [...chats].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const map = new Map<string, { meta: TimeGroupMeta; chats: T[] }>();
  for (const chat of sorted) {
    const meta = getTimeGroupMeta(chat.updatedAt, now);
    const prev = map.get(meta.key);
    if (prev) {
      prev.chats.push(chat);
    } else {
      map.set(meta.key, { meta, chats: [chat] });
    }
  }

  const rows = Array.from(map.values());
  rows.sort((x, y) => compareTimeGroups(x.meta, y.meta));

  return rows.map(({ meta, chats: c }) => ({
    key: meta.key,
    label: meta.label,
    chats: c,
  }));
}
