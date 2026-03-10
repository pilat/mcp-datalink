/**
 * Error types and handling for db-mcp server
 */

export const ErrorCode = {
  // SQL validation errors
  INVALID_SQL: 'INVALID_SQL',
  MULTI_STATEMENT: 'MULTI_STATEMENT',
  QUERY_BLOCKED: 'QUERY_BLOCKED',

  // Database errors
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',
  DATABASE_NOT_FOUND: 'DATABASE_NOT_FOUND',

  // Configuration errors
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_INVALID: 'CONFIG_INVALID',

  // Access errors
  READONLY_VIOLATION: 'READONLY_VIOLATION',

  // Response errors
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

export class DbMcpError extends Error {
  public readonly code: ErrorCodeType;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCodeType, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DbMcpError';
    this.code = code;
    this.details = details;

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DbMcpError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
