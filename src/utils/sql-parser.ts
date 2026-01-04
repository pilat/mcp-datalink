/**
 * Unified SQL Parser Utility
 *
 * Provides SQL parsing and validation for PostgreSQL, MySQL, and SQLite
 * using node-sql-parser library.
 */

import { AST, Parser } from 'node-sql-parser';

import type { QueryType } from '../types.js';

import { DbMcpError, ErrorCode } from './errors.js';

/**
 * Supported SQL dialects
 */
export type SqlDialect = 'PostgreSQL' | 'MySQL' | 'SQLite';

/**
 * Prefixes that indicate dangerous SQL operations
 */
const DANGEROUS_PREFIXES: ReadonlyArray<string> = [
  'drop',
  'truncate',
  'alter',
  'create',
  'grant',
  'revoke',
  'rename',
];

/**
 * SQLite-specific dangerous operations
 */
const SQLITE_DANGEROUS_OPERATIONS: ReadonlyArray<string> = [
  'attach',
  'detach',
  'vacuum',
  'reindex',
];

/**
 * SQLite-specific operations that node-sql-parser cannot parse.
 * These need to be detected before parsing to throw QUERY_BLOCKED instead of INVALID_SQL.
 * Note: ATTACH is parseable by node-sql-parser, so it's excluded from this list.
 */
const SQLITE_UNPARSEABLE_OPERATIONS: ReadonlyArray<string> = [
  'detach',
  'vacuum',
  'reindex',
];

/**
 * Check if SQL starts with a SQLite-specific dangerous operation
 * that node-sql-parser cannot parse
 *
 * @param sql - SQL query to check
 * @returns Object with isDangerous flag and optional reason
 */
function checkSqliteUnparseableDangerousPrefix(sql: string): { isDangerous: boolean; reason?: string } {
  const normalized = sql.trim().toLowerCase();

  for (const op of SQLITE_UNPARSEABLE_OPERATIONS) {
    if (normalized.startsWith(op)) {
      return {
        isDangerous: true,
        reason: `${op.toUpperCase()} statements are not allowed`,
      };
    }
  }

  return { isDangerous: false };
}

/**
 * Create a parser instance for the specified dialect
 */
function createParser(): Parser {
  return new Parser();
}

/**
 * Parse SQL and return AST
 *
 * @param sql - SQL query to parse
 * @param dialect - SQL dialect (PostgreSQL, MySQL, SQLite)
 * @returns Parsed AST
 * @throws DbMcpError if parsing fails or SQL contains dangerous operations
 */
function parseSQL(sql: string, dialect: SqlDialect): AST | AST[] {
  // For SQLite, check for dangerous unparseable operations before parsing
  // since node-sql-parser may not recognize these statements
  if (dialect === 'SQLite') {
    const { isDangerous, reason } = checkSqliteUnparseableDangerousPrefix(sql);
    if (isDangerous) {
      throw new DbMcpError(
        ErrorCode.QUERY_BLOCKED,
        reason ?? 'Statement is not allowed',
        { sql }
      );
    }
  }

  const parser = createParser();

  try {
    return parser.astify(sql, { database: dialect });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    throw new DbMcpError(
      ErrorCode.INVALID_SQL,
      'Failed to parse SQL: ' + message,
      { sql }
    );
  }
}

/**
 * Convert AST back to SQL string
 *
 * @param ast - AST to convert
 * @param dialect - SQL dialect
 * @returns SQL string
 */
function astToSQL(ast: AST | AST[], dialect: SqlDialect): string {
  const parser = createParser();
  return parser.sqlify(ast, { database: dialect });
}

/**
 * Check if a SQL statement type is dangerous
 *
 * @param stmtType - Statement type from AST
 * @param dialect - SQL dialect
 * @returns Object with isDangerous flag and optional reason
 */
function checkDangerousType(
  stmtType: string,
  dialect: SqlDialect
): { isDangerous: boolean; reason?: string } {
  const normalizedType = stmtType.toLowerCase();

  // Check common dangerous prefixes
  for (const prefix of DANGEROUS_PREFIXES) {
    if (normalizedType === prefix || normalizedType.startsWith(prefix)) {
      return {
        isDangerous: true,
        reason: `${prefix.toUpperCase()} statements are not allowed`,
      };
    }
  }

  // Check SQLite-specific dangerous operations
  if (dialect === 'SQLite') {
    for (const op of SQLITE_DANGEROUS_OPERATIONS) {
      if (normalizedType === op || normalizedType.startsWith(op)) {
        return {
          isDangerous: true,
          reason: `${op.toUpperCase()} statements are not allowed`,
        };
      }
    }
  }

  return { isDangerous: false };
}

/**
 * Regular expression to check for LIMIT clause in SQL
 * Matches LIMIT followed by a number, handling whitespace
 */
const LIMIT_PATTERN = /\bLIMIT\s+\d+/i;

/**
 * Inject a LIMIT clause into a SELECT query if it doesn't have one
 *
 * @param sql - SQL query
 * @param limit - Maximum number of rows
 * @param dialect - SQL dialect
 * @returns SQL with LIMIT clause
 */
export function injectLimit(sql: string, limit: number, dialect: SqlDialect): string {
  const ast = parseSQL(sql, dialect);
  const statements = Array.isArray(ast) ? ast : [ast];

  if (statements.length !== 1) {
    return sql;
  }

  const stmt = statements[0];

  if (stmt.type !== 'select') {
    return sql;
  }

  const selectStmt = stmt as AST & { limit?: { seperator?: string; value: Array<{ type: string; value: number }> } };

  // Check if already has limit (value array must have entries)
  if (selectStmt.limit && Array.isArray(selectStmt.limit.value) && selectStmt.limit.value.length > 0) {
    return sql;
  }

  // Add limit clause
  selectStmt.limit = {
    seperator: '',
    value: [{ type: 'number', value: limit }],
  };

  const result = astToSQL(stmt, dialect);

  // Verify that LIMIT was actually added to the result
  if (!LIMIT_PATTERN.test(result)) {
    // LIMIT injection failed - fall back to original SQL
    // This is a safety measure in case astToSQL doesn't properly serialize the limit
    console.warn(
      `[mcp-datalink] LIMIT injection verification failed: astToSQL did not produce LIMIT clause. ` +
      `Returning original SQL. Dialect: ${dialect}`
    );
    return sql;
  }

  return result;
}

/**
 * Result of parsing a SQL query
 */
export interface ParseResult {
  type: QueryType;
  hasLimit: boolean;
  isDangerous: boolean;
  dangerousReason?: string;
  sql: string;
}

/**
 * Allowed query types for the execute tool
 */
const EXECUTE_ALLOWED_TYPES: ReadonlyArray<QueryType> = ['insert', 'update', 'delete'];

/**
 * Data-modifying statement types that should not be in CTEs for query tool
 */
const DATA_MODIFYING_TYPES: ReadonlyArray<string> = ['insert', 'update', 'delete'];

/**
 * Check if a CTE contains data-modifying statements
 *
 * PostgreSQL supports data-modifying CTEs like:
 *   WITH inserted AS (INSERT ... RETURNING *) SELECT * FROM inserted
 *
 * These modify data even though the outer query is a SELECT.
 *
 * @param ast - Parsed AST
 * @returns Object with hasDataModifyingCTE flag and optional reason
 */
function checkDataModifyingCTE(
  ast: AST
): { hasDataModifyingCTE: boolean; reason?: string } {
  const withClause = (ast as AST & { with?: Array<{ stmt?: { type?: string } }> }).with;

  if (!Array.isArray(withClause)) {
    return { hasDataModifyingCTE: false };
  }

  for (const cte of withClause) {
    const stmtType = cte.stmt?.type?.toLowerCase();
    if (stmtType && DATA_MODIFYING_TYPES.includes(stmtType)) {
      return {
        hasDataModifyingCTE: true,
        reason: `CTE contains data-modifying ${stmtType.toUpperCase()} statement`,
      };
    }
  }

  return { hasDataModifyingCTE: false };
}

/**
 * Parse and validate a SQL query
 *
 * @param sql - SQL query to parse
 * @param dialect - SQL dialect
 * @returns Parsed query information
 * @throws DbMcpError if query is invalid or contains multiple statements
 */
export function parseQuery(sql: string, dialect: SqlDialect): ParseResult {
  const ast = parseSQL(sql, dialect);
  const statements = Array.isArray(ast) ? ast : [ast];

  // Filter out null/undefined entries
  const validStatements = statements.filter((s) => s !== null && s !== undefined);

  if (validStatements.length === 0) {
    throw new DbMcpError(
      ErrorCode.INVALID_SQL,
      'No valid SQL statement found',
      { sql }
    );
  }

  if (validStatements.length > 1) {
    throw new DbMcpError(
      ErrorCode.MULTI_STATEMENT,
      'Multiple SQL statements are not allowed. Please provide a single statement.',
      { sql, statementCount: validStatements.length }
    );
  }

  const stmt = validStatements[0];
  const stmtType = (stmt.type ?? '').toLowerCase();

  // Determine query type
  let queryType: QueryType;
  switch (stmtType) {
    case 'select':
      queryType = 'select';
      break;
    case 'insert':
      queryType = 'insert';
      break;
    case 'update':
      queryType = 'update';
      break;
    case 'delete':
      queryType = 'delete';
      break;
    default:
      queryType = 'other';
  }

  // Check for dangerous operations
  let { isDangerous, reason } = checkDangerousType(stmtType, dialect);

  // Check for data-modifying CTEs (e.g. WITH x AS (INSERT ...) SELECT ...)
  if (!isDangerous) {
    const cteCheck = checkDataModifyingCTE(stmt);
    if (cteCheck.hasDataModifyingCTE) {
      isDangerous = true;
      reason = cteCheck.reason;
    }
  }

  // Check for LIMIT clause
  let hasLimit = false;
  if (queryType === 'select') {
    const selectStmt = stmt as AST & { limit?: { value?: unknown[] } | null };
    // node-sql-parser returns limit: { value: [] } even when no LIMIT is present
    hasLimit = !!(selectStmt.limit && Array.isArray(selectStmt.limit.value) && selectStmt.limit.value.length > 0);
  }

  return {
    type: queryType,
    hasLimit,
    isDangerous,
    dangerousReason: reason,
    sql,
  };
}

/**
 * Validate that a parsed SQL query is appropriate for a specific tool
 *
 * This function contains the shared validation logic used by all database adapters.
 * Adapters may perform additional adapter-specific checks before calling this.
 *
 * @param parsed - Parsed query result from parseQuery
 * @param tool - Tool being used ('query' for SELECT, 'execute' for INSERT/UPDATE/DELETE)
 * @throws DbMcpError if the query is not appropriate for the specified tool
 */
export function validateQueryForTool(
  parsed: ParseResult,
  tool: 'query' | 'execute'
): void {
  if (tool === 'query') {
    if (parsed.type !== 'select') {
      throw new DbMcpError(
        ErrorCode.QUERY_BLOCKED,
        'The query tool only accepts SELECT statements. Use the execute tool for ' +
          parsed.type.toUpperCase() +
          ' statements.',
        { sql: parsed.sql, queryType: parsed.type, tool }
      );
    }

    // Block data-modifying CTEs in query tool
    if (parsed.isDangerous) {
      throw new DbMcpError(
        ErrorCode.QUERY_BLOCKED,
        parsed.dangerousReason ?? 'This operation is not allowed',
        { sql: parsed.sql, queryType: parsed.type, tool }
      );
    }
  } else if (tool === 'execute') {
    if (parsed.type === 'select') {
      throw new DbMcpError(
        ErrorCode.QUERY_BLOCKED,
        'The execute tool does not accept SELECT statements. Use the query tool instead.',
        { sql: parsed.sql, queryType: parsed.type, tool }
      );
    }

    if (parsed.isDangerous) {
      throw new DbMcpError(
        ErrorCode.QUERY_BLOCKED,
        parsed.dangerousReason ?? 'This operation is not allowed',
        { sql: parsed.sql, queryType: parsed.type, tool }
      );
    }

    if (!EXECUTE_ALLOWED_TYPES.includes(parsed.type)) {
      throw new DbMcpError(
        ErrorCode.QUERY_BLOCKED,
        'The execute tool only accepts INSERT, UPDATE, or DELETE statements.',
        { sql: parsed.sql, queryType: parsed.type, tool }
      );
    }
  }
}
