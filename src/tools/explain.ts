/**
 * Explain tool for showing query execution plans
 */

import type { Config } from '../types.js';
import { createAdapter } from '../adapters/index.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

export interface ExplainParams {
  database: string;
  sql: string;
  analyze?: boolean; // default: false
}

export interface ExplainResult {
  plan: string;
  executionTime: number;
}

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

  // Step 1: Parse query and check for dangerous operations
  const parsed = adapter.parseQuery(params.sql);

  if (parsed.isDangerous) {
    throw new DbMcpError(
      ErrorCode.QUERY_BLOCKED,
      parsed.dangerousReason ?? 'This operation is not allowed',
      { sql: params.sql, queryType: parsed.type }
    );
  }

  const result = await adapter.withConnection(async (conn) => {
    // Build EXPLAIN query using adapter-specific prefix
    const explainPrefix = adapter.getExplainPrefix(params.analyze ?? false);

    // SQLite and MySQL don't need READ ONLY transactions for EXPLAIN:
    // - SQLite: Doesn't support READ ONLY transactions
    // - MySQL: EXPLAIN doesn't execute the query, and READ ONLY tx blocks
    //   EXPLAIN on UPDATE/DELETE even though they're safe
    //
    // Defense in depth is still provided by:
    // 1. SQL parser blocking dangerous operations (DROP, TRUNCATE, etc.)
    // 2. EXPLAIN not executing the query (MySQL) / EXPLAIN QUERY PLAN (SQLite)
    // 3. Database adapter opening in readonly mode when configured
    if (adapter.type === 'sqlite' || adapter.type === 'mysql') {
      return await conn.query(explainPrefix + params.sql);
    }

    // PostgreSQL: Use READ ONLY transaction since EXPLAIN ANALYZE executes the query
    await conn.execute('BEGIN TRANSACTION READ ONLY');

    try {
      const queryResult = await conn.query(explainPrefix + params.sql);

      await conn.execute('COMMIT');
      return queryResult;
    } catch (error) {
      await conn.execute('ROLLBACK');
      throw error;
    }
  });

  // Step 3: Format plan as text (join rows with newlines)
  // Different databases have different EXPLAIN output formats:
  // - PostgreSQL: Single column with plan text
  // - MySQL: Multiple columns (id, select_type, table, type, key, rows, Extra, etc.)
  // - SQLite: 4 columns (id, parent, notused, detail)
  const planLines = result.rows.map((row) => {
    if (adapter.type === 'sqlite' && row.length >= 4) {
      // SQLite: extract the 'detail' column (4th column, index 3)
      return String(row[3]);
    }
    if (adapter.type === 'mysql' && row.length > 1) {
      // MySQL: Join all columns with tabs for tabular output
      // Columns: id, select_type, table, partitions, type, possible_keys, key, key_len, ref, rows, filtered, Extra
      return row.map((col) => (col === null ? 'NULL' : String(col))).join('\t');
    }
    // PostgreSQL: first column is the plan line
    return row[0] as string;
  });

  const executionTime = Date.now() - startTime;

  return {
    plan: planLines.join('\n'),
    executionTime,
  };
}
