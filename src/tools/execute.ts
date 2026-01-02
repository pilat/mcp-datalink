/**
 * Execute tool for INSERT/UPDATE/DELETE statements
 */

import type { Config, ExecuteResult } from '../types.js';
import { createAdapter } from '../adapters/index.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

export interface ExecuteParams {
  database: string;
  sql: string;
  params?: unknown[];
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

  // Get database config
  const dbConfig = config.databases[params.database];
  if (!dbConfig) {
    throw new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      `Database "${params.database}" not found in configuration`,
      { database: params.database, available: Object.keys(config.databases) }
    );
  }

  // Step 1: Check if database is readonly
  if (dbConfig.readonly) {
    throw new DbMcpError(
      ErrorCode.READONLY_VIOLATION,
      `Database "${params.database}" is configured as readonly. INSERT/UPDATE/DELETE operations are not allowed.`,
      { database: params.database }
    );
  }

  // Create adapter for this database
  const adapter = createAdapter(dbConfig, config.defaults);

  // Step 2: Validate query type - blocks SELECT and dangerous DDL
  adapter.validateQueryForTool(params.sql, 'execute');

  // Step 3: Get the command type from parsed query
  const parsed = adapter.parseQuery(params.sql);
  const command = parsed.type.toUpperCase();

  // Step 4: Convert placeholders for non-PostgreSQL dialects
  // PostgreSQL uses $1, $2; MySQL/SQLite use ?
  const sql = adapter.convertPlaceholders(params.sql);

  const result = await adapter.withConnection(async (conn) => {
    return conn.query(sql, params.params ?? []);
  });

  const executionTime = Date.now() - startTime;

  return {
    command,
    rowsAffected: result.rowCount,
    executionTime,
  };
}
