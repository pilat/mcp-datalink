/**
 * Database Adapters Module
 *
 * Barrel file exporting all adapter-related types and implementations.
 *
 * Usage:
 * ```typescript
 * import {
 *   createAdapter,
 *   DatabaseAdapter,
 *   AdapterConnection,
 * } from './adapters/index.js';
 *
 * const adapter = createAdapter(dbConfig, defaults);
 *
 * // SQL dialect methods are now part of the adapter
 * adapter.validateQueryForTool(sql, 'query');
 * const parsed = adapter.parseQuery(sql);
 *
 * await adapter.withConnection(async (conn) => {
 *   const result = await conn.query('SELECT * FROM users WHERE id = $1', [1]);
 *   return result;
 * });
 * ```
 */

// Types
export type {
  DatabaseAdapter,
  AdapterConnection,
  RawQueryResult,
  AdapterConfig,
  ListTablesInternalResult,
} from './types.js';

// Factory
export { createAdapter, isSupportedUrl, isImplemented } from './factory.js';

// PostgreSQL (explicit exports for testing/extension)
export { PostgreSqlAdapter } from './postgresql/adapter.js';

// MySQL (explicit exports for testing/extension)
export { MySqlAdapter } from './mysql/adapter.js';

// SQLite (explicit exports for testing/extension)
export { SqliteAdapter } from './sqlite/adapter.js';
