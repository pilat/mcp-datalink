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

/** Normalized result format across all database drivers */
export interface RawQueryResult {
  fields: Array<{ name: string }>;
  rows: unknown[][];
  rowCount: number;
}

/** Implemented by each database driver */
export interface DatabaseAdapter {
  readonly type: 'postgresql' | 'mysql' | 'sqlite';

  withConnection<T>(fn: (conn: AdapterConnection) => Promise<T>): Promise<T>;

  /** PostgreSQL: "public", MySQL: db name from URL, SQLite: "main" */
  getDefaultSchema(): string;

  dispose(): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Dialect methods
  // ─────────────────────────────────────────────────────────────────────────────

  /** Parse and validate SQL (rejects multi-statement, dangerous ops) */
  parseQuery(sql: string): ParsedQuery;

  /** Add LIMIT if missing */
  injectLimit(sql: string, limit: number): string;

  /** Validate query is appropriate for tool (query=SELECT, execute=INSERT/UPDATE/DELETE) */
  validateQueryForTool(sql: string, tool: 'query' | 'execute'): void;

  getExplainPrefix(analyze: boolean): string;

  /** PostgreSQL: no-op, MySQL/SQLite: $1 -> ? */
  convertPlaceholders(sql: string): string;
}

/** Active connection handle for a single request */
export interface AdapterConnection {
  query(sql: string, params?: unknown[]): Promise<RawQueryResult>;

  /** For internal commands only (SET, BEGIN, COMMIT) - never user input */
  execute(sql: string): Promise<void>;

  listTables(schema: string, maxTables: number): Promise<ListTablesInternalResult>;

  describeTable(
    table: string,
    schema: string,
    limits: { maxColumns: number; maxIndexes: number }
  ): Promise<TableDescription>;
}

export interface ListTablesInternalResult {
  tables: TableInfo[];
  truncated?: boolean;
  totalAvailable: number;
}

export interface AdapterConfig {
  database: DatabaseConfig;
  defaults: DefaultsConfig;
}
