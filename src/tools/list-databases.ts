/**
 * list_databases tool - returns configured databases from config
 */

import type { Config, ListDatabasesResult } from '../types.js';

import { formatAsMarkdownTable } from '../utils/formatter.js';

/**
 * Extract database type from URL
 */
function getDatabaseType(url: string): string {
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgresql';
  }
  if (url.startsWith('mysql://')) {
    return 'mysql';
  }
  if (url.startsWith('sqlite://') || url.startsWith('sqlite:')) {
    return 'sqlite';
  }
  return 'unknown';
}

/**
 * Format ListDatabasesResult as Markdown table
 */
export function formatListDatabasesResultAsMarkdown(
  result: ListDatabasesResult,
  config: Config
): string {
  if (result.databases.length === 0) {
    return '_No databases configured_';
  }

  const headers = ['name', 'type', 'readonly'];
  const rows = result.databases.map((db) => {
    const dbConfig = config.databases[db.name];
    const type = dbConfig ? getDatabaseType(dbConfig.url) : 'unknown';
    return [db.name, type, db.readonly ? 'YES' : 'NO'];
  });

  return formatAsMarkdownTable(headers, rows);
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
