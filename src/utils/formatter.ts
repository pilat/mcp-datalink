/**
 * Formatting utilities for query results
 */

/**
 * Format a single value for display
 * Handles null, dates, objects, and primitive values
 */
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
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Escape pipe characters in cell content for Markdown tables
 */
function escapeForMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/**
 * Format query results as a Markdown table
 */
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
