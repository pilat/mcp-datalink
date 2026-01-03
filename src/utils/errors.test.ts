import { describe, it, expect } from 'vitest';
import { DbMcpError, ErrorCode } from './errors';

describe('ErrorCode', () => {
  it('should have all expected SQL validation error codes', () => {
    expect(ErrorCode.INVALID_SQL).toBe('INVALID_SQL');
    expect(ErrorCode.MULTI_STATEMENT).toBe('MULTI_STATEMENT');
    expect(ErrorCode.QUERY_BLOCKED).toBe('QUERY_BLOCKED');
  });

  it('should have all expected database error codes', () => {
    expect(ErrorCode.CONNECTION_FAILED).toBe('CONNECTION_FAILED');
    expect(ErrorCode.QUERY_TIMEOUT).toBe('QUERY_TIMEOUT');
    expect(ErrorCode.DATABASE_NOT_FOUND).toBe('DATABASE_NOT_FOUND');
  });

  it('should have all expected configuration error codes', () => {
    expect(ErrorCode.CONFIG_NOT_FOUND).toBe('CONFIG_NOT_FOUND');
    expect(ErrorCode.CONFIG_INVALID).toBe('CONFIG_INVALID');
  });

  it('should have all expected access error codes', () => {
    expect(ErrorCode.READONLY_VIOLATION).toBe('READONLY_VIOLATION');
  });
});

describe('DbMcpError', () => {
  it('has correct code and message', () => {
    const error = new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      'Database not found'
    );

    expect(error.code).toBe(ErrorCode.DATABASE_NOT_FOUND);
    expect(error.message).toBe('Database not found');
    expect(error.name).toBe('DbMcpError');
  });

  it('toJSON() works correctly', () => {
    const error = new DbMcpError(
      ErrorCode.QUERY_BLOCKED,
      'Query blocked',
      { reason: 'Use a safer query' }
    );

    const json = error.toJSON();

    expect(json).toEqual({
      name: 'DbMcpError',
      code: ErrorCode.QUERY_BLOCKED,
      message: 'Query blocked',
      details: { reason: 'Use a safer query' },
    });
  });

  it('details is optional', () => {
    const errorWithDetails = new DbMcpError(
      ErrorCode.QUERY_TIMEOUT,
      'Query timed out',
      { hint: 'Reduce query complexity' }
    );
    const errorWithoutDetails = new DbMcpError(
      ErrorCode.QUERY_TIMEOUT,
      'Query timed out'
    );

    expect(errorWithDetails.details).toEqual({ hint: 'Reduce query complexity' });
    expect(errorWithoutDetails.details).toBeUndefined();

    const jsonWithDetails = errorWithDetails.toJSON();
    const jsonWithoutDetails = errorWithoutDetails.toJSON();

    expect(jsonWithDetails.details).toEqual({ hint: 'Reduce query complexity' });
    expect(jsonWithoutDetails.details).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const error = new DbMcpError(
      ErrorCode.CONNECTION_FAILED,
      'Connection failed'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DbMcpError);
  });

  it('has a stack trace', () => {
    const error = new DbMcpError(
      ErrorCode.INVALID_SQL,
      'Invalid SQL'
    );

    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });

  describe('error codes with descriptive messages', () => {
    it('DATABASE_NOT_FOUND with available databases in details', () => {
      const error = new DbMcpError(
        ErrorCode.DATABASE_NOT_FOUND,
        'Database "nonexistent" not found in configuration',
        { database: 'nonexistent', available: ['db1', 'db2', 'db3'] }
      );

      expect(error.code).toBe(ErrorCode.DATABASE_NOT_FOUND);
      expect(error.details?.database).toBe('nonexistent');
      expect(error.details?.available).toEqual(['db1', 'db2', 'db3']);
    });

    it('CONNECTION_FAILED with host and port details', () => {
      const error = new DbMcpError(
        ErrorCode.CONNECTION_FAILED,
        'Connection refused: ECONNREFUSED 127.0.0.1:5432',
        { host: '127.0.0.1', port: 5432, originalError: 'ECONNREFUSED' }
      );

      expect(error.code).toBe(ErrorCode.CONNECTION_FAILED);
      expect(error.details?.host).toBe('127.0.0.1');
      expect(error.details?.port).toBe(5432);
    });

    it('QUERY_TIMEOUT with timeout value', () => {
      const error = new DbMcpError(
        ErrorCode.QUERY_TIMEOUT,
        'Query exceeded timeout of 30000ms',
        { timeout: 30000, sql: 'SELECT * FROM large_table' }
      );

      expect(error.code).toBe(ErrorCode.QUERY_TIMEOUT);
      expect(error.details?.timeout).toBe(30000);
    });

    it('QUERY_BLOCKED with query type and tool', () => {
      const error = new DbMcpError(
        ErrorCode.QUERY_BLOCKED,
        'The query tool only accepts SELECT statements',
        { sql: 'INSERT INTO users VALUES (1)', queryType: 'insert', tool: 'query' }
      );

      expect(error.code).toBe(ErrorCode.QUERY_BLOCKED);
      expect(error.details?.queryType).toBe('insert');
      expect(error.details?.tool).toBe('query');
    });

    it('READONLY_VIOLATION with database name', () => {
      const error = new DbMcpError(
        ErrorCode.READONLY_VIOLATION,
        'Database "analytics" is configured as readonly',
        { database: 'analytics' }
      );

      expect(error.code).toBe(ErrorCode.READONLY_VIOLATION);
      expect(error.details?.database).toBe('analytics');
    });

    it('MULTI_STATEMENT with the problematic SQL', () => {
      const error = new DbMcpError(
        ErrorCode.MULTI_STATEMENT,
        'Multi-statement queries are not allowed for security reasons',
        { sql: 'SELECT 1; DROP TABLE users;' }
      );

      expect(error.code).toBe(ErrorCode.MULTI_STATEMENT);
      expect(error.details?.sql).toContain(';');
    });

    it('INVALID_SQL with parse position', () => {
      const error = new DbMcpError(
        ErrorCode.INVALID_SQL,
        'SQL parse error: unexpected token "FORM"',
        { sql: 'SELECT * FORM users', position: 9 }
      );

      expect(error.code).toBe(ErrorCode.INVALID_SQL);
      expect(error.details?.position).toBe(9);
    });

    it('CONFIG_NOT_FOUND with config file path', () => {
      const error = new DbMcpError(
        ErrorCode.CONFIG_NOT_FOUND,
        'Configuration file not found',
        { path: '/etc/mcp-datalink/config.json' }
      );

      expect(error.code).toBe(ErrorCode.CONFIG_NOT_FOUND);
      expect(error.details?.path).toBe('/etc/mcp-datalink/config.json');
    });

    it('CONFIG_INVALID with validation errors', () => {
      const error = new DbMcpError(
        ErrorCode.CONFIG_INVALID,
        'Invalid configuration: missing required field "url"',
        { field: 'url', database: 'mydb' }
      );

      expect(error.code).toBe(ErrorCode.CONFIG_INVALID);
      expect(error.details?.field).toBe('url');
    });
  });

  describe('error comparison and matching', () => {
    it('can be caught and identified by code', () => {
      const error = new DbMcpError(
        ErrorCode.DATABASE_NOT_FOUND,
        'Database not found'
      );

      try {
        throw error;
      } catch (e) {
        if (e instanceof DbMcpError) {
          expect(e.code).toBe(ErrorCode.DATABASE_NOT_FOUND);
        } else {
          expect.fail('Should be DbMcpError');
        }
      }
    });

    it('can be distinguished from regular Error', () => {
      const dbError = new DbMcpError(ErrorCode.QUERY_TIMEOUT, 'Timeout');
      const regularError = new Error('Regular error');

      expect(dbError instanceof DbMcpError).toBe(true);
      expect(regularError instanceof DbMcpError).toBe(false);
    });
  });
});
