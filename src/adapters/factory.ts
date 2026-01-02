/**
 * Database Adapter Factory
 *
 * Creates the appropriate database adapter based on connection URL scheme.
 *
 * Phase 1: PostgreSQL - DONE
 * Phase 2: MySQL - DONE
 * Phase 3: SQLite - DONE
 */

import type { DatabaseAdapter, AdapterConfig } from './types.js';
import type { DatabaseConfig, DefaultsConfig } from '../types.js';
import { PostgreSqlAdapter } from './postgresql/adapter.js';
import { MySqlAdapter } from './mysql/adapter.js';
import { SqliteAdapter } from './sqlite/adapter.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

/**
 * Supported database URL schemes
 */
type DatabaseScheme = 'postgresql' | 'mysql' | 'sqlite';

/**
 * Detect database type from URL scheme
 *
 * @param url - Database connection URL
 * @returns Database scheme type
 * @throws DbMcpError if scheme is not recognized
 */
function detectScheme(url: string): DatabaseScheme {
  // PostgreSQL: postgresql:// or postgres://
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgresql';
  }

  // MySQL: mysql://
  if (url.startsWith('mysql://')) {
    return 'mysql';
  }

  // SQLite: sqlite:// or file path ending in .db/.sqlite/.sqlite3
  if (
    url.startsWith('sqlite://') ||
    url.endsWith('.db') ||
    url.endsWith('.sqlite') ||
    url.endsWith('.sqlite3')
  ) {
    return 'sqlite';
  }

  throw new DbMcpError(
    ErrorCode.CONFIG_INVALID,
    `Unknown database URL scheme: ${url}. ` +
      'Supported schemes: postgresql://, postgres://, mysql://, sqlite://',
    { url }
  );
}

/**
 * Create a base database adapter (without SSH wrapping)
 *
 * @param config - Adapter configuration
 * @param scheme - Database scheme type
 * @returns Appropriate DatabaseAdapter instance
 */
function createBaseAdapter(
  config: AdapterConfig,
  scheme: DatabaseScheme
): DatabaseAdapter {
  switch (scheme) {
    case 'postgresql':
      return new PostgreSqlAdapter(config);

    case 'mysql':
      return new MySqlAdapter(config);

    case 'sqlite':
      return new SqliteAdapter(config);

    default: {
      // TypeScript exhaustive check
      const _exhaustive: never = scheme;
      throw new DbMcpError(
        ErrorCode.CONFIG_INVALID,
        `Unexpected database scheme: ${_exhaustive}`
      );
    }
  }
}

/**
 * Create a database adapter based on configuration
 *
 * Auto-detects database type from URL scheme:
 * - `postgresql://` or `postgres://` -> PostgreSQL adapter
 * - `mysql://` -> MySQL adapter
 * - `sqlite://` or `.db`/`.sqlite` file path -> SQLite adapter
 *
 * @param database - Database configuration (url, readonly, etc.)
 * @param defaults - Default settings (timeout, limits)
 * @returns Appropriate DatabaseAdapter instance
 * @throws DbMcpError if database type is not supported
 */
export function createAdapter(
  database: DatabaseConfig,
  defaults: DefaultsConfig
): DatabaseAdapter {
  const scheme = detectScheme(database.url);

  const config: AdapterConfig = {
    database,
    defaults,
  };

  return createBaseAdapter(config, scheme);
}

/**
 * Check if a URL is for a supported database type
 *
 * @param url - Database connection URL
 * @returns true if the URL scheme is recognized
 */
export function isSupportedUrl(url: string): boolean {
  try {
    detectScheme(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a database type is currently implemented
 *
 * @param url - Database connection URL
 * @returns true if the database type can be used now
 */
export function isImplemented(url: string): boolean {
  try {
    const scheme = detectScheme(url);
    // All three database types are now implemented (Phase 1-3)
    return scheme === 'postgresql' || scheme === 'mysql' || scheme === 'sqlite';
  } catch {
    return false;
  }
}
