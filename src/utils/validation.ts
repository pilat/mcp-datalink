/**
 * Validation utilities for database operations
 */

import type { Config, DatabaseConfig } from '../types.js';

import { DbMcpError, ErrorCode } from './errors.js';

/**
 * Get a validated database configuration, throwing if not found
 *
 * @param database - The database name to look up
 * @param config - The application configuration
 * @returns The database configuration
 * @throws DbMcpError with DATABASE_NOT_FOUND if database not configured
 */
export function getValidatedDatabase(database: string, config: Config): DatabaseConfig {
  const dbConfig = config.databases[database];
  if (!dbConfig) {
    throw new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      `Database "${database}" not found in configuration`,
      { database, available: Object.keys(config.databases) }
    );
  }
  return dbConfig;
}

/**
 * Count placeholder parameters in SQL query
 *
 * Counts PostgreSQL-style placeholders ($1, $2, etc.) in SQL.
 * Ignores placeholders inside string literals (single or double quoted).
 *
 * Note: LLM always uses $N style placeholders. For MySQL/SQLite,
 * adapters convert $N to ? via convertPlaceholders() after validation.
 *
 * @param sql - SQL query to analyze
 * @returns Number of unique placeholders found
 */
export function countPlaceholders(sql: string): number {
  const placeholders = new Set<number>();
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < sql.length) {
    // Handle string literal start
    if (!inString && (sql[i] === "'" || sql[i] === '"')) {
      inString = true;
      stringChar = sql[i];
      i++;
      continue;
    }

    // Handle string literal end (with escaped quote support)
    if (inString && sql[i] === stringChar) {
      if (i + 1 < sql.length && sql[i + 1] === stringChar) {
        // Escaped quote, skip both characters
        i += 2;
        continue;
      } else {
        inString = false;
        i++;
        continue;
      }
    }

    // Look for $N placeholders outside strings
    if (!inString && sql[i] === '$') {
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) {
        j++;
      }
      if (j > i + 1) {
        const num = parseInt(sql.slice(i + 1, j), 10);
        placeholders.add(num);
        i = j;
        continue;
      }
    }

    i++;
  }

  return placeholders.size;
}

/**
 * Validate that the number of parameters matches the placeholder count in SQL
 *
 * @param sql - SQL query with $1, $2, etc. placeholders
 * @param params - Array of parameter values
 * @throws DbMcpError with INVALID_SQL if counts don't match
 */
export function validateParamCount(sql: string, params: unknown[]): void {
  const placeholderCount = countPlaceholders(sql);
  const paramCount = params.length;

  if (placeholderCount !== paramCount) {
    throw new DbMcpError(
      ErrorCode.INVALID_SQL,
      `Query has ${placeholderCount} placeholder${placeholderCount !== 1 ? 's' : ''} but ${paramCount} parameter${paramCount !== 1 ? 's' : ''} provided`,
      { sql, placeholderCount, paramCount }
    );
  }
}
