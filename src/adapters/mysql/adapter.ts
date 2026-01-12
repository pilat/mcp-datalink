/**
 * MySQL Database Adapter
 *
 * Implements DatabaseAdapter interface for MySQL databases.
 * Uses mysql2/promise driver with per-request connection recycling.
 */

import * as mysql from 'mysql2/promise';

import type { Connection as MySql2Connection, FieldPacket, RowDataPacket } from 'mysql2/promise';
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

// ─────────────────────────────────────────────────────────────────────────────
// SQL Dialect helpers (formerly in dialect.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MySQL-specific dangerous patterns
 * These patterns bypass parser-level detection and need raw SQL matching
 */
const DANGEROUS_MYSQL_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    pattern: /\bLOAD\s+DATA\b/i,
    reason: 'LOAD DATA statements are not allowed (file system access)',
  },
  {
    pattern: /\bINTO\s+OUTFILE\b/i,
    reason: 'INTO OUTFILE is not allowed (file system write)',
  },
  {
    pattern: /\bINTO\s+DUMPFILE\b/i,
    reason: 'INTO DUMPFILE is not allowed (file system write)',
  },
  {
    pattern: /\bLOAD_FILE\s*\(/i,
    reason: 'LOAD_FILE() function is not allowed (file system read)',
  },
];

/**
 * Check if SQL contains dangerous MySQL-specific patterns
 */
function checkMySqlDangerousPatterns(
  sql: string
): { isDangerous: boolean; reason?: string } {
  for (const { pattern, reason } of DANGEROUS_MYSQL_PATTERNS) {
    if (pattern.test(sql)) {
      return { isDangerous: true, reason };
    }
  }
  return { isDangerous: false };
}

/**
 * MySQL database adapter
 *
 * Creates new connections for each request to prevent session state attacks.
 */
export class MySqlAdapter implements DatabaseAdapter {
  readonly type = 'mysql' as const;

  private readonly connectionUrl: string;
  private readonly timeout: number;

  constructor(config: AdapterConfig) {
    this.connectionUrl = config.database.url;
    this.timeout = config.defaults.timeout;
  }

  getDefaultSchema(): string {
    try {
      const url = new URL(this.connectionUrl);
      return url.pathname.slice(1);
    } catch {
      return 'mysql';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Dialect methods
  // ─────────────────────────────────────────────────────────────────────────────

  parseQuery(sql: string): ParsedQuery {
    // First check for MySQL-specific dangerous patterns (before parsing)
    const mysqlDanger = checkMySqlDangerousPatterns(sql);
    if (mysqlDanger.isDangerous) {
      return {
        type: 'other',
        hasLimit: false,
        isDangerous: true,
        dangerousReason: mysqlDanger.reason,
        sql,
      };
    }

    // Use shared parser for standard validation
    return sharedParseQuery(sql, 'MySQL');
  }

  injectLimit(sql: string, limit: number): string {
    return sharedInjectLimit(sql, limit, 'MySQL');
  }

  validateQueryForTool(sql: string, tool: 'query' | 'execute'): void {
    const parsed = this.parseQuery(sql);
    sharedValidateQueryForTool(parsed, tool);
  }

  getExplainPrefix(analyze: boolean): string {
    return analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN ';
  }

  /** Convert $1, $2 placeholders to ? for MySQL */
  convertPlaceholders(sql: string): string {
    return sql.replace(/\$\d+/g, '?');
  }

  /**
   * Execute a function with a managed MySQL connection
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

    let connection: MySql2Connection;

    try {
      connection = await mysql.createConnection(this.connectionUrl);
    } catch (error) {
      throw new DbMcpError(
        ErrorCode.CONNECTION_FAILED,
        'Failed to connect to MySQL database',
        {
          cause: error instanceof Error ? error.message : String(error),
        }
      );
    }

    try {
      try {
        await connection.execute(`SET max_execution_time = ${timeout}`);
      } catch {
        // max_execution_time not supported (MySQL < 5.7.8)
      }

      const adapter = new MySqlConnection(connection);
      return await fn(adapter);
    } finally {
      await connection.end();
    }
  }

  async dispose(): Promise<void> {
    // No persistent connections to clean up
  }
}

/**
 * MySQL connection wrapper
 *
 * Provides AdapterConnection interface over mysql2 Connection.
 * Handles MySQL-specific query execution and metadata retrieval.
 */
class MySqlConnection implements AdapterConnection {
  constructor(private readonly conn: MySql2Connection) {}

  async query(sql: string, params?: unknown[]): Promise<RawQueryResult> {
    const [result, fields] = await this.conn.execute<RowDataPacket[]>(
      sql,
      params ?? []
    );

    // For non-SELECT queries (INSERT/UPDATE/DELETE), fields is undefined
    // and result is a ResultSetHeader with affectedRows
    if (!fields || !Array.isArray(fields)) {
      // ResultSetHeader for INSERT/UPDATE/DELETE
      const header = result as unknown as { affectedRows: number };
      return {
        fields: [],
        rows: [],
        rowCount: header.affectedRows ?? 0,
      };
    }

    // SELECT query - mysql2 returns rows as objects, convert to arrays
    const rows = result as RowDataPacket[];
    const fieldNames = (fields as FieldPacket[]).map((f) => f.name);

    return {
      fields: fieldNames.map((name) => ({ name })),
      rows: rows.map((row) => fieldNames.map((f) => row[f])),
      rowCount: rows.length,
    };
  }

  async execute(sql: string): Promise<void> {
    await this.conn.query(sql);
  }

  /**
   * List tables in a MySQL database (schema = database in MySQL terminology)
   *
   * Uses information_schema.TABLES for table metadata.
   * Note: LIMIT is interpolated (not parameterized) because MySQL prepared
   * statements don't support LIMIT as a parameter. The value is validated
   * as a number so this is safe.
   */
  async listTables(schema: string, maxTables: number): Promise<ListTablesInternalResult> {
    const limit = Math.max(1, Math.floor(maxTables)) + 1;
    const sql = `
      SELECT
        TABLE_NAME as name,
        TABLE_SCHEMA as \`schema\`,
        CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN 'table' ELSE 'view' END as type,
        TABLE_ROWS as rows_estimate
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
      LIMIT ${limit}
    `;

    const [rows] = await this.conn.execute<RowDataPacket[]>(sql, [schema]);

    const truncated = rows.length > maxTables;
    const tables: TableInfo[] = rows.slice(0, maxTables).map((row) => ({
      name: row.name as string,
      schema: row.schema as string,
      type: row.type as 'table' | 'view',
      rows_estimate: row.rows_estimate !== null ? Number(row.rows_estimate) : null,
    }));

    return {
      tables,
      truncated,
      totalAvailable: truncated ? rows.length : tables.length,
    };
  }

  /**
   * Describe a MySQL table
   *
   * Retrieves columns, indexes, and foreign keys from information_schema.
   */
  async describeTable(
    table: string,
    schema: string,
    limits: { maxColumns: number; maxIndexes: number }
  ): Promise<TableDescription> {
    // Query 1: Get columns
    const columnsQuery = `
      SELECT
        COLUMN_NAME as name,
        CONCAT(
          DATA_TYPE,
          CASE
            WHEN CHARACTER_MAXIMUM_LENGTH IS NOT NULL
              THEN CONCAT('(', CHARACTER_MAXIMUM_LENGTH, ')')
            WHEN NUMERIC_PRECISION IS NOT NULL AND DATA_TYPE NOT IN ('int', 'bigint', 'smallint', 'tinyint', 'mediumint')
              THEN CONCAT('(', NUMERIC_PRECISION, ',', IFNULL(NUMERIC_SCALE, 0), ')')
            ELSE ''
          END
        ) as type,
        IS_NULLABLE = 'YES' as nullable,
        COLUMN_DEFAULT as \`default\`,
        COLUMN_KEY = 'PRI' as primaryKey
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;

    // Query 2: Get indexes
    const indexesQuery = `
      SELECT
        INDEX_NAME as name,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as columns,
        NOT NON_UNIQUE as \`unique\`,
        INDEX_NAME = 'PRIMARY' as \`primary\`
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      GROUP BY INDEX_NAME, NON_UNIQUE
      ORDER BY INDEX_NAME
    `;

    // Query 3: Get foreign keys
    const foreignKeysQuery = `
      SELECT
        kcu.COLUMN_NAME as \`column\`,
        kcu.REFERENCED_TABLE_NAME as ref_table,
        kcu.REFERENCED_COLUMN_NAME as ref_column
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND kcu.TABLE_SCHEMA = ?
        AND kcu.TABLE_NAME = ?
    `;

    const [columnsResult, indexesResult, foreignKeysResult] = await Promise.all([
      this.conn.execute<RowDataPacket[]>(columnsQuery, [schema, table]),
      this.conn.execute<RowDataPacket[]>(indexesQuery, [schema, table]),
      this.conn.execute<RowDataPacket[]>(foreignKeysQuery, [schema, table]),
    ]);

    const [columnsRows] = columnsResult;
    const [indexesRows] = indexesResult;
    const [foreignKeysRows] = foreignKeysResult;

    const allColumns: ColumnInfo[] = columnsRows.map((row) => ({
      name: row.name as string,
      type: row.type as string,
      nullable: Boolean(row.nullable),
      default: row.default as string | null,
      primaryKey: Boolean(row.primaryKey),
    }));

    const allIndexes: IndexInfo[] = indexesRows.map((row) => ({
      name: row.name as string,
      columns: row.columns ? String(row.columns).split(',').filter(Boolean) : [],
      unique: Boolean(row.unique),
      primary: Boolean(row.primary),
    }));

    const foreignKeys: ForeignKeyInfo[] = foreignKeysRows.map((row) => ({
      column: row.column as string,
      references: {
        table: row.ref_table as string,
        column: row.ref_column as string,
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

