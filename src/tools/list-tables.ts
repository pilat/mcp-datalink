/**
 * list_tables tool - lists tables in a database schema
 */

import type { Config, ListTablesParams, ListTablesResult } from '../types.js';

import { createAdapter } from '../adapters/index.js';
import { formatAsMarkdownTable } from '../utils/formatter.js';

/**
 * Format ListTablesResult as Markdown table
 */
export function formatListTablesResultAsMarkdown(result: ListTablesResult): string {
  const parts: string[] = [];

  if (result.tables.length > 0) {
    const headers = ['name', 'schema', 'type', 'rows_estimate'];
    const rows = result.tables.map((table) => [
      table.name,
      table.schema,
      table.type,
      table.rows_estimate !== null ? String(table.rows_estimate) : 'NULL',
    ]);
    parts.push(formatAsMarkdownTable(headers, rows));
  } else {
    parts.push('_No tables found_');
  }

  if (result.truncated && result.totalAvailable !== undefined) {
    parts.push('');
    parts.push(`**Note:** Showing ${result.tables.length} of ${result.totalAvailable} tables`);
  }

  return parts.join('\n');
}
import { getValidatedDatabase } from '../utils/validation.js';

/**
 * Lists tables and views in a database schema.
 *
 * @param params - Database name and optional schema (defaults to "public")
 * @param config - The application config
 * @returns List of tables with truncation info if over maxTables limit
 */
export async function listTables(
  params: ListTablesParams,
  config: Config
): Promise<ListTablesResult> {
  const maxTables = config.defaults.maxTables;
  const dbConfig = getValidatedDatabase(params.database, config);
  const adapter = createAdapter(dbConfig, config.defaults);
  const schema = params.schema ?? adapter.getDefaultSchema();

  return adapter.withConnection(async (conn) => {
    const result = await conn.listTables(schema, maxTables);
    const allTables = result.tables;
    const totalAvailable = result.totalAvailable;
    const truncated = totalAvailable > maxTables;

    if (truncated) {
      return {
        tables: allTables.slice(0, maxTables),
        truncated: true,
        totalAvailable,
      };
    }

    return {
      tables: allTables,
      truncated: false,
    };
  });
}
