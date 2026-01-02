/**
 * list_tables tool - lists tables in a database schema
 */

import type { Config, TableInfo } from '../types.js';
import { createAdapter } from '../adapters/index.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

export interface ListTablesParams {
  database: string;
  schema?: string; // default: "public"
}

export interface ListTablesResult {
  tables: TableInfo[];
  truncated: boolean;
  totalAvailable?: number;
}

/**
 * Lists tables and views in a database schema.
 *
 * @param params - Database name and optional schema (defaults to "public")
 * @param config - The application config
 * @returns List of tables with truncation info if over maxTables limit
 */
export async function listTables(
  params: ListTablesParams,
  config: Config
): Promise<ListTablesResult> {
  const maxTables = config.defaults.maxTables;

  // Get database config
  const dbConfig = config.databases[params.database];
  if (!dbConfig) {
    throw new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      `Database "${params.database}" not found in configuration`,
      { database: params.database, available: Object.keys(config.databases) }
    );
  }

  // Create adapter for this database
  const adapter = createAdapter(dbConfig, config.defaults);

  // Use provided schema or adapter's default schema
  // PostgreSQL: "public", MySQL: database name, SQLite: "main"
  const schema = params.schema ?? adapter.getDefaultSchema();

  return adapter.withConnection(async (conn) => {
    const result = await conn.listTables(schema, maxTables);
    const allTables = result.tables;
    const totalAvailable = result.totalAvailable;
    const truncated = totalAvailable > maxTables;

    if (truncated) {
      return {
        tables: allTables.slice(0, maxTables),
        truncated: true,
        totalAvailable,
      };
    }

    return {
      tables: allTables,
      truncated: false,
    };
  });
}
