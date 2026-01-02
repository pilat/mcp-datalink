/**
 * MySQL Database Adapter
 *
 * Implements DatabaseAdapter interface for MySQL databases.
 * Uses mysql2/promise driver with per-request connection recycling.
 */

import type {
  Connection as MySql2Connection,
  FieldPacket,
  RowDataPacket,
} from 'mysql2/promise';
import * as mysql from 'mysql2/promise';
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
 * MySQL-specific dangerous patterns
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
 * Standard dangerous SQL operations (DDL/DCL)
 */
const DANGEROUS_PREFIXES: ReadonlyArray<string> = [
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
  'RENAME',
];

/**
 * Strip SQL comments from a query
 */
function stripComments(sql: string): string {
  let result = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    // Handle strings - preserve content inside quotes
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      result += char;
      i++;

      while (i < len) {
        const c = sql[i];
        result += c;
        i++;

        if (c === '\\' && i < len) {
          result += sql[i];
          i++;
        } else if (c === quote) {
          if (sql[i] === quote) {
            result += sql[i];
            i++;
          } else {
            break;
          }
        }
      }
      continue;
    }

    // Handle single-line comment: --
    if (char === '-' && nextChar === '-') {
      i += 2;
      while (i < len && sql[i] !== '\n') {
        i++;
      }
      result += ' ';
      continue;
    }

    // Handle single-line comment: # (MySQL-specific)
    if (char === '#') {
      i++;
      while (i < len && sql[i] !== '\n') {
        i++;
      }
      result += ' ';
      continue;
    }

    // Handle multi-line comment: /* */
    if (char === '/' && nextChar === '*') {
      i += 2;
      while (i < len - 1) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      result += ' ';
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * String-aware statement splitting
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const char = sql[i];

    // Handle strings - don't split inside quotes
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      current += char;
      i++;

      while (i < len) {
        const c = sql[i];
        current += c;
        i++;

        if (c === '\\' && i < len) {
          current += sql[i];
          i++;
        } else if (c === quote) {
          if (sql[i] === quote) {
            current += sql[i];
            i++;
          } else {
            break;
          }
        }
      }
      continue;
    }

    // Handle semicolon - split point
    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

/**
 * Detect query type from normalized SQL
 */
function detectQueryType(normalizedSql: string): QueryType {
  if (normalizedSql.startsWith('SELECT') || normalizedSql.startsWith('WITH')) {
    return 'select';
  }
  if (normalizedSql.startsWith('INSERT')) {
    return 'insert';
  }
  if (normalizedSql.startsWith('UPDATE')) {
    return 'update';
  }
  if (normalizedSql.startsWith('DELETE')) {
    return 'delete';
  }
  return 'other';
}

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
 * Check if SQL starts with a dangerous prefix (DDL/DCL)
 */
function checkDangerousPrefix(
  normalizedSql: string
): { isDangerous: boolean; reason?: string } {
  for (const prefix of DANGEROUS_PREFIXES) {
    if (
      normalizedSql.startsWith(prefix + ' ') ||
      normalizedSql.startsWith(prefix + '\t') ||
      normalizedSql.startsWith(prefix + '\n') ||
      normalizedSql === prefix
    ) {
      return {
        isDangerous: true,
        reason: `${prefix} statements are not allowed`,
      };
    }
  }
  return { isDangerous: false };
}

/**
 * Check if a SELECT query has a LIMIT clause
 */
function hasLimitClause(sql: string): boolean {
  return /\bLIMIT\s+\d+/i.test(sql);
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

  /**
   * Get the default schema name for MySQL (database name from URL)
   */
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

  /**
   * Parse and validate a SQL query
   */
  parseQuery(sql: string): ParsedQuery {
    const withoutComments = stripComments(sql);
    const statements = splitStatements(withoutComments);

    if (statements.length === 0) {
      throw new DbMcpError(ErrorCode.INVALID_SQL, 'No valid SQL statement found', {
        sql,
      });
    }

    if (statements.length > 1) {
      throw new DbMcpError(
        ErrorCode.MULTI_STATEMENT,
        'Multiple SQL statements are not allowed. Please provide a single statement.',
        { sql, statementCount: statements.length }
      );
    }

    const statement = statements[0];
    const normalizedSql = statement.trim().toUpperCase();

    const mysqlDanger = checkMySqlDangerousPatterns(statement);
    if (mysqlDanger.isDangerous) {
      return {
        type: 'other',
        hasLimit: false,
        isDangerous: true,
        dangerousReason: mysqlDanger.reason,
        sql,
      };
    }

    const prefixDanger = checkDangerousPrefix(normalizedSql);
    if (prefixDanger.isDangerous) {
      return {
        type: 'other',
        hasLimit: false,
        isDangerous: true,
        dangerousReason: prefixDanger.reason,
        sql,
      };
    }

    const queryType = detectQueryType(normalizedSql);
    const hasLimit = queryType === 'select' ? hasLimitClause(statement) : false;

    return {
      type: queryType,
      hasLimit,
      isDangerous: false,
      sql,
    };
  }

  /**
   * Inject a LIMIT clause into a SELECT query if it doesn't have one
   */
  injectLimit(sql: string, limit: number): string {
    if (hasLimitClause(sql)) {
      return sql;
    }
    const trimmed = sql.replace(/;\s*$/, '').trim();
    return `${trimmed} LIMIT ${limit}`;
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
   * Get the EXPLAIN prefix for MySQL
   */
  getExplainPrefix(analyze: boolean): string {
    return analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN ';
  }

  /**
   * Convert PostgreSQL-style placeholders ($1, $2) to MySQL-style (?)
   */
  convertPlaceholders(sql: string): string {
    return sql.replace(/\$\d+/g, '?');
  }

  /**
   * Execute a function with a managed MySQL connection
   */
  async withConnection<T>(fn: (conn: AdapterConnection) => Promise<T>): Promise<T> {
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
      // SET command doesn't support parameterized queries, so validate timeout first
      if (!Number.isInteger(this.timeout) || this.timeout < 0) {
        throw new DbMcpError(
          ErrorCode.CONNECTION_FAILED,
          `Invalid timeout value: ${this.timeout}`
        );
      }

      // Try to set max_execution_time (MySQL 5.7.8+)
      // Gracefully handle older versions that don't support it
      try {
        await connection.execute(`SET max_execution_time = ${this.timeout}`);
      } catch (error) {
        // Silently ignore if max_execution_time is not supported (older MySQL)
        // The query will still run, just without execution timeout
        // Log for debugging purposes would go here in production
      }

      // Create connection wrapper and execute user function
      const adapter = new MySqlConnection(connection);
      return await fn(adapter);
    } finally {
      await connection.end();
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
 * MySQL connection wrapper
 *
 * Provides AdapterConnection interface over mysql2 Connection.
 * Handles MySQL-specific query execution and metadata retrieval.
 */
class MySqlConnection implements AdapterConnection {
  constructor(private readonly conn: MySql2Connection) {}

  /**
   * Execute a parameterized query using prepared statements
   */
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

  /**
   * Execute a raw SQL statement (for BEGIN, COMMIT, ROLLBACK)
   */
  async execute(sql: string): Promise<void> {
    await this.conn.query(sql);
  }

  /**
   * List tables in a MySQL database (schema = database in MySQL terminology)
   *
   * Uses information_schema.TABLES for table metadata.
   */
  async listTables(schema: string, _maxTables: number): Promise<ListTablesInternalResult> {
    const sql = `
      SELECT
        TABLE_NAME as name,
        TABLE_SCHEMA as \`schema\`,
        CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN 'table' ELSE 'view' END as type,
        TABLE_ROWS as rows_estimate
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `;

    const [rows] = await this.conn.execute<RowDataPacket[]>(sql, [schema]);

    const tables: TableInfo[] = rows.map((row) => ({
      name: row.name as string,
      schema: row.schema as string,
      type: row.type as 'table' | 'view',
      rows_estimate: row.rows_estimate !== null ? Number(row.rows_estimate) : null,
    }));

    return {
      tables,
      totalAvailable: tables.length,
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

    // Build columns array
    const allColumns: ColumnInfo[] = columnsRows.map((row) => ({
      name: row.name as string,
      type: row.type as string,
      nullable: Boolean(row.nullable),
      default: row.default as string | null,
      primaryKey: Boolean(row.primaryKey),
    }));

    // Build indexes array
    const allIndexes: IndexInfo[] = indexesRows.map((row) => ({
      name: row.name as string,
      columns: (row.columns as string).split(','),
      unique: Boolean(row.unique),
      primary: Boolean(row.primary),
    }));

    // Build foreign keys array
    const foreignKeys: ForeignKeyInfo[] = foreignKeysRows.map((row) => ({
      column: row.column as string,
      references: {
        table: row.ref_table as string,
        column: row.ref_column as string,
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

// Export helper functions for testing
export { stripComments, splitStatements };
