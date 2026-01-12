/**
 * Timeout calculation utilities
 */

/**
 * Calculate effective timeout considering request, database max, and default.
 *
 * Priority: requested ?? defaultTimeout, capped by maxTimeout if configured.
 *
 * @param requested - Timeout requested by the caller (optional)
 * @param maxTimeout - Maximum timeout allowed for this database (optional)
 * @param defaultTimeout - Default timeout from config
 * @returns Effective timeout in milliseconds
 */
export function calculateTimeout(
  requested: number | undefined,
  maxTimeout: number | undefined,
  defaultTimeout: number
): number {
  const timeout = requested ?? defaultTimeout;
  if (maxTimeout !== undefined) {
    return Math.min(timeout, maxTimeout);
  }
  return timeout;
}
