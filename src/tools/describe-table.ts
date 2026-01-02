/**
 * describe_table tool - Returns table structure including columns, indexes, and foreign keys
 */

import type { Config, TableDescription } from '../types.js';
import { createAdapter } from '../adapters/index.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

export interface DescribeTableParams {
  database: string;
  table: string;
  schema?: string; // default: "public"
}

export async function describeTable(
  params: DescribeTableParams,
  config: Config
): Promise<TableDescription> {
  const { table, database } = params;
  const { maxColumns, maxIndexes } = config.defaults;

  // Get database config
  const dbConfig = config.databases[database];
  if (!dbConfig) {
    throw new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      `Database "${database}" not found in configuration`,
      { database, available: Object.keys(config.databases) }
    );
  }

  // Create adapter for this database
  const adapter = createAdapter(dbConfig, config.defaults);

  // Use provided schema or adapter's default schema
  // PostgreSQL: "public", MySQL: database name, SQLite: "main"
  const schema = params.schema ?? adapter.getDefaultSchema();

  return adapter.withConnection(async (conn) => {
    return conn.describeTable(table, schema, { maxColumns, maxIndexes });
  });
}
