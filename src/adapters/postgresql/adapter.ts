/**
 * PostgreSQL Database Adapter
 *
 * Implements DatabaseAdapter interface for PostgreSQL databases.
 * Uses node-postgres (pg) driver with per-request connection recycling.
 */

import pg from 'pg';

import type {
  AdapterConfig,
  AdapterConnection,
  ConnectionOptions,
  DatabaseAdapter,
  ListTablesInternalResult,
  RawQueryResult,
} from '../types.js';
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  ParsedQuery,
  TableDescription,
  TableInfo,
} from '../../types.js';

import { DbMcpError, ErrorCode } from '../../utils/errors.js';
import {
  injectLimit as sharedInjectLimit,
  parseQuery as sharedParseQuery,
  validateQueryForTool as sharedValidateQueryForTool,
} from '../../utils/sql-parser.js';

/**
 * PostgreSQL database adapter
 *
 * Creates new connections for each request to prevent session state attacks.
 */
export class PostgreSqlAdapter implements DatabaseAdapter {
  readonly type = 'postgresql' as const;

  private readonly connectionUrl: string;
  private readonly timeout: number;

  constructor(config: AdapterConfig) {
    this.connectionUrl = config.database.url;
    this.timeout = config.defaults.timeout;
  }

  getDefaultSchema(): string {
    return 'public';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Dialect methods
  // ─────────────────────────────────────────────────────────────────────────────

  parseQuery(sql: string): ParsedQuery {
    return sharedParseQuery(sql, 'PostgreSQL');
  }

  injectLimit(sql: string, limit: number): string {
    return sharedInjectLimit(sql, limit, 'PostgreSQL');
  }

  validateQueryForTool(sql: string, tool: 'query' | 'execute'): void {
    const parsed = this.parseQuery(sql);
    sharedValidateQueryForTool(parsed, tool);
  }

  getExplainPrefix(analyze: boolean): string {
    return analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN ';
  }

  /** No-op for PostgreSQL (already uses $1, $2 placeholders) */
  convertPlaceholders(sql: string): string {
    return sql;
  }

  /**
   * Execute a function with a managed PostgreSQL connection
   */
  async withConnection<T>(
    fn: (conn: AdapterConnection) => Promise<T>,
    options?: ConnectionOptions
  ): Promise<T> {
    const timeout = options?.timeout ?? this.timeout;

    // Validate timeout before creating connection (SET command doesn't support parameters)
    if (!Number.isInteger(timeout) || timeout < 0) {
      throw new DbMcpError(
        ErrorCode.CONNECTION_FAILED,
        `Invalid timeout value: ${timeout}`
      );
    }

    const client = new pg.Client({
      connectionString: this.connectionUrl,
    });

    try {
      try {
        await client.connect();
      } catch (error) {
        throw new DbMcpError(
          ErrorCode.CONNECTION_FAILED,
          'Failed to connect to PostgreSQL database',
          {
            cause: error instanceof Error ? error.message : String(error),
          }
        );
      }

      await client.query(`SET statement_timeout = ${timeout}`);

      const connection = new PostgreSqlConnection(client);
      return await fn(connection);
    } finally {
      await client.end();
    }
  }

  async dispose(): Promise<void> {
    // No persistent connections to clean up
  }
}

/**
 * PostgreSQL connection wrapper
 *
 * Provides AdapterConnection interface over pg.Client.
 * Handles PostgreSQL-specific query execution and metadata retrieval.
 */
class PostgreSqlConnection implements AdapterConnection {
  constructor(private readonly client: pg.Client) {}

  /**
   * Execute a parameterized query
   *
   * SECURITY: All user SQL MUST go through this method with parameters.
   * Uses pg's parameterized query support ($1, $2, etc.)
   */
  async query(sql: string, params?: unknown[]): Promise<RawQueryResult> {
    const result = await this.client.query({
      text: sql,
      values: params ?? [],
      rowMode: 'array',
    });

    return {
      fields: result.fields.map((f) => ({ name: f.name })),
      rows: result.rows as unknown[][],
      rowCount: result.rowCount ?? 0,
    };
  }

  async execute(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  /**
   * List tables in a PostgreSQL schema
   *
   * Uses information_schema and pg_class for table metadata.
   * Fetches maxTables + 1 to detect truncation.
   */
  async listTables(schema: string, maxTables: number): Promise<ListTablesInternalResult> {
    const sql = `
      SELECT
        t.table_name as name,
        t.table_schema as schema,
        CASE WHEN t.table_type = 'BASE TABLE' THEN 'table' ELSE 'view' END as type,
        c.reltuples::bigint as rows_estimate
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
        AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.table_schema)
      WHERE t.table_schema = $1
      ORDER BY t.table_name
      LIMIT $2
    `;

    interface TableRow {
      name: string;
      schema: string;
      type: 'table' | 'view';
      rows_estimate: string | null;
    }

    const result = await this.client.query<TableRow>(sql, [schema, maxTables + 1]);

    const truncated = result.rows.length > maxTables;
    const tables: TableInfo[] = result.rows.slice(0, maxTables).map((row) => ({
      name: row.name,
      schema: row.schema,
      type: row.type,
      rows_estimate: row.rows_estimate !== null ? Number(row.rows_estimate) : null,
    }));

    return {
      tables,
      truncated,
      totalAvailable: truncated ? result.rows.length : tables.length,
    };
  }

  /**
   * Describe a PostgreSQL table
   *
   * Retrieves columns, indexes, and foreign keys from information_schema and pg_* catalogs.
   */
  async describeTable(
    table: string,
    schema: string,
    limits: { maxColumns: number; maxIndexes: number }
  ): Promise<TableDescription> {
    interface ColumnRow {
      name: string;
      type: string;
      nullable: boolean;
      default: string | null;
    }

    interface PrimaryKeyRow {
      column_name: string;
    }

    interface IndexRow {
      name: string;
      indexdef: string;
    }

    interface ForeignKeyRow {
      column: string;
      ref_table: string;
      ref_column: string;
    }

    // Query 1: Get columns
    const columnsQuery = `
      SELECT
        column_name as name,
        data_type || COALESCE('(' || character_maximum_length || ')', '') as type,
        is_nullable = 'YES' as nullable,
        column_default as default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `;

    // Query 2: Get primary key columns
    const primaryKeyQuery = `
      SELECT a.attname as column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary
    `;

    // Query 3: Get indexes
    const indexesQuery = `
      SELECT
        indexname as name,
        indexdef
      FROM pg_indexes
      WHERE schemaname = $1 AND tablename = $2
    `;

    // Query 4: Get foreign keys
    const foreignKeysQuery = `
      SELECT
        kcu.column_name as column,
        ccu.table_name as ref_table,
        ccu.column_name as ref_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
    `;

    // Execute all queries in parallel
    const [columnsResult, primaryKeyResult, indexesResult, foreignKeysResult] =
      await Promise.all([
        this.client.query<ColumnRow>(columnsQuery, [schema, table]),
        this.client.query<PrimaryKeyRow>(primaryKeyQuery, [schema, table]),
        this.client.query<IndexRow>(indexesQuery, [schema, table]),
        this.client.query<ForeignKeyRow>(foreignKeysQuery, [schema, table]),
      ]);

    const primaryKeyColumns = new Set(
      primaryKeyResult.rows.map((row) => row.column_name)
    );

    const allColumns: ColumnInfo[] = columnsResult.rows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable,
      default: row.default,
      primaryKey: primaryKeyColumns.has(row.name),
    }));

    const allIndexes: IndexInfo[] = indexesResult.rows.map((row) => {
      const { columns, unique } = parseIndexDef(row.indexdef);
      // An index is primary if all its columns are in the primary key
      const primary =
        columns.length > 0 &&
        columns.every((col) => primaryKeyColumns.has(col)) &&
        columns.length === primaryKeyColumns.size;

      return {
        name: row.name,
        columns,
        unique,
        primary,
      };
    });

    const foreignKeys: ForeignKeyInfo[] = foreignKeysResult.rows.map((row) => ({
      column: row.column,
      references: {
        table: row.ref_table,
        column: row.ref_column,
      },
    }));

    let truncated = false;
    const truncationReasons: string[] = [];

    const columns =
      allColumns.length > limits.maxColumns
        ? ((truncated = true),
          truncationReasons.push(
            `columns (${allColumns.length} > ${limits.maxColumns})`
          ),
          allColumns.slice(0, limits.maxColumns))
        : allColumns;

    const indexes =
      allIndexes.length > limits.maxIndexes
        ? ((truncated = true),
          truncationReasons.push(
            `indexes (${allIndexes.length} > ${limits.maxIndexes})`
          ),
          allIndexes.slice(0, limits.maxIndexes))
        : allIndexes;

    return {
      table,
      schema,
      columns,
      indexes,
      foreignKeys,
      truncated,
      ...(truncated && { truncationReason: truncationReasons.join(', ') }),
    };
  }
}

/**
 * Parse index definition to extract columns and unique flag
 *
 * Example indexdef:
 * `CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)`
 * `CREATE INDEX users_name_idx ON public.users USING btree (first_name, last_name)`
 */
function parseIndexDef(indexdef: string): { columns: string[]; unique: boolean } {
  const unique = indexdef.toUpperCase().includes('UNIQUE');

  // Extract columns from parentheses after USING method (btree, hash, etc.)
  const columnsMatch = indexdef.match(/\(([^)]+)\)\s*$/);
  if (!columnsMatch) {
    return { columns: [], unique };
  }

  // Split by comma and clean up column names (remove ASC/DESC, NULLS FIRST/LAST, etc.)
  const columns = columnsMatch[1]
    .split(',')
    .map((col) => col.trim().split(/\s+/)[0])
    .filter(Boolean);

  return { columns, unique };
}
