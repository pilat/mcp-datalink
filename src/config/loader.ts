import type { Config, DatabaseConfig, DefaultsConfig } from '../types.js';

import { DbMcpError, ErrorCode } from '../utils/errors.js';

/**
 * Expand environment variable references in a string.
 * Supports ${VAR_NAME} and ${VAR_NAME:-default} syntax.
 */
export function expandEnvVariables(value: string): string {
  // Pattern matches ${VAR_NAME} or ${VAR_NAME:-default_value}
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

  return value.replace(pattern, (match, varName: string, defaultValue?: string) => {
    const envValue = process.env[varName];
    if (envValue !== undefined) {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    // Return original match if variable not found and no default
    return match;
  });
}

const DEFAULT_CONFIG: DefaultsConfig = {
  maxRows: 100,
  maxTotalSize: 65536, // 64KB
  maxColumns: 50,
  maxTables: 200,
  maxIndexes: 20,
  timeout: 30000,
};

/**
 * Parse a positive integer from a string, returning undefined for invalid values.
 */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Extract databases from DATALINK_{NAME}_URL environment variables.
 * Also supports:
 * - DATALINK_{NAME}_READONLY=true for read-only mode
 * - DATALINK_{NAME}_MAX_TIMEOUT for maximum query timeout (in milliseconds)
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
      const maxTimeoutKey = `DATALINK_${match[1]}_MAX_TIMEOUT`;
      const maxTimeoutValue = process.env[maxTimeoutKey];

      databases[name] = {
        url: expandEnvVariables(value),
        readonly: readonlyValue === 'true' || readonlyValue === '1',
        maxTimeout: parsePositiveInt(maxTimeoutValue),
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

  const maxTotalSize = parsePositiveInt(process.env['DATALINK_MAX_TOTAL_SIZE']);

  return {
    databases,
    defaults: {
      ...DEFAULT_CONFIG,
      ...(maxTotalSize !== undefined && { maxTotalSize }),
    },
  };
}
