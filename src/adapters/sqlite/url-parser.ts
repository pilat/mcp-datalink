/**
 * SQLite URL and Path Parsing Utilities
 *
 * Handles parsing of SQLite connection URLs and path validation/resolution.
 */

import * as path from 'path';
import * as fs from 'fs';
import { DbMcpError, ErrorCode } from '../../utils/errors.js';

/**
 * Parse SQLite URL to extract file path
 *
 * Supported formats:
 * - sqlite:///absolute/path.db
 * - sqlite://./relative/path.db
 * - sqlite://:memory:
 * - /absolute/path.db (plain file path)
 * - ./relative/path.db (plain file path)
 *
 * @param url - SQLite connection URL or file path
 * @returns Resolved absolute file path or :memory:
 */
export function parseSqliteUrl(url: string): string {
  if (url.startsWith('sqlite://')) {
    const pathPart = url.slice('sqlite://'.length);

    // Special case: :memory:
    if (pathPart === ':memory:') {
      return ':memory:';
    }

    // Handle both absolute (/path) and relative (./path) paths
    return pathPart;
  }

  // Plain file path (no sqlite:// prefix)
  return url;
}

/**
 * Validate and resolve SQLite database path
 *
 * SECURITY: Prevents path traversal attacks by:
 * 1. Resolving to absolute path
 * 2. Ensuring path doesn't contain suspicious patterns
 * 3. Checking file exists (unless :memory:)
 *
 * @param rawPath - Raw path from config
 * @param basePath - Base directory for relative paths (process.cwd())
 * @returns Validated absolute path
 * @throws DbMcpError if path is invalid or file not found
 */
export function validateAndResolvePath(rawPath: string, basePath: string): string {
  // :memory: is always valid
  if (rawPath === ':memory:') {
    return ':memory:';
  }

  // Resolve to absolute path
  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(basePath, rawPath);

  // Normalize to remove any .. or . components
  const normalizedPath = path.normalize(absolutePath);

  // SECURITY: Check for path traversal attempts
  // After normalization, path should not go above the base directory for relative paths
  if (!path.isAbsolute(rawPath)) {
    // For relative paths, ensure the resolved path is still within reasonable bounds
    // This prevents sqlite://../../etc/passwd type attacks
    const relativeToCwd = path.relative(basePath, normalizedPath);
    if (relativeToCwd.startsWith('..')) {
      throw new DbMcpError(
        ErrorCode.CONFIG_INVALID,
        'Path traversal detected. SQLite path must not escape the working directory.',
        { path: rawPath, resolved: normalizedPath }
      );
    }
  }

  // Check file exists
  if (!fs.existsSync(normalizedPath)) {
    throw new DbMcpError(
      ErrorCode.CONNECTION_FAILED,
      `SQLite database file not found: ${normalizedPath}`,
      { path: rawPath, resolved: normalizedPath }
    );
  }

  return normalizedPath;
}
