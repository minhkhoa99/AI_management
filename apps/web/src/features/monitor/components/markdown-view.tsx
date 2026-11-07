import { Fragment, type ReactNode } from 'react';
import styles from './monitor.module.css';

/**
 * Minimal Markdown for documents agents write: headings, paragraphs, lists, quotes, fenced code,
 * **bold**, *italic*, `code`. Built as React elements only (never HTML strings), so agent text
 * cannot inject markup; links are shown as text followed by their address.
 */
export function MarkdownView({ source }: { source: string }) {
  return <div className={styles.markdown}>{renderBlocks(source)}</div>;
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trimStart().startsWith('```')) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      continue;
    }
    const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem !== null) {
      flushParagraph();
      const ordered = /\d/.test(listItem[1] ?? '');
      const previous = blocks.at(-1);
      if (previous?.kind === 'list' && previous.ordered === ordered) {
        previous.items.push(listItem[2] ?? '');
      } else {
        blocks.push({ kind: 'list', ordered, items: [listItem[2] ?? ''] });
      }
      continue;
    }
    if (line.startsWith('>')) {
      flushParagraph();
      const previous = blocks.at(-1);
      const text = line.replace(/^>\s?/, '');
      if (previous?.kind === 'quote') previous.text += ` ${text}`;
      else blocks.push({ kind: 'quote', text });
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

function renderBlocks(source: string): ReactNode[] {
  return parseBlocks(source).map((block, index) => {
    switch (block.kind) {
      case 'heading': {
        const Heading = (['h2', 'h3', 'h4', 'h5', 'h6', 'h6'] as const)[block.level - 1] ?? 'h6';
        return <Heading key={index}>{renderInline(block.text)}</Heading>;
      }
      case 'paragraph':
        return <p key={index}>{renderInline(block.text)}</p>;
      case 'quote':
        return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
      case 'code':
        return (
          <pre key={index}>
            <code>{block.text}</code>
          </pre>
        );
      case 'list': {
        const List = block.ordered ? 'ol' : 'ul';
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </List>
        );
      }
    }
  });
}

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string): ReactNode {
  const parts = text.split(INLINE_PATTERN);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (
      ((part.startsWith('*') && part.endsWith('*')) ||
        (part.startsWith('_') && part.endsWith('_'))) &&
      part.length > 2
    ) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link !== null) {
      return (
        <Fragment key={index}>
          {link[1]} <span className={styles.markdownUrl}>({link[2]})</span>
        </Fragment>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
