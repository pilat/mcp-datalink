/**
 * Formatting utilities for query results
 */

/**
 * JSON replacer function that handles BigInt values by converting them to strings.
 * This prevents "TypeError: Do not know how to serialize a BigInt" when using JSON.stringify.
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Safely stringify a value to JSON, handling BigInt values.
 */
export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, bigIntReplacer);
}

/** Format a value for display (handles null, dates, objects, primitives) */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    return safeJsonStringify(value);
  }

  return String(value);
}

function escapeForMarkdown(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/`/g, '\\`');
}

export function formatAsMarkdownTable(
  columns: string[],
  rows: (string | null)[][]
): string {
  if (columns.length === 0) {
    return '';
  }

  const lines: string[] = [];

  // Header row
  const headerCells = columns.map((col) => escapeForMarkdown(col));
  lines.push('| ' + headerCells.join(' | ') + ' |');

  // Alignment row
  const alignmentCells = columns.map(() => '---');
  lines.push('| ' + alignmentCells.join(' | ') + ' |');

  // Data rows
  for (const row of rows) {
    const cells = row.map((cell) => {
      const value = cell === null ? 'NULL' : cell;
      return escapeForMarkdown(value);
    });
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  return lines.join('\n');
}
