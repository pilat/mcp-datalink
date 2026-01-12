/**
 * SQLite Database Adapter
 *
 * Implements DatabaseAdapter interface for SQLite databases.
 * Uses better-sqlite3 library for synchronous database access.
 */

import Database from 'better-sqlite3';

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
import { checkSqlitePragmaModification } from './pragma-check.js';
import { parseSqliteUrl, validateAndResolvePath } from './url-parser.js';

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

  getDefaultSchema(): string {
    return 'main';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Dialect methods
  // ─────────────────────────────────────────────────────────────────────────────

  parseQuery(sql: string): ParsedQuery {
    // First check for SQLite-specific PRAGMA modification (before parsing)
    const pragmaCheck = checkSqlitePragmaModification(sql);
    if (pragmaCheck.isDangerous) {
      return {
        type: 'other',
        hasLimit: false,
        isDangerous: true,
        dangerousReason: pragmaCheck.reason,
        sql,
      };
    }

    // Use shared parser for standard validation
    return sharedParseQuery(sql, 'SQLite');
  }

  injectLimit(sql: string, limit: number): string {
    return sharedInjectLimit(sql, limit, 'SQLite');
  }

  validateQueryForTool(sql: string, tool: 'query' | 'execute'): void {
    const parsed = this.parseQuery(sql);
    sharedValidateQueryForTool(parsed, tool);
  }

  /** SQLite always uses EXPLAIN QUERY PLAN (no ANALYZE support) */
  getExplainPrefix(_analyze: boolean): string {
    // _analyze is ignored: SQLite doesn't support EXPLAIN ANALYZE;
    // EXPLAIN QUERY PLAN is the only supported form
    return 'EXPLAIN QUERY PLAN ';
  }

  /** Convert $1, $2 placeholders to ? for SQLite */
  convertPlaceholders(sql: string): string {
    let result = '';
    let inQuoted = false;
    let quoteChar = '';
    let closeChar = ''; // For bracket quoting, close char differs from open
    let i = 0;

    while (i < sql.length) {
      // Enter quoted section (string literals or identifiers)
      if (!inQuoted) {
        if (sql[i] === "'" || sql[i] === '"' || sql[i] === '`') {
          // Single quote, double quote, or backtick - same char closes
          inQuoted = true;
          quoteChar = sql[i];
          closeChar = sql[i];
          result += sql[i];
          i++;
          continue;
        }
        if (sql[i] === '[') {
          // Bracket quoting - ] closes
          inQuoted = true;
          quoteChar = '[';
          closeChar = ']';
          result += sql[i];
          i++;
          continue;
        }
      }

      // Handle closing of quoted section
      if (inQuoted && sql[i] === closeChar) {
        // For ', ", ` - handle escaped quotes (doubled)
        if (quoteChar !== '[' && i + 1 < sql.length && sql[i + 1] === closeChar) {
          result += sql[i] + sql[i + 1];
          i += 2;
          continue;
        } else {
          // End of quoted section
          inQuoted = false;
          result += sql[i];
          i++;
          continue;
        }
      }

      // Convert $N placeholders to ? (only outside quoted sections)
      if (!inQuoted && sql[i] === '$') {
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

  async withConnection<T>(
    fn: (conn: AdapterConnection) => Promise<T>,
    options?: ConnectionOptions
  ): Promise<T> {
    const timeout = options?.timeout ?? this.timeout;

    // Validate timeout before creating connection
    if (!Number.isInteger(timeout) || timeout < 0) {
      throw new DbMcpError(
        ErrorCode.CONNECTION_FAILED,
        `Invalid timeout value: ${timeout}`
      );
    }

    const db = new Database(this.dbPath, {
      readonly: this.readonly,
      // busy_timeout handles lock contention (different from query timeout)
      timeout,
    });

    try {
      const connection = new SqliteConnection(db);
      return await fn(connection);
    } finally {
      db.close();
    }
  }

  async dispose(): Promise<void> {
    // No persistent connections to clean up
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

  async execute(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  /**
   * SQLite doesn't have schemas, we always return "main"
   * Fetches maxTables + 1 to detect truncation.
   */
  async listTables(_schema: string, maxTables: number): Promise<ListTablesInternalResult> {
    // _schema is ignored: SQLite doesn't support schemas; all tables exist in the "main" schema
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
      LIMIT ?
    `;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(maxTables + 1) as Array<{
      name: string;
      type: 'table' | 'view';
    }>;

    const truncated = rows.length > maxTables;
    const tables: TableInfo[] = rows.slice(0, maxTables).map((row) => ({
      name: row.name,
      schema: 'main',
      type: row.type,
      rows_estimate: null,
    }));

    return {
      tables,
      truncated,
      totalAvailable: truncated ? rows.length : tables.length,
    };
  }

  async describeTable(
    table: string,
    _schema: string,
    limits: { maxColumns: number; maxIndexes: number }
  ): Promise<TableDescription> {
    // _schema is ignored: SQLite doesn't support schemas; table names must be unique within the database
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

    const allColumns: ColumnInfo[] = columnRows.map((row) => ({
      name: row.name,
      type: row.type || 'TEXT', // SQLite allows typeless columns
      nullable: row.notnull === 0,
      default: row.dflt_value,
      primaryKey: row.pk > 0,
    }));

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

    const foreignKeys: ForeignKeyInfo[] = fkRows.map((fk) => ({
      column: fk.from,
      references: {
        table: fk.table,
        column: fk.to,
      },
    }));

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

  private escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }
}

