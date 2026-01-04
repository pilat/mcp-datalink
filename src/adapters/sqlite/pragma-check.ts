/**
 * SQLite PRAGMA Modification Check
 *
 * Detects potentially dangerous PRAGMA modifications in SQLite queries.
 */

/**
 * Check for SQLite-specific PRAGMA modifications
 *
 * PRAGMA with '=' is a modification and is not allowed.
 * Read-only PRAGMAs (without =) are permitted by the shared parser.
 *
 * @param sql - SQL query to check
 * @returns Object with isDangerous flag and optional reason
 */
export function checkSqlitePragmaModification(
  sql: string
): { isDangerous: boolean; reason?: string } {
  const normalizedSql = sql.trim().toUpperCase();
  if (normalizedSql.startsWith('PRAGMA') && normalizedSql.includes('=')) {
    return {
      isDangerous: true,
      reason: 'PRAGMA modifications are not allowed',
    };
  }
  return { isDangerous: false };
}
