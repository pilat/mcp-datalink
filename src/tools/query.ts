/**
 * Query tool for executing SELECT statements
 */

import type { Config, QueryParams, QueryResult } from '../types.js';

import { createAdapter } from '../adapters/index.js';
import { formatAsMarkdownTable, formatValue } from '../utils/formatter.js';
import { truncateCell, truncateRows } from '../utils/truncate.js';
import { getValidatedDatabase, validateParamCount } from '../utils/validation.js';

/**
 * Format QueryResult as Markdown table followed by metadata
 */
export function formatQueryResultAsMarkdown(result: QueryResult): string {
  const parts: string[] = [];

  // Data as Markdown table
  const table = formatAsMarkdownTable(result.columns, result.rows as string[][]);
  if (table) {
    parts.push(table);
  } else {
    parts.push('_No results_');
  }

  // Metadata section
  parts.push('');
  parts.push(`**Rows:** ${result.rowCount}${result.truncated ? ` (truncated from ${result.totalAvailable ?? 'unknown'})` : ''}`);
  parts.push(`**Execution time:** ${result.executionTime}ms`);

  if (result.truncated && result.hint) {
    parts.push(`**Hint:** ${result.hint}`);
  }

  return parts.join('\n');
}

/**
 * Execute a SELECT query and return formatted results
 *
 * @param params - Query parameters including database name, SQL, and optional params
 * @param config - Application configuration
 * @returns QueryResult with columns, rows, and metadata
 * @throws DbMcpError with QUERY_BLOCKED if not a SELECT query
 * @throws DbMcpError with DATABASE_NOT_FOUND if database not configured
 * @throws DbMcpError with CONNECTION_FAILED if connection fails
 */
export async function query(
  params: QueryParams,
  config: Config
): Promise<QueryResult> {
  const startTime = Date.now();
  const dbConfig = getValidatedDatabase(params.database, config);
  const adapter = createAdapter(dbConfig, config.defaults);

  adapter.validateQueryForTool(params.sql, 'query');
  validateParamCount(params.sql, params.params ?? []);

  const parsed = adapter.parseQuery(params.sql);
  let sql = params.sql;

  if (!parsed.hasLimit) {
    const maxRows = dbConfig?.maxRows ?? config.defaults.maxRows;
    sql = adapter.injectLimit(params.sql, maxRows);
  }

  sql = adapter.convertPlaceholders(sql);

  const result = await adapter.withConnection(async (conn) => {
    return conn.query(sql, params.params ?? []);
  });

  const columns = result.fields.map((field) => field.name);
  const rawRows = result.rows;

  let formattedRows: string[][] = rawRows.map((row) =>
    row.map((cell) => formatValue(cell))
  );

  let anyCellTruncated = false;
  formattedRows = formattedRows.map((row) =>
    row.map((cell) => {
      const truncated = truncateCell(cell, config.defaults.maxCellLength);
      if (truncated.truncated) {
        anyCellTruncated = true;
      }
      return truncated.value;
    })
  );

  const { rows: truncatedRows, info: rowTruncationInfo } = truncateRows(
    formattedRows,
    config.defaults.maxRows
  );

  const truncated = rowTruncationInfo.truncated || anyCellTruncated;

  let truncationReason: string | undefined;
  if (rowTruncationInfo.truncated) {
    truncationReason = rowTruncationInfo.truncationReason;
  } else if (anyCellTruncated) {
    truncationReason = 'maxCellLength';
  }

  const executionTime = Date.now() - startTime;

  return {
    columns,
    rows: truncatedRows as unknown[][],
    rowCount: truncatedRows.length,
    truncated,
    truncationReason,
    totalAvailable: rowTruncationInfo.totalAvailable,
    returned: rowTruncationInfo.returned,
    hint: rowTruncationInfo.hint,
    executionTime,
  };
}
