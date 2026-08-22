import React from 'react';
import { Box, Link } from '@mui/material';
import {
  parseChatInlineHtml,
  type ChatInlineNode,
} from '../utils/chatInlineHtml';

type Props = {
  text: string;
  /** Префикс ключей React (строка/ячейка таблицы и т.п.). */
  keyPrefix?: string;
};

const monoSx = {
  backgroundColor: 'rgba(175, 184, 193, 0.2)',
  padding: '2px 4px',
  borderRadius: '3px',
  fontFamily: 'monospace',
  fontSize: '0.875em',
  color: 'inherit',
} as const;

const blockSx = { my: 0.75, display: 'block' } as const;

function headingSx(level: number) {
  const sizes = [1.55, 1.35, 1.2, 1.1, 1.05, 1];
  return {
    mt: level <= 2 ? 1.5 : 1,
    mb: 0.5,
    fontWeight: 600,
    fontSize: `${sizes[level - 1] || 1}em`,
    lineHeight: 1.35,
    display: 'block',
  } as const;
}

function renderNodes(nodes: ChatInlineNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === 'text') {
      return <React.Fragment key={key}>{node.value}</React.Fragment>;
    }
    if (node.type === 'br') return <br key={key} />;
    if (node.type === 'hr') {
      return (
        <Box
          key={key}
          component="hr"
          sx={{ border: 0, borderTop: '1px solid', borderColor: 'divider', my: 1.5 }}
        />
      );
    }
    if (node.type === 'wbr') return <wbr key={key} />;
    if (node.type === 'col') {
      return <Box key={key} component="col" {...node.attrs} />;
    }
    if (node.type === 'img') {
      return (
        <Box
          key={key}
          component="img"
          src={node.src}
          alt={node.alt}
          title={node.title}
          sx={{
            maxWidth: '100%',
            height: 'auto',
            borderRadius: 1,
            my: 1,
            display: 'block',
          }}
        />
      );
    }

    const children = renderNodes(node.children, key);
    const { tag, attrs } = node;

    switch (tag) {
      case 'strong':
        return (
          <Box key={key} component="strong" sx={{ fontWeight: 'bold' }}>
            {children}
          </Box>
        );
      case 'em':
        return (
          <Box key={key} component="em" sx={{ fontStyle: 'italic' }}>
            {children}
          </Box>
        );
      case 'u':
        return (
          <Box key={key} component="u" sx={{ textDecoration: 'underline' }}>
            {children}
          </Box>
        );
      case 'ins':
        return (
          <Box key={key} component="ins" sx={{ textDecoration: 'underline' }}>
            {children}
          </Box>
        );
      case 'del':
        return (
          <Box key={key} component="del" sx={{ textDecoration: 'line-through' }}>
            {children}
          </Box>
        );
      case 'mark':
        return (
          <Box
            key={key}
            component="mark"
            sx={{ backgroundColor: 'rgba(255, 230, 0, 0.35)', px: 0.25 }}
          >
            {children}
          </Box>
        );
      case 'small':
        return (
          <Box key={key} component="small" sx={{ fontSize: '0.85em' }}>
            {children}
          </Box>
        );
      case 'big':
        return (
          <Box key={key} component="span" sx={{ fontSize: '1.2em' }}>
            {children}
          </Box>
        );
      case 'font': {
        // <font color size face> → span (устаревший HTML от LLM)
        const FONT_SIZE_MAP: Record<string, string> = {
          '1': '0.65em',
          '2': '0.8em',
          '3': '1em',
          '4': '1.15em',
          '5': '1.35em',
          '6': '1.6em',
          '7': '2em',
        };
        const sx: Record<string, string> = {};
        if (attrs.color) sx.color = attrs.color;
        if (attrs.face) sx.fontFamily = attrs.face;
        if (attrs.size) {
          const s = attrs.size.trim();
          if (FONT_SIZE_MAP[s]) sx.fontSize = FONT_SIZE_MAP[s];
          else if (/^[+-][1-7]$/.test(s)) {
            const base = 3;
            const n = Math.min(7, Math.max(1, base + Number(s)));
            sx.fontSize = FONT_SIZE_MAP[String(n)];
          } else {
            sx.fontSize = s;
          }
        }
        return (
          <Box key={key} component="span" sx={sx}>
            {children}
          </Box>
        );
      }
      case 'sup':
        return (
          <Box key={key} component="sup" sx={{ fontSize: '0.75em', lineHeight: 0 }}>
            {children}
          </Box>
        );
      case 'sub':
        return (
          <Box key={key} component="sub" sx={{ fontSize: '0.75em', lineHeight: 0 }}>
            {children}
          </Box>
        );
      case 'code':
      case 'kbd':
      case 'samp':
      case 'var':
        return (
          <Box key={key} component={tag} sx={monoSx}>
            {children}
          </Box>
        );
      case 'pre':
        return (
          <Box
            key={key}
            component="pre"
            sx={{
              ...monoSx,
              display: 'block',
              p: 1.25,
              my: 1,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {children}
          </Box>
        );
      case 'a':
        return (
          <Link
            key={key}
            href={attrs.href}
            title={attrs.title}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: 'primary.main',
              textDecoration: 'underline',
              '&:hover': { textDecoration: 'none' },
            }}
          >
            {children}
          </Link>
        );
      case 'span':
        return (
          <Box key={key} component="span" title={attrs.title} lang={attrs.lang} dir={attrs.dir as 'ltr' | 'rtl' | undefined}>
            {children}
          </Box>
        );
      case 'abbr':
      case 'dfn':
        return (
          <Box key={key} component={tag} title={attrs.title} sx={{ textDecoration: 'underline dotted' }}>
            {children}
          </Box>
        );
      case 'cite':
        return (
          <Box key={key} component="cite" sx={{ fontStyle: 'italic' }}>
            {children}
          </Box>
        );
      case 'q':
        return (
          <Box key={key} component="q" cite={attrs.cite}>
            {children}
          </Box>
        );
      case 'data':
        return (
          <Box key={key} component="data" value={attrs.value} title={attrs.title}>
            {children}
          </Box>
        );
      case 'time':
        return (
          <Box key={key} component="time" dateTime={attrs.datetime} title={attrs.title}>
            {children}
          </Box>
        );
      case 'ruby':
      case 'rt':
      case 'rp':
      case 'bdi':
        return (
          <Box key={key} component={tag} dir={attrs.dir as 'ltr' | 'rtl' | undefined}>
            {children}
          </Box>
        );
      case 'bdo':
        return (
          <Box key={key} component="bdo" dir={(attrs.dir as 'ltr' | 'rtl') || 'ltr'}>
            {children}
          </Box>
        );
      case 'p':
      case 'div':
      case 'address':
      case 'article':
      case 'section':
      case 'aside':
      case 'header':
      case 'footer':
      case 'main':
      case 'nav':
      case 'figure':
      case 'figcaption':
        return (
          <Box key={key} component={tag} sx={blockSx}>
            {children}
          </Box>
        );
      case 'blockquote':
        return (
          <Box
            key={key}
            component="blockquote"
            cite={attrs.cite}
            sx={{
              borderLeft: '3px solid',
              borderColor: 'divider',
              pl: 1.5,
              my: 1,
              color: 'text.secondary',
              fontStyle: 'italic',
            }}
          >
            {children}
          </Box>
        );
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Number(tag[1]);
        return (
          <Box key={key} component={tag} sx={headingSx(level)}>
            {children}
          </Box>
        );
      }
      case 'ul':
      case 'ol':
        return (
          <Box
            key={key}
            component={tag}
            start={attrs.start ? Number(attrs.start) : undefined}
            type={attrs.type as '1' | 'a' | 'A' | 'i' | 'I' | undefined}
            reversed={attrs.reversed !== undefined ? true : undefined}
            sx={{ my: 1, pl: 2.5, display: 'block' }}
          >
            {children}
          </Box>
        );
      case 'li':
        return (
          <Box
            key={key}
            component="li"
            value={attrs.value ? Number(attrs.value) : undefined}
            sx={{ display: 'list-item', mb: 0.35 }}
          >
            {children}
          </Box>
        );
      case 'dl':
        return (
          <Box key={key} component="dl" sx={{ my: 1 }}>
            {children}
          </Box>
        );
      case 'dt':
        return (
          <Box key={key} component="dt" sx={{ fontWeight: 600, mt: 0.75 }}>
            {children}
          </Box>
        );
      case 'dd':
        return (
          <Box key={key} component="dd" sx={{ ml: 2, mb: 0.5 }}>
            {children}
          </Box>
        );
      case 'details':
        return (
          <Box key={key} component="details" open={attrs.open !== undefined} sx={{ my: 1 }}>
            {children}
          </Box>
        );
      case 'summary':
        return (
          <Box key={key} component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>
            {children}
          </Box>
        );
      case 'table':
        return (
          <Box
            key={key}
            component="table"
            sx={{
              borderCollapse: 'collapse',
              width: '100%',
              my: 1.25,
              display: 'table',
              '& th, & td': {
                border: '1px solid',
                borderColor: 'divider',
                px: 1,
                py: 0.5,
                textAlign: 'left',
              },
              '& th': { fontWeight: 600, bgcolor: 'action.hover' },
            }}
          >
            {children}
          </Box>
        );
      case 'thead':
      case 'tbody':
      case 'tfoot':
      case 'tr':
      case 'caption':
      case 'colgroup':
        return (
          <Box key={key} component={tag}>
            {children}
          </Box>
        );
      case 'th':
      case 'td':
        return (
          <Box
            key={key}
            component={tag}
            colSpan={attrs.colspan ? Number(attrs.colspan) : undefined}
            rowSpan={attrs.rowspan ? Number(attrs.rowspan) : undefined}
            scope={attrs.scope as 'col' | 'row' | 'colgroup' | 'rowgroup' | undefined}
          >
            {children}
          </Box>
        );
      default:
        return <span key={key}>{children}</span>;
    }
  });
}

/**
 * Рендер whitelist HTML из ответа LLM.
 * Не использовать для HTML-артефактов и презентаций.
 */
export default function ChatInlineHtml({ text, keyPrefix = 'cih' }: Props): React.ReactElement | null {
  if (!text) return null;
  const nodes = parseChatInlineHtml(text);
  const rendered = renderNodes(nodes, keyPrefix);
  if (rendered.length === 0) return null;
  return <>{rendered}</>;
}
