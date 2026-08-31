/**
 * Устойчивый разбор Markdown/GFM/ASCII таблиц из ответов LLM.
 * Учитывает: разный число колонок в header/sep/rows, 2+ дефиса,
 * unicode-тире, без крайних `|`, без sep, склейку переносов в ячейке.
 */

export type MarkdownTableData = {
  headers: string[];
  rows: string[][];
};

export type MarkdownTableBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

/** Нормализует тире к ASCII `-`. */
function normalizeDashes(s: string): string {
  return String(s || '').replace(/[─–—―]/g, '-');
}

/** Убирает крайние `|` у строки таблицы. */
function stripEdgePipes(line: string): string {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t;
}

/**
 * Делит строку по неэкранированным `|`.
 * Пустые крайние ячейки сохраняем (важны для выравнивания колонок).
 */
export function splitMarkdownTableRow(line: string): string[] {
  const s = stripEdgePipes(normalizeDashes(line));
  if (!s.includes('|') && !line.includes('|')) {
    // Строка без `|` после strip — не ячейки таблицы
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  }

  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '|' && s[i - 1] !== '\\') {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf.trim());
  return out.map((cell) => cell.replace(/\\\|/g, '|'));
}

/**
 * Строка-разделитель GFM/LLM: трубы + дефисы/двоеточия/=.
 * Достаточно 2+ дефисов в сегменте (LLM часто пишет `--`).
 */
export function isMarkdownTableSeparator(line: string): boolean {
  const raw = normalizeDashes(line).trim();
  if (!raw) return false;

  // Только служебные символы разделителя
  if (!/^[\s|:=\-+]+$/.test(raw)) return false;
  // Хотя бы один прогон дефисов/равно
  if (!/-{2,}|={2,}/.test(raw)) return false;

  // Классический ASCII-бордюр (+---+), не GFM — тоже sep
  if (/^\+?[-+=|]+$/.test(raw) && (raw.includes('+') || raw.includes('='))) {
    return true;
  }

  // GFM: есть `|` или это единственная колонка `---` / `:---`
  if (raw.includes('|')) return true;
  return /^:?-{2,}:?$/.test(raw);
}

/** Похоже на строку данных/заголовка pipe-таблицы. */
export function isMarkdownTableRowLine(line: string): boolean {
  const t = line.trim();
  if (!t || isMarkdownTableSeparator(t)) return false;
  return t.includes('|');
}

function padOrTrimRow(cells: string[], colCount: number): string[] {
  if (cells.length === colCount) return cells;
  if (cells.length > colCount) {
    const head = cells.slice(0, colCount - 1);
    const tail = cells.slice(colCount - 1).join(' | ');
    return [...head, tail];
  }
  return [...cells, ...Array.from({ length: colCount - cells.length }, () => '')];
}

/**
 * Парсит блок таблицы (уже вырезанный: header + optional sep + rows).
 */
export function parseMarkdownTableBlock(text: string): MarkdownTableData | null {
  const lines = normalizeDashes(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());

  if (lines.length < 2) return null;

  let headerLine = lines[0];
  let bodyStart = 1;

  if (!isMarkdownTableRowLine(headerLine) && !headerLine.includes('|')) {
    return null;
  }

  // Sep на второй строке — норма; без sep тоже допускаем (LLM забывает)
  if (isMarkdownTableSeparator(lines[1])) {
    bodyStart = 2;
  } else if (!isMarkdownTableRowLine(lines[1])) {
    return null;
  }

  const headers = splitMarkdownTableRow(headerLine).map((h) => h || ' ');
  if (!headers.length) return null;

  // Число колонок: max(header, sep segments, median of first rows)
  let colCount = headers.length;
  if (bodyStart === 2) {
    const sepCols = splitMarkdownTableRow(lines[1]).length;
    // sep с меньшим числом колонок — частый баг LLM; берём max с header
    colCount = Math.max(colCount, sepCols);
  }

  const rawRows = lines.slice(bodyStart).filter((l) => isMarkdownTableRowLine(l) || l.includes('|'));
  for (const rowLine of rawRows.slice(0, 5)) {
    colCount = Math.max(colCount, splitMarkdownTableRow(rowLine).length);
  }

  colCount = Math.max(1, colCount);
  const normalizedHeaders = padOrTrimRow(headers, colCount);
  const rows = rawRows.map((rowLine) => padOrTrimRow(splitMarkdownTableRow(rowLine), colCount));

  return { headers: normalizedHeaders, rows };
}

/**
 * Ищет первую GFM/pipe таблицу в тексте.
 * Склеивает переносы внутри ячейки (строка без `|` после незакрытой).
 */
export function extractFirstMarkdownTable(
  text: string,
): { table: string; before: string; after: string; start: number; end: number } | null {
  const lines = normalizeDashes(text).replace(/\r\n/g, '\n').split('\n');

  for (let i = 0; i < lines.length - 1; i++) {
    const headerCandidate = lines[i].trim();
    if (!isMarkdownTableRowLine(headerCandidate) && !headerCandidate.includes('|')) continue;

    const next = lines[i + 1]?.trim() || '';
    const nextIsSep = isMarkdownTableSeparator(next);
    const nextIsRow = isMarkdownTableRowLine(next);

    // Нужны header + (sep или ещё одна row)
    if (!nextIsSep && !nextIsRow) continue;
    // Одна pipe-строка среди текста без продолжения — не таблица
    if (!nextIsSep && nextIsRow) {
      const headerCols = splitMarkdownTableRow(headerCandidate).length;
      const nextCols = splitMarkdownTableRow(next).length;
      // Слишком разные — скорее случайные `|` в тексте
      if (headerCols < 2 && nextCols < 2) continue;
    }

    const collected: string[] = [headerCandidate, next];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const raw = lines[j];
      const t = raw.trim();
      if (!t) break;

      if (t.includes('|') || isMarkdownTableSeparator(t)) {
        collected.push(t);
        continue;
      }

      // Перенос внутри ячейки: предыдущая строка таблицы не заканчивается на `|`
      const prev = collected[collected.length - 1] || '';
      if (collected.length >= 2 && prev && !prev.trim().endsWith('|')) {
        collected[collected.length - 1] = `${prev} ${t}`;
        continue;
      }
      break;
    }

    // Минимум header+sep или header+row
    if (collected.length < 2) continue;
    // Если второй — sep, нужна хотя бы ещё одна data-строка ИЛИ допускаем пустое body
    const parsed = parseMarkdownTableBlock(collected.join('\n'));
    if (!parsed) continue;

    return {
      table: collected.join('\n'),
      before: lines.slice(0, i).join('\n'),
      after: lines.slice(j).join('\n'),
      start: i,
      end: j,
    };
  }

  return null;
}

/** Разбивает текст на чередующиеся text/table блоки (все таблицы подряд). */
export function splitTextWithMarkdownTables(text: string): MarkdownTableBlock[] {
  const blocks: MarkdownTableBlock[] = [];
  let rest = text || '';

  while (rest.length) {
    const found = extractFirstMarkdownTable(rest);
    if (!found) {
      if (rest) blocks.push({ kind: 'text', text: rest });
      break;
    }
    if (found.before) blocks.push({ kind: 'text', text: found.before });
    const parsed = parseMarkdownTableBlock(found.table);
    if (parsed) {
      blocks.push({ kind: 'table', headers: parsed.headers, rows: parsed.rows });
    } else if (found.table) {
      blocks.push({ kind: 'text', text: found.table });
    }
    rest = found.after;
  }

  return blocks;
}

/** ASCII-таблица с `+---+` / `===` — не путать с GFM. */
export function looksLikeAsciiArtTable(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 3) return false;
  // Если есть нормальный GFM-sep — это не ascii-art
  if (lines.some((l) => isMarkdownTableSeparator(l) && l.includes('|') && !l.includes('+'))) {
    return false;
  }
  const hasBorder = lines.some(
    (line) => line.includes('+---') || line.includes('===') || /^\s*\+[-+]+\+\s*$/.test(line),
  );
  if (!hasBorder) return false;
  const withPipe = lines.filter((l) => l.includes('|')).length;
  return withPipe >= lines.length * 0.5;
}
