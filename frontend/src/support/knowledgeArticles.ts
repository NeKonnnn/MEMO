/**
 * Прототип базы знаний для виджета поддержки.
 * Позже статьи переедут в RAG (отдельная коллекция / KB) или markdown в репозитории.
 */

export type SupportArticle = {
  id: string;
  /** Короткие фразы/слова, по которым прототип находит статью без LLM */
  keywords: string[];
  title: string;
  /** Пошаговая инструкция для пользователя */
  steps: string[];
  /** Опционально: куда смотреть на экране */
  uiHints?: string[];
};

export const SUPPORT_ARTICLES: SupportArticle[] = [
  {
    id: 'create-chat',
    keywords: ['чат', 'новый чат', 'создать чат', 'начать диалог', 'переписка'],
    title: 'Как создать новый чат',
    steps: [
      'В левой панели найдите кнопку «Новый чат» (обычно вверху списка чатов).',
      'Нажмите на неё — откроется пустой диалог.',
      'Введите сообщение в поле ввода внизу и отправьте.',
    ],
    uiHints: ['Левая боковая панель → «Новый чат»', 'Поле ввода внизу рабочей зоны'],
  },
  {
    id: 'settings',
    keywords: ['настройки', 'параметры', 'тема', 'тёмная', 'светлая', 'settings'],
    title: 'Как открыть настройки',
    steps: [
      'Откройте левую панель, если она скрыта.',
      'Найдите пункт «Настройки» (или нажмите горячую клавишу Alt+S).',
      'Выберите нужный раздел: интерфейс, модели, RAG и т.д.',
    ],
    uiHints: ['Левая панель → Настройки', 'Горячая клавиша Alt+S'],
  },
  {
    id: 'knowledge-base',
    keywords: ['база знаний', 'бз', 'документы', 'загрузить файл', 'rag', 'knowledge'],
    title: 'Как работать с Базой знаний',
    steps: [
      'Откройте инструменты у поля ввода чата (иконка шестерёнки / «Инструменты»).',
      'Подключите Базу знаний или загрузите документы в раздел БЗ.',
      'Задайте вопрос в чате — модель ответит с опорой на загруженные материалы.',
    ],
    uiHints: ['Поле ввода → Инструменты → База знаний'],
  },
  {
    id: 'agents',
    keywords: ['агент', 'агенты', 'конструктор', 'gallery', 'галерея агентов'],
    title: 'Как выбрать или настроить агента',
    steps: [
      'Откройте «Инструменты» у поля ввода.',
      'Перейдите в раздел «Агенты».',
      'Выберите своего агента или откройте галерею / конструктор для настройки.',
    ],
    uiHints: ['Поле ввода → Инструменты → Агенты'],
  },
  {
    id: 'support-widget',
    keywords: ['помощь', 'поддержка', 'справка', 'help', 'инструкция', 'как пользоваться'],
    title: 'Как пользоваться этим помощником',
    steps: [
      'Нажмите круглую кнопку помощи в правом нижнем углу.',
      'Опишите задачу своими словами, например: «как создать чат».',
      'Следуйте шагам в ответе. Окно можно свернуть той же кнопкой.',
    ],
    uiHints: ['Правый нижний угол экрана → кнопка помощи'],
  },
];

const FALLBACK: SupportArticle = {
  id: 'fallback',
  keywords: [],
  title: 'Не нашёл точную инструкцию',
  steps: [
    'Попробуйте переформулировать вопрос короче, например: «настройки», «новый чат», «база знаний», «агент».',
    'В прототипе поиск идёт по ключевым словам без LLM — позже ответ будет строить модель по полной базе инструкций.',
  ],
  uiHints: ['Правый нижний угол → виджет поддержки'],
};

/** Простой матчер для прототипа (без LLM). */
export function findSupportArticle(question: string): SupportArticle {
  const q = question.trim().toLowerCase();
  if (!q) return FALLBACK;

  let best: SupportArticle | null = null;
  let bestScore = 0;

  for (const article of SUPPORT_ARTICLES) {
    let score = 0;
    for (const kw of article.keywords) {
      if (q.includes(kw.toLowerCase())) {
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = article;
    }
  }

  return best ?? FALLBACK;
}

export function formatArticleReply(article: SupportArticle): string {
  const lines: string[] = [`**${article.title}**`, ''];
  article.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  if (article.uiHints?.length) {
    lines.push('', '_Куда смотреть:_');
    article.uiHints.forEach((hint) => lines.push(`• ${hint}`));
  }
  return lines.join('\n');
}
