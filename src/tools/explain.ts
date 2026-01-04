/**
 * Explain tool for showing query execution plans
 */

import type { Config, ExplainParams, ExplainResult } from '../types.js';

import { createAdapter } from '../adapters/index.js';

/**
 * Format ExplainResult as Markdown
 */
export function formatExplainResultAsMarkdown(result: ExplainResult): string {
  const parts: string[] = [];

  parts.push('```');
  parts.push(result.plan);
  parts.push('```');
  parts.push('');
  parts.push(`**Execution time:** ${result.executionTime}ms`);

  return parts.join('\n');
}
import { DbMcpError, ErrorCode } from '../utils/errors.js';
import { getValidatedDatabase } from '../utils/validation.js';

/**
 * Get the execution plan for a SQL query
 *
 * @param params - Explain parameters including database name, SQL, and optional analyze flag
 * @param config - Application configuration
 * @returns ExplainResult with plan text and execution time
 * @throws DbMcpError with QUERY_BLOCKED if query is dangerous (DROP, TRUNCATE, etc.)
 * @throws DbMcpError with DATABASE_NOT_FOUND if database not configured
 * @throws DbMcpError with CONNECTION_FAILED if connection fails
 */
export async function explain(
  params: ExplainParams,
  config: Config
): Promise<ExplainResult> {
  const startTime = Date.now();
  const dbConfig = getValidatedDatabase(params.database, config);
  const adapter = createAdapter(dbConfig, config.defaults);

  const parsed = adapter.parseQuery(params.sql);

  if (parsed.isDangerous) {
    throw new DbMcpError(
      ErrorCode.QUERY_BLOCKED,
      parsed.dangerousReason ?? 'This operation is not allowed',
      { sql: params.sql, queryType: parsed.type }
    );
  }

  const result = await adapter.withConnection(async (conn) => {
    const explainPrefix = adapter.getExplainPrefix(params.analyze ?? false);

    // SQLite/MySQL: EXPLAIN doesn't execute the query, no transaction needed
    // PostgreSQL: EXPLAIN ANALYZE runs the query, wrap in READ ONLY transaction
    if (adapter.type === 'sqlite' || adapter.type === 'mysql') {
      return await conn.query(explainPrefix + params.sql);
    }

    await conn.execute('BEGIN TRANSACTION READ ONLY');

    try {
      const queryResult = await conn.query(explainPrefix + params.sql);

      await conn.execute('COMMIT');
      return queryResult;
    } catch (error: unknown) {
      await conn.execute('ROLLBACK');
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  });

  const planLines = result.rows.map((row) => {
    if (row.length === 0) {
      return '';
    }
    if (adapter.type === 'sqlite' && row.length >= 4) {
      // SQLite: extract the 'detail' column (4th column, index 3)
      return String(row[3] ?? '');
    }
    if (adapter.type === 'mysql' && row.length > 1) {
      // MySQL: Join all columns with tabs for tabular output
      // Columns: id, select_type, table, partitions, type, possible_keys, key, key_len, ref, rows, filtered, Extra
      return row.map((col) => (col === null ? 'NULL' : String(col))).join('\t');
    }
    // PostgreSQL: first column is the plan line
    return String(row[0] ?? '');
  });

  const executionTime = Date.now() - startTime;

  return {
    plan: planLines.join('\n'),
    executionTime,
  };
}
