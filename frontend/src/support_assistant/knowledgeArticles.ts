/**
 * Прототип базы знаний для виджета поддержки.
 * Контент статей — в knowledgeArticles.json; здесь только типы и матчинг.
 * Медиа: public/static/user_documentation/{screens|gif}/
 */

import kb from './knowledgeArticles.json';

/** Базовый URL статики (папка public/ раздаётся как корень сайта). */
export const DOC_MEDIA_BASE = '/static/user_documentation';

export type SupportMediaKind = 'screen' | 'gif';

export type SupportMedia = {
  /** screen → screens/, gif → gif/ */
  kind: SupportMediaKind;
  /** Имя файла внутри screens/ или gif/ */
  file: string;
  alt?: string;
  caption?: string;
};

export type SupportArticle = {
  id: string;
  /** Короткие фразы/слова, по которым прототип находит статью без LLM */
  keywords: string[];
  title: string;
  /** Пошаговая инструкция для пользователя */
  steps: string[];
  /** Опционально: куда смотреть на экране */
  uiHints?: string[];
  /** Скриншоты (png) и анимации (gif) к статье */
  media?: SupportMedia[];
};

const MEDIA_SUBDIR: Record<SupportMediaKind, string> = {
  screen: 'screens',
  gif: 'gif',
};

export function mediaUrl(item: SupportMedia): string {
  return `${DOC_MEDIA_BASE}/${MEDIA_SUBDIR[item.kind]}/${item.file}`;
}

export const SUPPORT_ARTICLES: SupportArticle[] = kb.articles as SupportArticle[];
const FALLBACK: SupportArticle = kb.fallback as SupportArticle;

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
  if (article.media?.length) {
    lines.push('');
    for (const item of article.media) {
      const alt = item.alt || item.caption || item.file;
      if (item.caption) {
        lines.push(`_${item.caption}_`);
      }
      lines.push(`![${alt}](${mediaUrl(item)})`, '');
    }
  }
  return lines.join('\n');
}
