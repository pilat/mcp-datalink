/**
 * Database Adapter Interfaces
 *
 * Core abstractions for multi-database support.
 */

import type {
  ParsedQuery,
  TableInfo,
  TableDescription,
  DefaultsConfig,
  DatabaseConfig,
} from '../types.js';

/**
 * Result from a raw query execution
 * Normalized format across all database drivers
 */
export interface RawQueryResult {
  /** Column metadata */
  fields: Array<{ name: string }>;
  /** Row data as arrays (positional, not named) */
  rows: unknown[][];
  /** Number of rows returned or affected */
  rowCount: number;
}

/**
 * Database adapter interface - implemented by each database driver
 *
 * Combines connection management with SQL dialect operations.
 */
export interface DatabaseAdapter {
  /** Unique identifier for this adapter type */
  readonly type: 'postgresql' | 'mysql' | 'sqlite';

  /**
   * Execute a function with a managed connection.
   * Connection is created at start and destroyed at end.
   */
  withConnection<T>(fn: (conn: AdapterConnection) => Promise<T>): Promise<T>;

  /**
   * Get the default schema name for this database type
   *
   * PostgreSQL: "public"
   * MySQL: database name from connection URL
   * SQLite: "main"
   */
  getDefaultSchema(): string;

  /**
   * Clean up any resources (called on server shutdown)
   */
  dispose(): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Dialect methods (formerly SqlDialect interface)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parse a SQL statement and validate it
   *
   * SECURITY: This validates:
   * - Single statement only (no multi-statement attacks)
   * - No dangerous operations (DROP, TRUNCATE, etc.)
   *
   * @param sql - Raw SQL to parse
   * @throws DbMcpError if SQL is invalid or multi-statement
   */
  parseQuery(sql: string): ParsedQuery;

  /**
   * Inject LIMIT clause if query doesn't have one
   *
   * Used to enforce maxRows limit on SELECT queries.
   *
   * @param sql - Original SQL
   * @param limit - Limit value to inject
   * @returns Modified SQL with LIMIT, or original if already has LIMIT
   */
  injectLimit(sql: string, limit: number): string;

  /**
   * Validate that a SQL query is appropriate for a specific tool
   *
   * @param sql - The SQL query string
   * @param tool - Either 'query' (SELECT only) or 'execute' (INSERT/UPDATE/DELETE)
   * @throws DbMcpError with QUERY_BLOCKED if query type is not allowed
   */
  validateQueryForTool(sql: string, tool: 'query' | 'execute'): void;

  /**
   * Get the EXPLAIN prefix for this dialect
   *
   * @param analyze - Whether to include ANALYZE
   * @returns Prefix to prepend to SQL for EXPLAIN
   *
   * PostgreSQL: "EXPLAIN " or "EXPLAIN ANALYZE "
   * MySQL: "EXPLAIN " or "EXPLAIN ANALYZE "
   * SQLite: "EXPLAIN QUERY PLAN "
   */
  getExplainPrefix(analyze: boolean): string;

  /**
   * Convert parameter placeholders to dialect-specific format
   *
   * PostgreSQL uses $1, $2, $3 (no conversion needed)
   * MySQL/SQLite use ? placeholders (convert $1 -> ?)
   *
   * @param sql - SQL with placeholders
   * @returns SQL with converted placeholders
   */
  convertPlaceholders(sql: string): string;
}

/**
 * Active connection handle - passed to tool implementations
 *
 * Provides database operations during a single request lifecycle.
 * Connection is automatically recycled after the request completes.
 */
export interface AdapterConnection {
  /**
   * Execute a parameterized query
   *
   * SECURITY: All user SQL MUST go through this method with parameters
   *
   * @param sql - SQL with placeholders ($1, $2 for PG; ? for MySQL/SQLite)
   * @param params - Parameter values (type-safe, prevents injection)
   */
  query(sql: string, params?: unknown[]): Promise<RawQueryResult>;

  /**
   * Execute a raw SQL statement (for SET, BEGIN, etc.)
   *
   * Only use for validated internal commands.
   * Never pass user-provided values through this method.
   */
  execute(sql: string): Promise<void>;

  /**
   * List tables in a schema (adapter-specific implementation)
   *
   * @param schema - Schema name (ignored for SQLite)
   * @param maxTables - Maximum number of tables to return
   */
  listTables(schema: string, maxTables: number): Promise<ListTablesInternalResult>;

  /**
   * Describe a table structure (adapter-specific implementation)
   *
   * @param table - Table name
   * @param schema - Schema name (ignored for SQLite)
   * @param limits - Limits for columns and indexes
   */
  describeTable(
    table: string,
    schema: string,
    limits: { maxColumns: number; maxIndexes: number }
  ): Promise<TableDescription>;
}

/**
 * Internal result from listTables before tool formatting
 */
export interface ListTablesInternalResult {
  tables: TableInfo[];
  totalAvailable: number;
}

/**
 * Configuration passed to adapter constructors
 */
export interface AdapterConfig {
  /** Database configuration (url, readonly, etc.) */
  database: DatabaseConfig;
  /** Default settings (timeout, limits) */
  defaults: DefaultsConfig;
}
