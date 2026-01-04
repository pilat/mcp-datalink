/**
 * describe_table tool - Returns table structure including columns, indexes, and foreign keys
 */

import type { Config, DescribeTableParams, TableDescription } from '../types.js';

import { createAdapter } from '../adapters/index.js';
import { formatAsMarkdownTable } from '../utils/formatter.js';

/**
 * Format TableDescription as Markdown with sections for columns, indexes, and foreign keys
 */
export function formatTableDescriptionAsMarkdown(result: TableDescription): string {
  const parts: string[] = [];

  // Header
  parts.push(`## ${result.schema}.${result.table}`);
  parts.push('');

  // Columns section
  parts.push('### Columns');
  if (result.columns.length > 0) {
    const columnHeaders = ['name', 'type', 'nullable', 'default', 'primary_key'];
    const columnRows = result.columns.map((col) => [
      col.name,
      col.type,
      col.nullable ? 'YES' : 'NO',
      col.default ?? 'NULL',
      col.primaryKey ? 'YES' : 'NO',
    ]);
    parts.push(formatAsMarkdownTable(columnHeaders, columnRows));
  } else {
    parts.push('_No columns_');
  }
  parts.push('');

  // Indexes section
  parts.push('### Indexes');
  if (result.indexes.length > 0) {
    const indexHeaders = ['name', 'columns', 'unique', 'primary'];
    const indexRows = result.indexes.map((idx) => [
      idx.name,
      idx.columns.join(', '),
      idx.unique ? 'YES' : 'NO',
      idx.primary ? 'YES' : 'NO',
    ]);
    parts.push(formatAsMarkdownTable(indexHeaders, indexRows));
  } else {
    parts.push('_No indexes_');
  }
  parts.push('');

  // Foreign keys section
  parts.push('### Foreign Keys');
  if (result.foreignKeys.length > 0) {
    const fkHeaders = ['column', 'references_table', 'references_column'];
    const fkRows = result.foreignKeys.map((fk) => [
      fk.column,
      fk.references.table,
      fk.references.column,
    ]);
    parts.push(formatAsMarkdownTable(fkHeaders, fkRows));
  } else {
    parts.push('_No foreign keys_');
  }

  // Truncation info
  if (result.truncated && result.truncationReason) {
    parts.push('');
    parts.push(`**Note:** Results truncated (${result.truncationReason})`);
  }

  return parts.join('\n');
}
import { getValidatedDatabase } from '../utils/validation.js';

export async function describeTable(
  params: DescribeTableParams,
  config: Config
): Promise<TableDescription> {
  const { table, database } = params;
  const { maxColumns, maxIndexes } = config.defaults;
  const dbConfig = getValidatedDatabase(database, config);
  const adapter = createAdapter(dbConfig, config.defaults);
  const schema = params.schema ?? adapter.getDefaultSchema();

  return adapter.withConnection(async (conn) => {
    return conn.describeTable(table, schema, { maxColumns, maxIndexes });
  });
}
