import type { Config, DatabaseConfig, DefaultsConfig } from '../types.js';

import { DbMcpError, ErrorCode } from '../utils/errors.js';

const DEFAULT_CONFIG: DefaultsConfig = {
  maxRows: 100,
  maxCellLength: 500,
  maxTotalSize: 65536, // 64KB
  maxColumns: 50,
  maxTables: 200,
  maxIndexes: 20,
  timeout: 30000,
};

/**
 * Extract databases from DATALINK_{NAME}_URL environment variables.
 * Also supports DATALINK_{NAME}_READONLY=true for read-only mode.
 */
function getDatabasesFromEnv(): Record<string, DatabaseConfig> {
  const databases: Record<string, DatabaseConfig> = {};
  const urlPattern = /^DATALINK_([A-Z0-9_]+)_URL$/;

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(urlPattern);
    if (match && value) {
      const name = match[1].toLowerCase();
      const readonlyKey = `DATALINK_${match[1]}_READONLY`;
      const readonlyValue = process.env[readonlyKey];

      databases[name] = {
        url: value,
        readonly: readonlyValue === 'true' || readonlyValue === '1',
      };
    }
  }

  return databases;
}

/**
 * Load configuration from environment variables.
 *
 * Environment variables:
 *   DATALINK_{NAME}_URL      - Database connection URL (required)
 *   DATALINK_{NAME}_READONLY - Set to "true" for read-only mode (optional)
 *
 * Example:
 *   DATALINK_PROD_URL=postgresql://user:pass@host:5432/db
 *   DATALINK_PROD_READONLY=true
 */
export function loadConfig(): Config {
  const databases = getDatabasesFromEnv();

  if (Object.keys(databases).length === 0) {
    throw new DbMcpError(
      ErrorCode.CONFIG_NOT_FOUND,
      'No databases configured. Set DATALINK_{NAME}_URL environment variables.'
    );
  }

  return { databases, defaults: DEFAULT_CONFIG };
}
