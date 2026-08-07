import { stripReasoningMarkers } from './reasoningSplit';

export type MessageExportFormat = 'pdf' | 'word';

/** Убирает блоки рассуждений модели из текста ответа. */
export function stripReasoningForExport(raw: string): string {
  return stripReasoningMarkers(raw);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function buildExportFileName(base: string, ext: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    '_',
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('');
  const safeBase = (base || 'message').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  return `${safeBase}_${stamp}.${ext}`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type TextStyle = { bold?: boolean; italic?: boolean; code?: boolean };
export type TextRun = { text: string } & TextStyle;

type ExportBlock =
  | { kind: 'heading'; level: number; runs: TextRun[] }
  | { kind: 'paragraph'; runs: TextRun[] }
  | { kind: 'li'; ordered: boolean; index?: number; runs: TextRun[] }
  | { kind: 'quote'; runs: TextRun[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'table'; headers: TextRun[][]; rows: TextRun[][][] }
  | { kind: 'hr' }
  | { kind: 'blank' };

function splitMarkdownTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.includes('-')) return false;
  return /^\|?[\s:|-]+\|[\s:|-]*\|?$/.test(t);
}

/** Инлайн-разметка в стиле MessageRenderer (strong/em/code). */
export function parseInlineRuns(raw: string): TextRun[] {
  if (!raw) return [];

  let s = raw;
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
  s = s.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
  s = s.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
  s = s.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');
  s = s.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');

  s = s.replace(/\*\*([^*]*(?:\*[^*]+\*[^*]*)*)\*\*/g, (_, content: string) => {
    const inner = String(content).replace(/\*([^*]+)\*/g, '\u0001EM\u0002$1\u0001/EM\u0002');
    return `\u0001STRONG\u0002${inner}\u0001/STRONG\u0002`;
  });
  s = s.replace(/__([^_]*(?:_[^_]+_[^_]*)*)__/g, (_, content: string) => {
    const inner = String(content).replace(/_([^_]+)_/g, '\u0001EM\u0002$1\u0001/EM\u0002');
    return `\u0001STRONG\u0002${inner}\u0001/STRONG\u0002`;
  });
  s = s.replace(/\*([^*\n]+)\*/g, '\u0001EM\u0002$1\u0001/EM\u0002');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1\u0001EM\u0002$2\u0001/EM\u0002');
  s = s.replace(/`([^`]+)`/g, '\u0001CODE\u0002$1\u0001/CODE\u0002');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  const runs: TextRun[] = [];
  const stack: Array<'STRONG' | 'EM' | 'CODE'> = [];
  let i = 0;

  const open = (name: 'STRONG' | 'EM' | 'CODE', token: string) => {
    stack.push(name);
    i += token.length;
  };
  const close = (token: string) => {
    stack.pop();
    i += token.length;
  };
  const styleNow = (): TextStyle => ({
    bold: stack.includes('STRONG'),
    italic: stack.includes('EM'),
    code: stack.includes('CODE'),
  });
  const pushText = (text: string) => {
    if (!text) return;
    const style = styleNow();
    const prev = runs[runs.length - 1];
    if (prev && prev.bold === style.bold && prev.italic === style.italic && prev.code === style.code) {
      prev.text += text;
    } else {
      runs.push({ text, ...style });
    }
  };

  while (i < s.length) {
    if (s.startsWith('\u0001STRONG\u0002', i)) {
      open('STRONG', '\u0001STRONG\u0002');
      continue;
    }
    if (s.startsWith('\u0001/STRONG\u0002', i)) {
      close('\u0001/STRONG\u0002');
      continue;
    }
    if (s.startsWith('\u0001EM\u0002', i)) {
      open('EM', '\u0001EM\u0002');
      continue;
    }
    if (s.startsWith('\u0001/EM\u0002', i)) {
      close('\u0001/EM\u0002');
      continue;
    }
    if (s.startsWith('\u0001CODE\u0002', i)) {
      open('CODE', '\u0001CODE\u0002');
      continue;
    }
    if (s.startsWith('\u0001/CODE\u0002', i)) {
      close('\u0001/CODE\u0002');
      continue;
    }
    let j = i + 1;
    while (j < s.length && s[j] !== '\u0001') j += 1;
    pushText(s.slice(i, j));
    i = j;
  }

  return runs.length ? runs : [{ text: raw }];
}

function parseMarkdownBlocks(md: string): ExportBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: ExportBlock[] = [];
  let i = 0;
  let inCode = false;
  let codeLines: string[] = [];
  let olIndex = 0;

  const flushCode = () => {
    if (codeLines.length) {
      blocks.push({ kind: 'code', lines: [...codeLines] });
      codeLines = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        inCode = true;
        codeLines = [];
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      blocks.push({ kind: 'blank' });
      olIndex = 0;
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // GFM-таблица: заголовок + строка-разделитель |---|---|
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isMarkdownTableSeparator(lines[i + 1])
    ) {
      const headerCells = splitMarkdownTableRow(line);
      const headers = headerCells.map((c) => parseInlineRuns(c));
      const colCount = Math.max(1, headers.length);
      i += 2;
      const rows: TextRun[][][] = [];
      while (
        i < lines.length &&
        lines[i].includes('|') &&
        lines[i].trim() &&
        !isMarkdownTableSeparator(lines[i])
      ) {
        const cells = splitMarkdownTableRow(lines[i]);
        while (cells.length < colCount) cells.push('');
        rows.push(cells.slice(0, colCount).map((c) => parseInlineRuns(c)));
        i += 1;
      }
      // Выравниваем число колонок в заголовке
      while (headers.length < colCount) headers.push([{ text: '' }]);
      blocks.push({ kind: 'table', headers: headers.slice(0, colCount), rows });
      olIndex = 0;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, runs: parseInlineRuns(heading[2]) });
      olIndex = 0;
      i += 1;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push({ kind: 'quote', runs: parseInlineRuns(quote[1]) });
      olIndex = 0;
      i += 1;
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ul) {
      blocks.push({ kind: 'li', ordered: false, runs: parseInlineRuns(ul[1]) });
      olIndex = 0;
      i += 1;
      continue;
    }

    const ol = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (ol) {
      olIndex = parseInt(ol[1], 10) || olIndex + 1;
      blocks.push({ kind: 'li', ordered: true, index: olIndex, runs: parseInlineRuns(ol[2]) });
      i += 1;
      continue;
    }

    blocks.push({ kind: 'paragraph', runs: parseInlineRuns(line) });
    olIndex = 0;
    i += 1;
  }

  if (inCode) flushCode();
  return blocks;
}

function runsToHtml(runs: TextRun[]): string {
  return runs
    .map((run) => {
      let t = escapeHtml(run.text);
      if (run.code) t = `<code>${t}</code>`;
      if (run.bold) t = `<strong>${t}</strong>`;
      if (run.italic) t = `<em>${t}</em>`;
      return t;
    })
    .join('');
}

/** Markdown → HTML с сохранением жирного, курсива, заголовков, списков. */
export function markdownToRichHtml(md: string): string {
  const blocks = parseMarkdownBlocks(md);
  const out: string[] = [];
  let openList: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (openList) {
      out.push(`</${openList}>`);
      openList = null;
    }
  };

  for (const b of blocks) {
    if (b.kind === 'li') {
      const want = b.ordered ? 'ol' : 'ul';
      if (openList !== want) {
        closeList();
        out.push(`<${want}>`);
        openList = want;
      }
      const valueAttr = b.ordered && b.index != null ? ` value="${b.index}"` : '';
      out.push(`<li${valueAttr}>${runsToHtml(b.runs)}</li>`);
      continue;
    }

    closeList();

    if (b.kind === 'blank') {
      out.push('<p style="margin:0 0 8pt;">&nbsp;</p>');
    } else if (b.kind === 'hr') {
      out.push('<hr />');
    } else if (b.kind === 'heading') {
      const level = Math.min(Math.max(b.level, 1), 6);
      out.push(`<h${level}>${runsToHtml(b.runs)}</h${level}>`);
    } else if (b.kind === 'quote') {
      out.push(`<blockquote>${runsToHtml(b.runs)}</blockquote>`);
    } else if (b.kind === 'code') {
      out.push(
        `<pre style="white-space:pre-wrap;font-family:Consolas,'Courier New',monospace;background:#f5f5f5;padding:8pt;margin:8pt 0;">${escapeHtml(b.lines.join('\n'))}</pre>`,
      );
    } else if (b.kind === 'table') {
      const th = b.headers
        .map(
          (cell) =>
            `<th style="border:1px solid #999;padding:6pt 8pt;background:#f0f0f0;font-weight:700;text-align:left;vertical-align:top;">${runsToHtml(cell)}</th>`,
        )
        .join('');
      const body = b.rows
        .map((row) => {
          const tds = row
            .map(
              (cell) =>
                `<td style="border:1px solid #999;padding:6pt 8pt;vertical-align:top;">${runsToHtml(cell)}</td>`,
            )
            .join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      out.push(
        `<table style="border-collapse:collapse;width:100%;margin:10pt 0;font-size:11pt;" border="1" cellspacing="0" cellpadding="6"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`,
      );
    } else if (b.kind === 'paragraph') {
      out.push(`<p>${runsToHtml(b.runs)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

function fontFor(style: TextStyle, sizePx: number): string {
  const weight = style.bold ? '700' : '400';
  const italic = style.italic ? 'italic' : 'normal';
  const family = style.code ? 'Consolas, "Courier New", monospace' : '"Segoe UI", Arial, sans-serif';
  return `${italic} ${weight} ${sizePx}px ${family}`;
}

type LaidLine = { runs: TextRun[]; size: number; indent: number; gapAfter: number };

type LaidTable = {
  kind: 'table';
  colWidths: number[];
  headerLines: TextRun[][][];
  rowLines: TextRun[][][][];
  rowHeights: number[];
  gapAfter: number;
};

type LaidItem = ({ kind: 'line' } & LaidLine) | LaidTable;

function measureRuns(ctx: CanvasRenderingContext2D, runs: TextRun[], size: number): number {
  let w = 0;
  for (const run of runs) {
    ctx.font = fontFor(run, size);
    w += ctx.measureText(run.text).width;
  }
  return w;
}

function wrapRunsToLines(
  ctx: CanvasRenderingContext2D,
  runs: TextRun[],
  maxWidth: number,
  size: number,
): TextRun[][] {
  const lines: TextRun[][] = [];
  let current: TextRun[] = [];
  let currentWidth = 0;

  const flush = () => {
    if (!current.length) return;
    lines.push(current);
    current = [];
    currentWidth = 0;
  };

  const pushChunk = (run: TextRun, text: string) => {
    if (!text) return;
    ctx.font = fontFor(run, size);
    const width = ctx.measureText(text).width;
    if (currentWidth + width <= maxWidth || current.length === 0) {
      const prev = current[current.length - 1];
      if (prev && prev.bold === run.bold && prev.italic === run.italic && prev.code === run.code) {
        prev.text += text;
      } else {
        current.push({ ...run, text });
      }
      currentWidth += width;
      return;
    }
    flush();
    ctx.font = fontFor(run, size);
    if (ctx.measureText(text).width > maxWidth) {
      let chunk = '';
      for (const ch of text) {
        const next = chunk + ch;
        if (ctx.measureText(next).width <= maxWidth || !chunk) chunk = next;
        else {
          current.push({ ...run, text: chunk });
          flush();
          chunk = ch;
        }
      }
      if (chunk) {
        current.push({ ...run, text: chunk });
        currentWidth = ctx.measureText(chunk).width;
      }
    } else {
      current.push({ ...run, text });
      currentWidth = ctx.measureText(text).width;
    }
  };

  for (const run of runs) {
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      pushChunk(run, part);
    }
  }
  flush();
  return lines.length ? lines : [[{ text: ' ' }]];
}

function layoutBlocksForCanvas(blocks: ExportBlock[], maxWidth: number): LaidItem[] {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return [];

  const items: LaidItem[] = [];
  const cellPadX = 8;
  const cellPadY = 6;
  const tableFont = 12;
  const lineH = (size: number) => Math.round(size * 1.45);

  const wrapRuns = (runs: TextRun[], size: number, indent: number, gapAfter: number, prefix?: TextRun) => {
    const allRuns = prefix ? [prefix, ...runs] : runs;
    const wrapped = wrapRunsToLines(measure, allRuns, Math.max(40, maxWidth - indent), size);
    wrapped.forEach((runsLine, idx) => {
      items.push({
        kind: 'line',
        runs: runsLine,
        size,
        indent,
        gapAfter: idx === wrapped.length - 1 ? gapAfter : 0,
      });
    });
  };

  for (const b of blocks) {
    if (b.kind === 'blank') {
      items.push({ kind: 'line', runs: [{ text: ' ' }], size: 14, indent: 0, gapAfter: 8 });
      continue;
    }
    if (b.kind === 'hr') {
      items.push({
        kind: 'line',
        runs: [{ text: '────────────────' }],
        size: 12,
        indent: 0,
        gapAfter: 10,
      });
      continue;
    }
    if (b.kind === 'code') {
      for (let idx = 0; idx < b.lines.length; idx += 1) {
        wrapRuns([{ text: b.lines[idx] || ' ', code: true }], 12, 12, idx === b.lines.length - 1 ? 10 : 0);
      }
      continue;
    }
    if (b.kind === 'heading') {
      const size = b.level <= 1 ? 22 : b.level === 2 ? 18 : b.level === 3 ? 16 : 15;
      wrapRuns(
        b.runs.map((r) => ({ ...r, bold: true })),
        size,
        0,
        10,
      );
      continue;
    }
    if (b.kind === 'quote') {
      wrapRuns(
        b.runs.map((r) => ({ ...r, italic: true })),
        14,
        20,
        8,
      );
      continue;
    }
    if (b.kind === 'li') {
      const prefixText = b.ordered ? `${b.index ?? 1}. ` : '• ';
      wrapRuns(b.runs, 14, 18, 4, { text: prefixText, bold: false });
      continue;
    }
    if (b.kind === 'paragraph') {
      wrapRuns(b.runs, 14, 0, 8);
      continue;
    }
    if (b.kind === 'table') {
      const colCount = Math.max(1, b.headers.length);
      const rawWidths = Array.from({ length: colCount }, (_, c) => {
        let max = measureRuns(measure, b.headers[c] || [{ text: '' }], tableFont) + cellPadX * 2;
        b.rows.forEach((row) => {
          max = Math.max(max, measureRuns(measure, row[c] || [{ text: '' }], tableFont) + cellPadX * 2);
        });
        return Math.min(Math.max(max, 48), maxWidth);
      });
      const sum = rawWidths.reduce((a, w) => a + w, 0) || 1;
      const colWidths =
        sum > maxWidth
          ? rawWidths.map((w) => (w / sum) * maxWidth)
          : rawWidths.map((w) => w + (maxWidth - sum) / colCount);

      const headerLines = b.headers.map((cell, c) =>
        wrapRunsToLines(
          measure,
          (cell || [{ text: '' }]).map((r) => ({ ...r, bold: true })),
          Math.max(24, colWidths[c] - cellPadX * 2),
          tableFont,
        ),
      );
      const rowLines = b.rows.map((row) =>
        Array.from({ length: colCount }, (_, c) =>
          wrapRunsToLines(
            measure,
            row[c] || [{ text: '' }],
            Math.max(24, colWidths[c] - cellPadX * 2),
            tableFont,
          ),
        ),
      );

      const headerH =
        Math.max(1, ...headerLines.map((lines) => lines.length)) * lineH(tableFont) + cellPadY * 2;
      const bodyHeights = rowLines.map(
        (cols) => Math.max(1, ...cols.map((lines) => lines.length)) * lineH(tableFont) + cellPadY * 2,
      );

      items.push({
        kind: 'table',
        colWidths,
        headerLines,
        rowLines,
        rowHeights: [headerH, ...bodyHeights],
        gapAfter: 12,
      });
    }
  }

  return items;
}

function canvasPagesFromBlocks(blocks: ExportBlock[]): string[] {
  const pageW = 794;
  const pageH = 1123;
  const margin = 56;
  const maxWidth = pageW - margin * 2;
  const laid = layoutBlocksForCanvas(blocks, maxWidth);
  const lineStep = (size: number) => Math.round(size * 1.45);
  const cellPadX = 8;
  const cellPadY = 6;
  const tableFont = 12;

  const pages: string[] = [];
  let idx = 0;

  const newPage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageW, pageH);
    ctx.textBaseline = 'top';
    return { canvas, ctx, y: margin as number };
  };

  let page = newPage();

  const finishPage = () => {
    pages.push(page.canvas.toDataURL('image/jpeg', 0.92));
  };

  const ensureSpace = (needed: number) => {
    if (page.y + needed <= pageH - margin || page.y <= margin) return;
    finishPage();
    page = newPage();
  };

  const drawRunsLine = (
    ctx: CanvasRenderingContext2D,
    runs: TextRun[],
    x: number,
    y: number,
    size: number,
  ) => {
    let cx = x;
    for (const run of runs) {
      ctx.font = fontFor(run, size);
      ctx.fillStyle = run.code ? '#333333' : '#111111';
      ctx.fillText(run.text, cx, y);
      cx += ctx.measureText(run.text).width;
    }
  };

  if (laid.length === 0) {
    finishPage();
    return pages;
  }

  while (idx < laid.length) {
    const item = laid[idx];

    if (item.kind === 'line') {
      const h = lineStep(item.size) + item.gapAfter;
      ensureSpace(h);
      drawRunsLine(page.ctx, item.runs, margin + item.indent, page.y, item.size);
      page.y += h;
      idx += 1;
      continue;
    }

    const tableWidth = item.colWidths.reduce((a, w) => a + w, 0);
    const tableX = margin;

    const drawTableRow = (colLines: TextRun[][][], rowHeight: number, isHeader: boolean) => {
      ensureSpace(rowHeight + 2);
      let x = tableX;
      if (isHeader) {
        page.ctx.fillStyle = '#f0f0f0';
        page.ctx.fillRect(tableX, page.y, tableWidth, rowHeight);
      }
      for (let c = 0; c < item.colWidths.length; c += 1) {
        const w = item.colWidths[c];
        page.ctx.strokeStyle = '#999999';
        page.ctx.lineWidth = 1;
        page.ctx.strokeRect(x + 0.5, page.y + 0.5, w - 1, rowHeight - 1);

        const lines = colLines[c] || [[{ text: ' ' }]];
        let ty = page.y + cellPadY;
        for (const runs of lines) {
          drawRunsLine(
            page.ctx,
            isHeader ? runs.map((r) => ({ ...r, bold: true })) : runs,
            x + cellPadX,
            ty,
            tableFont,
          );
          ty += lineStep(tableFont);
        }
        x += w;
      }
      page.y += rowHeight;
    };

    drawTableRow(item.headerLines, item.rowHeights[0], true);
    for (let r = 0; r < item.rowLines.length; r += 1) {
      drawTableRow(item.rowLines[r], item.rowHeights[r + 1] || item.rowHeights[0], false);
    }
    page.y += item.gapAfter;
    idx += 1;
  }

  finishPage();
  return pages;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function encodePdfString(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function buildPdfFromJpegDataUrls(jpegDataUrls: string[]): Blob {
  const pageW = 595.28;
  const pageH = 841.89;
  const n = Math.max(1, jpegDataUrls.length);
  const imgStart = 3;
  const contentStart = imgStart + n;
  const pageStart = contentStart + n;
  const kidsRef = Array.from({ length: n }, (_, i) => `${pageStart + i} 0 R`).join(' ');

  const parts: Uint8Array[] = [encodePdfString('%PDF-1.4\n')];
  const offsets: number[] = [];
  let cursor = parts[0].length;

  const push = (chunk: Uint8Array) => {
    offsets.push(cursor);
    parts.push(chunk);
    cursor += chunk.length;
  };

  push(encodePdfString('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  push(encodePdfString(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${kidsRef}] >>\nendobj\n`));

  for (let i = 0; i < n; i += 1) {
    const imgBytes = dataUrlToBytes(jpegDataUrls[i] || jpegDataUrls[0]);
    push(
      concatUint8([
        encodePdfString(
          `${imgStart + i} 0 obj\n<< /Type /XObject /Subtype /Image /Width 794 /Height 1123 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`,
        ),
        imgBytes,
        encodePdfString('\nendstream\nendobj\n'),
      ]),
    );
  }

  for (let i = 0; i < n; i += 1) {
    const stream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im${i} Do\nQ\n`;
    push(
      encodePdfString(
        `${contentStart + i} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
      ),
    );
  }

  for (let i = 0; i < n; i += 1) {
    push(
      encodePdfString(
        `${pageStart + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentStart + i} 0 R /Resources << /XObject << /Im${i} ${imgStart + i} 0 R >> >> >>\nendobj\n`,
      ),
    );
  }

  const xrefStart = cursor;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  parts.push(encodePdfString(xref));
  parts.push(
    encodePdfString(
      `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    ),
  );

  return new Blob(parts, { type: 'application/pdf' });
}

export function exportMessageAsWord(content: string, fileNameBase = 'ответ'): void {
  const text = stripReasoningForExport(content);
  const bodyHtml = markdownToRichHtml(text || ' ');
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(fileNameBase)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 12pt; line-height: 1.45; color: #111; }
  h1 { font-size: 20pt; font-weight: 700; margin: 14pt 0 8pt; }
  h2 { font-size: 16pt; font-weight: 700; margin: 12pt 0 6pt; }
  h3 { font-size: 14pt; font-weight: 700; margin: 10pt 0 6pt; }
  h4,h5,h6 { font-size: 12pt; font-weight: 700; margin: 8pt 0 4pt; }
  p { margin: 0 0 8pt; }
  strong, b { font-weight: 700; }
  em, i { font-style: italic; }
  ul, ol { margin: 6pt 0 10pt 18pt; padding-left: 12pt; }
  li { margin: 0 0 4pt; }
  blockquote { margin: 8pt 0 8pt 12pt; padding-left: 10pt; border-left: 3pt solid #999; color: #444; font-style: italic; }
  pre { font-family: Consolas, "Courier New", monospace; font-size: 10pt; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 11pt; }
  th, td { border: 1px solid #999; padding: 6pt 8pt; vertical-align: top; text-align: left; }
  th { background: #f0f0f0; font-weight: 700; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  downloadBlob(blob, buildExportFileName(fileNameBase, 'doc'));
}

export function exportMessageAsPdf(content: string, fileNameBase = 'ответ'): void {
  const text = stripReasoningForExport(content);
  const blocks = parseMarkdownBlocks(text || ' ');
  const pages = canvasPagesFromBlocks(blocks);
  const blob = buildPdfFromJpegDataUrls(pages);
  downloadBlob(blob, buildExportFileName(fileNameBase, 'pdf'));
}

export function exportMessageContent(
  content: string,
  format: MessageExportFormat,
  fileNameBase = 'ответ',
): void {
  if (format === 'pdf') exportMessageAsPdf(content, fileNameBase);
  else exportMessageAsWord(content, fileNameBase);
}

/** Plain-текст из runs (для буфера). */
export function runsToPlain(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

export function markdownToPlainText(md: string): string {
  return parseMarkdownBlocks(md)
    .map((b) => {
      if (b.kind === 'blank') return '';
      if (b.kind === 'hr') return '---';
      if (b.kind === 'code') return b.lines.join('\n');
      if (b.kind === 'li') {
        const prefix = b.ordered ? `${b.index ?? 1}. ` : '• ';
        return prefix + runsToPlain(b.runs);
      }
      if (b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'quote') {
        return runsToPlain(b.runs);
      }
      if (b.kind === 'table') {
        const header = b.headers.map((c) => runsToPlain(c)).join('\t');
        const rows = b.rows.map((row) => row.map((c) => runsToPlain(c)).join('\t'));
        return [header, ...rows].join('\n');
      }
      return '';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
