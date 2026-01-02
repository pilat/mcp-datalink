/**
 * list_databases tool - returns configured databases from config
 */

import type { Config } from '../types.js';

export interface ListDatabasesResult {
  databases: Array<{
    name: string;
    readonly: boolean;
  }>;
}

/**
 * Returns all configured databases with their readonly flags.
 *
 * @param config - The application config containing database configurations
 * @returns List of databases with name and readonly status
 */
export function listDatabases(config: Config): ListDatabasesResult {
  const databases = Object.entries(config.databases).map(([name, dbConfig]) => ({
    name,
    readonly: dbConfig.readonly,
  }));

  return { databases };
}
