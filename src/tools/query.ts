/**
 * Query tool for executing SELECT statements
 */

import type { Config, QueryResult } from '../types.js';
import { createAdapter } from '../adapters/index.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';
import { truncateRows, truncateCell, checkTotalSize } from '../utils/truncate.js';
import { formatAsMarkdownTable, formatValue } from '../utils/formatter.js';

export interface QueryParams {
  database: string;
  sql: string;
  params?: unknown[];
}

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

  // Get database config
  const dbConfig = config.databases[params.database];
  if (!dbConfig) {
    throw new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      `Database "${params.database}" not found in configuration`,
      { database: params.database, available: Object.keys(config.databases) }
    );
  }

  // Create adapter for this database
  const adapter = createAdapter(dbConfig, config.defaults);

  // Step 1: Validate that this is a SELECT query
  adapter.validateQueryForTool(params.sql, 'query');

  // Step 2: Parse query and inject LIMIT if missing
  const parsed = adapter.parseQuery(params.sql);
  let sql = params.sql;

  if (!parsed.hasLimit) {
    // Get maxRows from database config or defaults
    const maxRows = dbConfig?.maxRows ?? config.defaults.maxRows;
    sql = adapter.injectLimit(params.sql, maxRows);
  }

  // Step 3: Convert placeholders for non-PostgreSQL dialects
  // PostgreSQL uses $1, $2; MySQL/SQLite use ?
  sql = adapter.convertPlaceholders(sql);

  const result = await adapter.withConnection(async (conn) => {
    return conn.query(sql, params.params ?? []);
  });

  const columns = result.fields.map((field) => field.name);
  const rawRows = result.rows;

  // Step 4: Format each cell value
  let formattedRows: string[][] = rawRows.map((row) =>
    row.map((cell) => formatValue(cell))
  );

  // Step 5: Truncate individual cells if over maxCellLength
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

  // Step 6: Truncate rows if over maxRows
  const { rows: truncatedRows, info: rowTruncationInfo } = truncateRows(
    formattedRows,
    config.defaults.maxRows
  );

  // Step 7: Check total size
  const tableOutput = formatAsMarkdownTable(columns, truncatedRows as string[][]);
  const sizeInfo = checkTotalSize(tableOutput, config.defaults.maxTotalSize);

  // Determine final truncation state
  const truncated = rowTruncationInfo.truncated || anyCellTruncated || sizeInfo.truncated;

  // Determine truncation reason (priority: maxTotalSize > maxRows > maxCellLength)
  let truncationReason: string | undefined;
  if (sizeInfo.truncated) {
    truncationReason = sizeInfo.truncationReason;
  } else if (rowTruncationInfo.truncated) {
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
    hint: rowTruncationInfo.hint ?? sizeInfo.hint,
    executionTime,
  };
}
