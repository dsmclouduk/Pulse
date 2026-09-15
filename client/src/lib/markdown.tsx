import type { ReactNode } from 'react';

/**
 * Minimal, safe markdown renderer for agent and operator comments.
 * Supports paragraphs, **bold**, _italic_, `code`, "- " bullets and "1. " numbered lists.
 * Everything is rendered as React elements; no raw HTML is ever injected.
 */

type Block =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] };

const INLINE_PATTERN = /(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_PATTERN).filter((part) => part.length > 0);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-[var(--color-text)]">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      return (
        <em key={key} className="text-[var(--color-text-secondary)]">
          {part.slice(1, -1)}
        </em>
      );
    }

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-[var(--color-header)] px-1 py-0.5 font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={key}>{part}</span>;
  });
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  const flush = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line.trim() === '') {
      flush();
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (bullet) {
      if (current?.type !== 'bullets') {
        flush();
        current = { type: 'bullets', items: [] };
      }
      current.items.push(bullet[1]);
      continue;
    }

    if (numbered) {
      if (current?.type !== 'numbered') {
        flush();
        current = { type: 'numbered', items: [] };
      }
      current.items.push(numbered[1]);
      continue;
    }

    if (current?.type !== 'paragraph') {
      flush();
      current = { type: 'paragraph', lines: [] };
    }
    current.lines.push(line.trim());
  }

  flush();
  return blocks;
}

export function Markdown({ source, className = '' }: Readonly<{ source: string; className?: string }>) {
  const blocks = parseBlocks(source);

  return (
    <div className={`space-y-2 text-xs leading-relaxed text-[var(--color-text)] ${className}`}>
      {blocks.map((block, blockIndex) => {
        const key = `block-${blockIndex}`;

        if (block.type === 'bullets') {
          return (
            <ul key={key} className="list-disc space-y-0.5 pl-4">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === 'numbered') {
          return (
            <ol key={key} className="list-decimal space-y-0.5 pl-4">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={key}>
            {block.lines.map((line, lineIndex) => (
              <span key={`${key}-${lineIndex}`}>
                {lineIndex > 0 && <br />}
                {renderInline(line, `${key}-${lineIndex}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
