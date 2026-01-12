/**
 * Execute tool for INSERT/UPDATE/DELETE statements
 */

import type { Config, ExecuteParams, ExecuteResult } from '../types.js';

import { createAdapter } from '../adapters/index.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';
import { calculateTimeout } from '../utils/timeout.js';
import { getValidatedDatabase, validateParamCount } from '../utils/validation.js';

/**
 * Format ExecuteResult as Markdown
 */
export function formatExecuteResultAsMarkdown(result: ExecuteResult): string {
  const parts: string[] = [];

  parts.push(`**Command:** ${result.command}`);
  parts.push(`**Rows affected:** ${result.rowsAffected}`);
  parts.push(`**Execution time:** ${result.executionTime}ms`);

  return parts.join('\n');
}

/**
 * Execute an INSERT/UPDATE/DELETE statement
 *
 * @param params - Execute parameters including database name, SQL, and optional params
 * @param config - Application configuration
 * @returns ExecuteResult with command type and rows affected
 * @throws DbMcpError with READONLY_VIOLATION if database is readonly
 * @throws DbMcpError with QUERY_BLOCKED if SELECT or dangerous DDL
 * @throws DbMcpError with DATABASE_NOT_FOUND if database not configured
 * @throws DbMcpError with CONNECTION_FAILED if connection fails
 */
export async function execute(
  params: ExecuteParams,
  config: Config
): Promise<ExecuteResult> {
  const startTime = Date.now();
  const dbConfig = getValidatedDatabase(params.database, config);

  if (dbConfig.readonly) {
    throw new DbMcpError(
      ErrorCode.READONLY_VIOLATION,
      `Database "${params.database}" is configured as readonly. INSERT/UPDATE/DELETE operations are not allowed.`,
      { database: params.database }
    );
  }

  const adapter = createAdapter(dbConfig, config.defaults);
  adapter.validateQueryForTool(params.sql, 'execute');
  validateParamCount(params.sql, params.params ?? []);

  const parsed = adapter.parseQuery(params.sql);
  const command = parsed.type.toUpperCase();
  const sql = adapter.convertPlaceholders(params.sql);

  const timeout = calculateTimeout(
    params.timeout,
    dbConfig.maxTimeout,
    config.defaults.timeout
  );

  const result = await adapter.withConnection(async (conn) => {
    return conn.query(sql, params.params ?? []);
  }, { timeout });

  const executionTime = Date.now() - startTime;

  return {
    command,
    rowsAffected: result.rowCount,
    executionTime,
  };
}
