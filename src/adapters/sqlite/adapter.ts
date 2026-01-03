/**
 * SQLite Database Adapter
 *
 * Implements DatabaseAdapter interface for SQLite databases.
 * Uses better-sqlite3 library for synchronous database access.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
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
 * Dangerous SQL operations that are always blocked
 */
const DANGEROUS_OPERATIONS = [
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
] as const;

/**
 * Strip SQL comments from a query
 */
function stripComments(sql: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let stringChar = '';

  while (i < sql.length) {
    if (!inString && (sql[i] === "'" || sql[i] === '"')) {
      inString = true;
      stringChar = sql[i];
      result += sql[i];
      i++;
      continue;
    }

    if (inString) {
      if (sql[i] === stringChar) {
        if (i + 1 < sql.length && sql[i + 1] === stringChar) {
          result += sql[i] + sql[i + 1];
          i += 2;
          continue;
        } else {
          inString = false;
          result += sql[i];
          i++;
          continue;
        }
      }
      result += sql[i];
      i++;
      continue;
    }

    if (sql[i] === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
      if (i < sql.length) {
        result += ' ';
        i++;
      }
      continue;
    }

    if (sql[i] === '/' && i + 1 < sql.length && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      if (i < sql.length - 1) {
        i += 2;
      }
      result += ' ';
      continue;
    }

    result += sql[i];
    i++;
  }

  return result;
}

/**
 * Split SQL by semicolons, respecting string literals
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (inString && char === stringChar) {
      if (i + 1 < sql.length && sql[i + 1] === stringChar) {
        current += char + sql[i + 1];
        i++;
        continue;
      } else {
        inString = false;
        current += char;
        continue;
      }
    }

    if (char === ';' && !inString) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    statements.push(current.trim());
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
 * Check if SQL contains a dangerous operation
 */
function checkDangerous(normalizedSql: string): {
  isDangerous: boolean;
  reason?: string;
} {
  for (const operation of DANGEROUS_OPERATIONS) {
    if (
      normalizedSql.startsWith(operation) ||
      normalizedSql.startsWith(operation + ' ') ||
      normalizedSql.includes(' ' + operation + ' ')
    ) {
      return {
        isDangerous: true,
        reason: `${operation} statements are not allowed`,
      };
    }
  }

  if (normalizedSql.startsWith('PRAGMA')) {
    if (normalizedSql.includes('=')) {
      return {
        isDangerous: true,
        reason: 'PRAGMA modifications are not allowed',
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
 * Parse SQLite URL to extract file path
 *
 * Supported formats:
 * - sqlite:///absolute/path.db
 * - sqlite://./relative/path.db
 * - sqlite://:memory:
 * - /absolute/path.db (plain file path)
 * - ./relative/path.db (plain file path)
 *
 * @param url - SQLite connection URL or file path
 * @returns Resolved absolute file path or :memory:
 */
function parseSqliteUrl(url: string): string {
  if (url.startsWith('sqlite://')) {
    const pathPart = url.slice('sqlite://'.length);

    // Special case: :memory:
    if (pathPart === ':memory:') {
      return ':memory:';
    }

    // Handle both absolute (/path) and relative (./path) paths
    return pathPart;
  }

  // Plain file path (no sqlite:// prefix)
  return url;
}

/**
 * Validate and resolve SQLite database path
 *
 * SECURITY: Prevents path traversal attacks by:
 * 1. Resolving to absolute path
 * 2. Ensuring path doesn't contain suspicious patterns
 * 3. Checking file exists (unless :memory:)
 *
 * @param rawPath - Raw path from config
 * @param basePath - Base directory for relative paths (process.cwd())
 * @returns Validated absolute path
 * @throws DbMcpError if path is invalid or file not found
 */
function validateAndResolvePath(rawPath: string, basePath: string): string {
  // :memory: is always valid
  if (rawPath === ':memory:') {
    return ':memory:';
  }

  // Resolve to absolute path
  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(basePath, rawPath);

  // Normalize to remove any .. or . components
  const normalizedPath = path.normalize(absolutePath);

  // SECURITY: Check for path traversal attempts
  // After normalization, path should not go above the base directory for relative paths
  if (!path.isAbsolute(rawPath)) {
    // For relative paths, ensure the resolved path is still within reasonable bounds
    // This prevents sqlite://../../etc/passwd type attacks
    const relativeToCwd = path.relative(basePath, normalizedPath);
    if (relativeToCwd.startsWith('..')) {
      throw new DbMcpError(
        ErrorCode.CONFIG_INVALID,
        'Path traversal detected. SQLite path must not escape the working directory.',
        { path: rawPath, resolved: normalizedPath }
      );
    }
  }

  // Check file exists
  if (!fs.existsSync(normalizedPath)) {
    throw new DbMcpError(
      ErrorCode.CONNECTION_FAILED,
      `SQLite database file not found: ${normalizedPath}`,
      { path: rawPath, resolved: normalizedPath }
    );
  }

  return normalizedPath;
}

/**
 * SQLite database adapter
 *
 * Creates new database handles for each request.
 *
 * Note: better-sqlite3 is synchronous, but we wrap in async for interface
 * compatibility with other adapters.
 */
export class SqliteAdapter implements DatabaseAdapter {
  readonly type = 'sqlite' as const;

  private readonly dbPath: string;
  private readonly timeout: number;
  private readonly readonly: boolean;

  constructor(config: AdapterConfig) {
    const rawPath = parseSqliteUrl(config.database.url);
    this.dbPath = validateAndResolvePath(rawPath, process.cwd());
    this.timeout = config.defaults.timeout;
    this.readonly = config.database.readonly;
  }

  /**
   * Get the default schema name for SQLite
   */
  getDefaultSchema(): string {
    return 'main';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Dialect methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parse and validate a SQLite SQL query
   */
  parseQuery(sql: string): ParsedQuery {
    const withoutComments = stripComments(sql);
    const statements = splitStatements(withoutComments);

    if (statements.length === 0) {
      throw new DbMcpError(ErrorCode.INVALID_SQL, 'No valid SQL statement found', { sql });
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

    const { isDangerous, reason } = checkDangerous(normalizedSql);
    const queryType = detectQueryType(normalizedSql);
    const hasLimit = queryType === 'select' && hasLimitClause(statement);

    return {
      type: queryType,
      hasLimit,
      isDangerous,
      dangerousReason: reason,
      sql: statement,
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
   * Get the EXPLAIN prefix for SQLite
   */
  getExplainPrefix(_analyze: boolean): string {
    return 'EXPLAIN QUERY PLAN ';
  }

  /**
   * Convert $1, $2 style placeholders to ? style for SQLite
   */
  convertPlaceholders(sql: string): string {
    let result = '';
    let inString = false;
    let stringChar = '';
    let i = 0;

    while (i < sql.length) {
      if (!inString && (sql[i] === "'" || sql[i] === '"')) {
        inString = true;
        stringChar = sql[i];
        result += sql[i];
        i++;
        continue;
      }

      if (inString && sql[i] === stringChar) {
        if (i + 1 < sql.length && sql[i + 1] === stringChar) {
          result += sql[i] + sql[i + 1];
          i += 2;
          continue;
        } else {
          inString = false;
          result += sql[i];
          i++;
          continue;
        }
      }

      if (!inString && sql[i] === '$') {
        let j = i + 1;
        while (j < sql.length && /\d/.test(sql[j])) {
          j++;
        }
        if (j > i + 1) {
          result += '?';
          i = j;
          continue;
        }
      }

      result += sql[i];
      i++;
    }

    return result;
  }

  /**
   * Execute a function with a managed SQLite connection
   */
  async withConnection<T>(fn: (conn: AdapterConnection) => Promise<T>): Promise<T> {
    // Open database (create new handle per request)
    const db = new Database(this.dbPath, {
      readonly: this.readonly,
      // busy_timeout handles lock contention (different from query timeout)
      timeout: this.timeout,
    });

    try {
      // Create connection wrapper and execute user function
      const connection = new SqliteConnection(db);
      return await fn(connection);
    } finally {
      db.close();
    }
  }

  /**
   * Clean up resources (no persistent resources in this adapter)
   */
  async dispose(): Promise<void> {
    // No persistent resources to clean up
    // Each database handle is opened and closed per request
  }
}

/**
 * SQLite connection wrapper
 *
 * Provides AdapterConnection interface over better-sqlite3 Database.
 * Handles SQLite-specific query execution and metadata retrieval.
 *
 * Note: better-sqlite3 is synchronous, wrapped in async for interface.
 */
class SqliteConnection implements AdapterConnection {
  constructor(private readonly db: Database.Database) {}

  /**
   * Execute a parameterized query
   *
   * SECURITY: All user SQL MUST go through this method with parameters.
   * Uses better-sqlite3 prepared statements.
   *
   * Note: better-sqlite3 uses ? placeholders (not $1, $2 like PostgreSQL).
   * The SqliteDialect.convertPlaceholders() should be called before this if needed.
   */
  async query(sql: string, params?: unknown[]): Promise<RawQueryResult> {
    const stmt = this.db.prepare(sql);

    // Check if statement returns data (SELECT) or not (INSERT/UPDATE/DELETE)
    if (stmt.reader) {
      // SELECT query - returns rows
      const rows = stmt.all(...(params ?? [])) as Record<string, unknown>[];

      // Get column names from first row or statement
      const columns = stmt.columns();
      const columnNames = columns.map((c) => c.name);

      // Convert object rows to array rows for consistent interface
      const arrayRows = rows.map((row) => columnNames.map((col) => row[col]));

      return {
        fields: columnNames.map((name) => ({ name })),
        rows: arrayRows,
        rowCount: rows.length,
      };
    } else {
      // Non-SELECT query (INSERT/UPDATE/DELETE)
      const result = stmt.run(...(params ?? []));

      return {
        fields: [],
        rows: [],
        rowCount: result.changes,
      };
    }
  }

  /**
   * Execute a raw SQL statement
   *
   * SECURITY WARNING: Only use for validated internal commands
   * For SQLite this is primarily used for PRAGMA and transaction commands
   */
  async execute(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  /**
   * List tables in SQLite database
   *
   * SQLite doesn't have schemas - we ignore the schema parameter and
   * always report "main" as the schema.
   */
  async listTables(_schema: string, _maxTables: number): Promise<ListTablesInternalResult> {
    // Query sqlite_master for tables and views
    // Filter out internal sqlite_ tables
    const sql = `
      SELECT
        name,
        type
      FROM sqlite_master
      WHERE type IN ('table', 'view')
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all() as Array<{
      name: string;
      type: 'table' | 'view';
    }>;

    const tables: TableInfo[] = rows.map((row) => ({
      name: row.name,
      schema: 'main',
      type: row.type,
      rows_estimate: null,
    }));

    return {
      tables,
      totalAvailable: tables.length,
    };
  }

  /**
   * Describe a SQLite table
   *
   * Uses PRAGMA commands to get table structure.
   * Schema parameter is ignored since SQLite doesn't have schemas.
   */
  async describeTable(
    table: string,
    _schema: string,
    limits: { maxColumns: number; maxIndexes: number }
  ): Promise<TableDescription> {
    // Validate table name to prevent injection in PRAGMA commands
    // Table names in SQLite can contain almost anything, but we use quotes
    const safeTable = this.escapeIdentifier(table);

    // Query 1: Get columns using PRAGMA table_info
    interface ColumnRow {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    const columnsStmt = this.db.prepare(`PRAGMA table_info(${safeTable})`);
    const columnRows = columnsStmt.all() as ColumnRow[];

    // Query 2: Get indexes using PRAGMA index_list
    interface IndexListRow {
      seq: number;
      name: string;
      unique: number;
      origin: string; // 'c' (CREATE INDEX), 'u' (UNIQUE), 'pk' (PRIMARY KEY)
      partial: number;
    }

    const indexListStmt = this.db.prepare(`PRAGMA index_list(${safeTable})`);
    const indexListRows = indexListStmt.all() as IndexListRow[];

    // Query 3: Get foreign keys using PRAGMA foreign_key_list
    interface ForeignKeyRow {
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
      match: string;
    }

    const fkStmt = this.db.prepare(`PRAGMA foreign_key_list(${safeTable})`);
    const fkRows = fkStmt.all() as ForeignKeyRow[];

    // Build columns array
    const allColumns: ColumnInfo[] = columnRows.map((row) => ({
      name: row.name,
      type: row.type || 'TEXT', // SQLite allows typeless columns
      nullable: row.notnull === 0,
      default: row.dflt_value,
      primaryKey: row.pk > 0,
    }));

    // Build indexes array (need to get columns for each index)
    interface IndexInfoRow {
      seqno: number;
      cid: number;
      name: string;
    }

    const allIndexes: IndexInfo[] = indexListRows.map((idx) => {
      // Get columns for this index
      const indexInfoStmt = this.db.prepare(
        `PRAGMA index_info(${this.escapeIdentifier(idx.name)})`
      );
      const indexInfoRows = indexInfoStmt.all() as IndexInfoRow[];

      const columns = indexInfoRows
        .sort((a, b) => a.seqno - b.seqno)
        .map((info) => info.name);

      return {
        name: idx.name,
        columns,
        unique: idx.unique === 1,
        primary: idx.origin === 'pk',
      };
    });

    // Build foreign keys array
    const foreignKeys: ForeignKeyInfo[] = fkRows.map((fk) => ({
      column: fk.from,
      references: {
        table: fk.table,
        column: fk.to,
      },
    }));

    // Apply limits and track truncation
    let truncated = false;
    const truncationReasons: string[] = [];

    const columns =
      allColumns.length > limits.maxColumns
        ? ((truncated = true),
          truncationReasons.push(`columns (${allColumns.length} > ${limits.maxColumns})`),
          allColumns.slice(0, limits.maxColumns))
        : allColumns;

    const indexes =
      allIndexes.length > limits.maxIndexes
        ? ((truncated = true),
          truncationReasons.push(`indexes (${allIndexes.length} > ${limits.maxIndexes})`),
          allIndexes.slice(0, limits.maxIndexes))
        : allIndexes;

    return {
      table,
      schema: 'main',
      columns,
      indexes,
      foreignKeys,
      truncated,
      ...(truncated && { truncationReason: truncationReasons.join(', ') }),
    };
  }

  /**
   * Escape a SQLite identifier (table/column name)
   *
   * SQLite uses double quotes for identifiers.
   * Double any existing double quotes to escape them.
   *
   * @param name - Identifier to escape
   * @returns Safely quoted identifier
   */
  private escapeIdentifier(name: string): string {
    // Replace any double quotes with two double quotes (escape)
    const escaped = name.replace(/"/g, '""');
    return `"${escaped}"`;
  }
}

// Export helper functions for testing
export { stripComments, splitStatements };
