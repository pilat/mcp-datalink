/**
 * Tests for execute tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute, type ExecuteParams } from './execute.js';
import type { Config, ParsedQuery } from '../types.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';
import type { RawQueryResult, DatabaseAdapter } from '../adapters/types.js';

// Mock the adapters module
vi.mock('../adapters/index.js', () => ({
  createAdapter: vi.fn(),
}));

import { createAdapter } from '../adapters/index.js';

const mockCreateAdapter = vi.mocked(createAdapter);

describe('execute', () => {
  const mockConfig: Config = {
    databases: {
      testdb: {
        url: 'postgresql://localhost:5432/test',
        readonly: false,
      },
      readonlydb: {
        url: 'postgresql://localhost:5432/readonly',
        readonly: true,
      },
    },
    defaults: {
      maxRows: 100,
      maxCellLength: 500,
      maxTotalSize: 65536,
      maxColumns: 50,
      maxTables: 200,
      maxIndexes: 20,
      timeout: 30000,
    },
  };

  interface AdapterOverrides {
    parseQuery?: (sql: string) => ParsedQuery;
    injectLimit?: (sql: string, limit: number) => string;
    validateQueryForTool?: (sql: string, tool: 'query' | 'execute') => void;
    getExplainPrefix?: (analyze: boolean) => string;
    convertPlaceholders?: (sql: string) => string;
  }

  function createMockAdapter(queryResult: RawQueryResult, overrides?: AdapterOverrides): DatabaseAdapter {
    return {
      type: 'postgresql' as const,
      withConnection: vi.fn().mockImplementation(async (fn) => {
        const mockConn = {
          query: vi.fn().mockResolvedValue(queryResult),
          execute: vi.fn(),
          listTables: vi.fn(),
          describeTable: vi.fn(),
        };
        return fn(mockConn);
      }),
      getDefaultSchema: vi.fn().mockReturnValue('public'),
      dispose: vi.fn(),
      // Dialect methods
      parseQuery: overrides?.parseQuery ?? vi.fn().mockReturnValue({
        type: 'insert',
        hasLimit: false,
        isDangerous: false,
        sql: 'INSERT INTO users (name) VALUES ($1)',
      }),
      injectLimit: overrides?.injectLimit ?? vi.fn(),
      validateQueryForTool: overrides?.validateQueryForTool ?? vi.fn(),
      getExplainPrefix: overrides?.getExplainPrefix ?? vi.fn().mockReturnValue('EXPLAIN '),
      convertPlaceholders: overrides?.convertPlaceholders ?? vi.fn((sql) => sql),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('INSERT statements', () => {
    it('should execute INSERT and return rowsAffected', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice'],
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 1 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'insert',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await execute(params, mockConfig);

      expect(result.command).toBe('INSERT');
      expect(result.rowsAffected).toBe(1);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('UPDATE statements', () => {
    it('should execute UPDATE and return rowsAffected', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'UPDATE users SET name = $1 WHERE id = $2',
        params: ['Bob', 123],
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 5 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'update',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await execute(params, mockConfig);

      expect(result.command).toBe('UPDATE');
      expect(result.rowsAffected).toBe(5);
    });
  });

  describe('DELETE statements', () => {
    it('should execute DELETE and return rowsAffected', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'DELETE FROM users WHERE id = $1',
        params: [123],
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 3 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'delete',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await execute(params, mockConfig);

      expect(result.command).toBe('DELETE');
      expect(result.rowsAffected).toBe(3);
    });
  });

  describe('SELECT blocking', () => {
    it('should block SELECT queries', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          validateQueryForTool: vi.fn().mockImplementation(() => {
            throw new DbMcpError(
              ErrorCode.QUERY_BLOCKED,
              'The execute tool does not accept SELECT statements. Use the query tool instead.',
              { sql: params.sql, queryType: 'select', tool: 'execute' }
            );
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });
  });

  describe('DDL blocking', () => {
    it('should block DROP statements', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'DROP TABLE users',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          validateQueryForTool: vi.fn().mockImplementation(() => {
            throw new DbMcpError(
              ErrorCode.QUERY_BLOCKED,
              'DROP statements are not allowed',
              { sql: params.sql, queryType: 'other', tool: 'execute' }
            );
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('should block CREATE statements', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'CREATE TABLE new_table (id INT)',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          validateQueryForTool: vi.fn().mockImplementation(() => {
            throw new DbMcpError(
              ErrorCode.QUERY_BLOCKED,
              'CREATE statements are not allowed',
              { sql: params.sql, queryType: 'other', tool: 'execute' }
            );
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('should block ALTER statements', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'ALTER TABLE users ADD COLUMN email VARCHAR(255)',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          validateQueryForTool: vi.fn().mockImplementation(() => {
            throw new DbMcpError(
              ErrorCode.QUERY_BLOCKED,
              'ALTER statements are not allowed',
              { sql: params.sql, queryType: 'other', tool: 'execute' }
            );
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });
  });

  describe('readonly database', () => {
    it('should throw READONLY_VIOLATION for readonly database', async () => {
      const params: ExecuteParams = {
        database: 'readonlydb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice'],
      };

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.READONLY_VIOLATION,
      });

      // Should not have called createAdapter since readonly check happens first
      expect(mockCreateAdapter).not.toHaveBeenCalled();
    });
  });

  describe('prepared statements', () => {
    it('should pass params to prepared statement', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'UPDATE users SET name = $1 WHERE id = $2',
        params: ['NewName', 456],
      };

      let capturedParams: unknown[] | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn) => {
          const mockConn = {
            query: vi.fn().mockImplementation((sql: string, queryParams: unknown[]) => {
              capturedParams = queryParams;
              return Promise.resolve({
                fields: [],
                rows: [],
                rowCount: 1,
              });
            }),
            execute: vi.fn(),
            listTables: vi.fn(),
            describeTable: vi.fn(),
          };
          return fn(mockConn);
        }),
        getDefaultSchema: vi.fn().mockReturnValue('public'),
        dispose: vi.fn(),
        parseQuery: vi.fn().mockReturnValue({ type: 'update', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn(),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await execute(params, mockConfig);

      expect(capturedParams).toEqual(['NewName', 456]);
    });

    it('should use empty array when params not provided', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: "DELETE FROM users WHERE status = 'inactive'",
      };

      let capturedParams: unknown[] | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn) => {
          const mockConn = {
            query: vi.fn().mockImplementation((sql: string, queryParams: unknown[]) => {
              capturedParams = queryParams;
              return Promise.resolve({
                fields: [],
                rows: [],
                rowCount: 10,
              });
            }),
            execute: vi.fn(),
            listTables: vi.fn(),
            describeTable: vi.fn(),
          };
          return fn(mockConn);
        }),
        getDefaultSchema: vi.fn().mockReturnValue('public'),
        dispose: vi.fn(),
        parseQuery: vi.fn().mockReturnValue({ type: 'delete', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn(),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await execute(params, mockConfig);

      expect(capturedParams).toEqual([]);
    });
  });

  describe('execution time', () => {
    it('should record executionTime', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'INSERT INTO logs (message) VALUES ($1)',
        params: ['test'],
      };

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn) => {
          // Add small delay to ensure executionTime > 0
          await new Promise((resolve) => setTimeout(resolve, 5));
          const mockConn = {
            query: vi.fn().mockResolvedValue({
              fields: [],
              rows: [],
              rowCount: 1,
            }),
            execute: vi.fn(),
            listTables: vi.fn(),
            describeTable: vi.fn(),
          };
          return fn(mockConn);
        }),
        getDefaultSchema: vi.fn().mockReturnValue('public'),
        dispose: vi.fn(),
        parseQuery: vi.fn().mockReturnValue({ type: 'insert', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn(),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await execute(params, mockConfig);

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.executionTime).toBe('number');
    });
  });

  describe('rowCount handling', () => {
    it('should handle zero rowCount', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice'],
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'insert',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await execute(params, mockConfig);

      expect(result.rowsAffected).toBe(0);
    });
  });
});
