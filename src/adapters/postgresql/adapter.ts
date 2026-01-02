/**
 * PostgreSQL Database Adapter
 *
 * Implements DatabaseAdapter interface for PostgreSQL databases.
 * Uses node-postgres (pg) driver with per-request connection recycling.
 */

import pg from 'pg';
import { parse, Statement, toSql, SelectFromStatement } from 'pgsql-ast-parser';
import type {
  DatabaseAdapter,
  AdapterConnection,
  RawQueryResult,
  AdapterConfig,
  ListTablesInternalResult,
} from '../types.js';
import type {
  ParsedQuery,
  QueryType,
  TableDescription,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
} from '../../types.js';
import { DbMcpError, ErrorCode } from '../../utils/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// SQL Dialect helpers (formerly in dialect.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prefixes that indicate dangerous SQL operations
 * pgsql-ast-parser returns types like "drop table", "alter table", etc.
 */
const DANGEROUS_PREFIXES: ReadonlyArray<string> = [
  'drop',
  'truncate',
  'alter',
  'create',
  'grant',
  'revoke',
];

/**
 * Maps pgsql-ast-parser statement types to our QueryType
 */
function getQueryType(statement: Statement): QueryType {
  switch (statement.type) {
    case 'select':
      return 'select';
    case 'insert':
      return 'insert';
    case 'update':
      return 'update';
    case 'delete':
      return 'delete';
    default:
      return 'other';
  }
}

/**
 * Check if a statement type is dangerous
 * Handles compound types from pgsql-ast-parser like "drop table", "alter table"
 */
function checkDangerous(statement: Statement): { isDangerous: boolean; reason?: string } {
  const stmtType = statement.type.toLowerCase();

  for (const prefix of DANGEROUS_PREFIXES) {
    if (stmtType === prefix || stmtType.startsWith(prefix + ' ')) {
      const operation = prefix.toUpperCase();
      return {
        isDangerous: true,
        reason: operation + ' statements are not allowed',
      };
    }
  }

  return { isDangerous: false };
}

/**
 * Type guard to check if a statement is a SelectFromStatement
 */
function isSelectFromStatement(statement: Statement): statement is SelectFromStatement {
  return statement.type === 'select' && 'columns' in statement;
}

/**
 * Check if a SELECT statement has a LIMIT clause
 */
function hasLimitClause(statement: Statement): boolean {
  if (!isSelectFromStatement(statement)) {
    return false;
  }
  return statement.limit !== undefined && statement.limit !== null;
}

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

  /**
   * Get the default schema name for PostgreSQL
   */
  getDefaultSchema(): string {
    return 'public';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Dialect methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parse and validate a SQL query
   */
  parseQuery(sql: string): ParsedQuery {
    let statements: Statement[];

    try {
      statements = parse(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      throw new DbMcpError(
        ErrorCode.INVALID_SQL,
        'Failed to parse SQL: ' + message,
        { sql }
      );
    }

    // Filter out empty statements (trailing semicolons create these)
    const nonEmptyStatements = statements.filter(
      (stmt) => (stmt.type as unknown) !== 'empty' && stmt.type !== undefined
    );

    if (nonEmptyStatements.length === 0) {
      throw new DbMcpError(
        ErrorCode.INVALID_SQL,
        'No valid SQL statement found',
        { sql }
      );
    }

    if (nonEmptyStatements.length > 1) {
      throw new DbMcpError(
        ErrorCode.MULTI_STATEMENT,
        'Multiple SQL statements are not allowed. Please provide a single statement.',
        { sql, statementCount: nonEmptyStatements.length }
      );
    }

    const statement = nonEmptyStatements[0];
    const queryType = getQueryType(statement);
    const { isDangerous, reason } = checkDangerous(statement);

    return {
      type: queryType,
      hasLimit: hasLimitClause(statement),
      isDangerous,
      dangerousReason: reason,
      sql,
    };
  }

  /**
   * Inject a LIMIT clause into a SELECT query if it doesn't have one
   */
  injectLimit(sql: string, limit: number): string {
    let statements: Statement[];

    try {
      statements = parse(sql);
    } catch {
      return sql;
    }

    const nonEmptyStatements = statements.filter(
      (stmt) => (stmt.type as unknown) !== 'empty' && stmt.type !== undefined
    );

    if (nonEmptyStatements.length !== 1) {
      return sql;
    }

    const statement = nonEmptyStatements[0];

    if (!isSelectFromStatement(statement)) {
      return sql;
    }

    if (statement.limit !== undefined && statement.limit !== null) {
      return sql;
    }

    statement.limit = {
      limit: { type: 'integer', value: limit },
    };

    return toSql.statement(statement);
  }

  /**
   * Validate that a SQL query is appropriate for a specific tool
   */
  validateQueryForTool(sql: string, tool: 'query' | 'execute'): void {
    const parsed = this.parseQuery(sql);

    if (tool === 'query') {
      if (parsed.type !== 'select') {
        throw new DbMcpError(
          ErrorCode.QUERY_BLOCKED,
          'The query tool only accepts SELECT statements. Use the execute tool for ' +
            parsed.type.toUpperCase() +
            ' statements.',
          { sql, queryType: parsed.type, tool }
        );
      }
    } else if (tool === 'execute') {
      if (parsed.type === 'select') {
        throw new DbMcpError(
          ErrorCode.QUERY_BLOCKED,
          'The execute tool does not accept SELECT statements. Use the query tool instead.',
          { sql, queryType: parsed.type, tool }
        );
      }

      if (parsed.isDangerous) {
        throw new DbMcpError(
          ErrorCode.QUERY_BLOCKED,
          parsed.dangerousReason ?? 'This operation is not allowed',
          { sql, queryType: parsed.type, tool }
        );
      }

      const allowedTypes: QueryType[] = ['insert', 'update', 'delete'];
      if (!allowedTypes.includes(parsed.type)) {
        throw new DbMcpError(
          ErrorCode.QUERY_BLOCKED,
          'The execute tool only accepts INSERT, UPDATE, or DELETE statements.',
          { sql, queryType: parsed.type, tool }
        );
      }
    }
  }

  /**
   * Get the EXPLAIN prefix for PostgreSQL
   */
  getExplainPrefix(analyze: boolean): string {
    return analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN ';
  }

  /**
   * Convert placeholders - no-op for PostgreSQL (already uses $1, $2, $3)
   */
  convertPlaceholders(sql: string): string {
    return sql;
  }

  /**
   * Execute a function with a managed PostgreSQL connection
   */
  async withConnection<T>(fn: (conn: AdapterConnection) => Promise<T>): Promise<T> {
    const client = new pg.Client({
      connectionString: this.connectionUrl,
    });

    try {
      // Connect to database
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

      // SET command doesn't support parameterized queries, so validate timeout first
      if (!Number.isInteger(this.timeout) || this.timeout < 0) {
        throw new DbMcpError(
          ErrorCode.CONNECTION_FAILED,
          `Invalid timeout value: ${this.timeout}`
        );
      }
      await client.query(`SET statement_timeout = ${this.timeout}`);

      // Create connection wrapper and execute user function
      const connection = new PostgreSqlConnection(client);
      return await fn(connection);
    } finally {
      await client.end();
    }
  }

  /**
   * Clean up resources (no persistent resources in this adapter)
   */
  async dispose(): Promise<void> {
    // No persistent resources to clean up
    // Each connection is created and destroyed per request
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

  /**
   * Execute a raw SQL statement (for BEGIN, COMMIT, ROLLBACK)
   */
  async execute(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  /**
   * List tables in a PostgreSQL schema
   *
   * Uses information_schema and pg_class for table metadata.
   * Note: maxTables is accepted for interface compatibility but filtering
   * is done at the caller level to report accurate totalAvailable count.
   */
  async listTables(schema: string, _maxTables: number): Promise<ListTablesInternalResult> {
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
    `;

    interface TableRow {
      name: string;
      schema: string;
      type: 'table' | 'view';
      rows_estimate: string | null;
    }

    const result = await this.client.query<TableRow>(sql, [schema]);

    const tables: TableInfo[] = result.rows.map((row) => ({
      name: row.name,
      schema: row.schema,
      type: row.type,
      rows_estimate: row.rows_estimate !== null ? Number(row.rows_estimate) : null,
    }));

    return {
      tables,
      totalAvailable: tables.length,
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

    // Build set of primary key columns for quick lookup
    const primaryKeyColumns = new Set(
      primaryKeyResult.rows.map((row) => row.column_name)
    );

    // Build columns array with primaryKey flag
    const allColumns: ColumnInfo[] = columnsResult.rows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable,
      default: row.default,
      primaryKey: primaryKeyColumns.has(row.name),
    }));

    // Build indexes array
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

    // Build foreign keys array
    const foreignKeys: ForeignKeyInfo[] = foreignKeysResult.rows.map((row) => ({
      column: row.column,
      references: {
        table: row.ref_table,
        column: row.ref_column,
      },
    }));

    // Apply limits and track truncation
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
