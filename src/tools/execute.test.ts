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

  describe('parameter validation', () => {
    it('should throw INVALID_SQL when fewer params than placeholders', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'UPDATE users SET name = $1 WHERE id = $2',
        params: ['Alice'], // Only 1 param, but 2 placeholders
      };

      const mockAdapter = createMockAdapter({ fields: [], rows: [], rowCount: 0 });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.INVALID_SQL,
        message: 'Query has 2 placeholders but 1 parameter provided',
      });
    });

    it('should throw INVALID_SQL when more params than placeholders', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice', 'extra', 'params'], // 3 params, but 1 placeholder
      };

      const mockAdapter = createMockAdapter({ fields: [], rows: [], rowCount: 0 });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.INVALID_SQL,
        message: 'Query has 1 placeholder but 3 parameters provided',
      });
    });

    it('should throw INVALID_SQL when params provided but no placeholders', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: "DELETE FROM users WHERE status = 'inactive'",
        params: ['unexpected'],
      };

      const mockAdapter = createMockAdapter({ fields: [], rows: [], rowCount: 0 });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(execute(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.INVALID_SQL,
        message: 'Query has 0 placeholders but 1 parameter provided',
      });
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

  describe('error handling', () => {
    describe('database not found', () => {
      it('should throw DATABASE_NOT_FOUND when database does not exist in config', async () => {
        const params: ExecuteParams = {
          database: 'nonexistent_db',
          sql: 'INSERT INTO users (name) VALUES ($1)',
          params: ['Alice'],
        };

        await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(execute(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.DATABASE_NOT_FOUND,
          message: 'Database "nonexistent_db" not found in configuration',
          details: {
            database: 'nonexistent_db',
            available: ['testdb', 'readonlydb'],
          },
        });

        // Should not have called createAdapter
        expect(mockCreateAdapter).not.toHaveBeenCalled();
      });

      it('should include all available databases in error details', async () => {
        const configWithMultipleDbs: Config = {
          databases: {
            production: { url: 'postgresql://localhost:5432/prod', readonly: false },
            staging: { url: 'postgresql://localhost:5432/staging', readonly: false },
            analytics: { url: 'mysql://localhost:3306/analytics', readonly: true },
          },
          defaults: mockConfig.defaults,
        };

        const params: ExecuteParams = {
          database: 'unknown_db',
          sql: 'INSERT INTO logs (msg) VALUES ($1)',
          params: ['test'],
        };

        try {
          await execute(params, configWithMultipleDbs);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(DbMcpError);
          const dbError = error as DbMcpError;
          expect(dbError.code).toBe(ErrorCode.DATABASE_NOT_FOUND);
          expect(dbError.details?.available).toEqual(['production', 'staging', 'analytics']);
        }
      });
    });

    describe('invalid SQL syntax', () => {
      it('should propagate parse errors for malformed SQL', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'INSRET INTO users (name) VALUES ($1)', // Typo: INSRET instead of INSERT
          params: ['Alice'],
        };

        const mockAdapter = createMockAdapter(
          { fields: [], rows: [], rowCount: 0 },
          {
            validateQueryForTool: vi.fn().mockImplementation(() => {
              throw new DbMcpError(
                ErrorCode.INVALID_SQL,
                'SQL parse error: unexpected token "INSRET"',
                { sql: params.sql }
              );
            }),
          }
        );
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(execute(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.INVALID_SQL,
        });
      });

      it('should propagate database errors for table not found', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'INSERT INTO nonexistent_table (name) VALUES ($1)',
          params: ['Alice'],
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('relation "nonexistent_table" does not exist');
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'insert',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn(),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow('relation "nonexistent_table" does not exist');
      });

      it('should propagate database errors for column not found', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'UPDATE users SET nonexistent_column = $1 WHERE id = $2',
          params: ['value', 1],
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('column "nonexistent_column" of relation "users" does not exist');
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'update',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn(),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow('column "nonexistent_column"');
      });
    });

    describe('connection errors', () => {
      it('should propagate connection timeout errors', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'INSERT INTO users (name) VALUES ($1)',
          params: ['Alice'],
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new DbMcpError(
              ErrorCode.QUERY_TIMEOUT,
              'Query exceeded timeout of 30000ms',
              { timeout: 30000 }
            );
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'insert',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn(),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(execute(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.QUERY_TIMEOUT,
        });
      });

      it('should propagate connection refused errors', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'DELETE FROM users WHERE id = $1',
          params: [1],
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new DbMcpError(
              ErrorCode.CONNECTION_FAILED,
              'Connection refused: ECONNREFUSED 127.0.0.1:5432',
              { host: '127.0.0.1', port: 5432 }
            );
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'delete',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn(),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(execute(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.CONNECTION_FAILED,
        });
      });

      it('should handle authentication errors', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'UPDATE users SET active = true WHERE id = $1',
          params: [1],
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('FATAL: password authentication failed for user "postgres"');
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'update',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn(),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow('password authentication failed');
      });
    });

    describe('multi-statement queries', () => {
      it('should block multi-statement queries', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'INSERT INTO users (name) VALUES ($1); DROP TABLE users;',
          params: ['Alice'],
        };

        const mockAdapter = createMockAdapter(
          { fields: [], rows: [], rowCount: 0 },
          {
            validateQueryForTool: vi.fn().mockImplementation(() => {
              throw new DbMcpError(
                ErrorCode.MULTI_STATEMENT,
                'Multi-statement queries are not allowed for security reasons',
                { sql: params.sql }
              );
            }),
          }
        );
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(execute(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.MULTI_STATEMENT,
        });
      });
    });

    describe('constraint violations', () => {
      it('should propagate unique constraint violation errors', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'INSERT INTO users (email) VALUES ($1)',
          params: ['duplicate@example.com'],
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('duplicate key value violates unique constraint "users_email_key"');
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'insert',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn(),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow('duplicate key value violates unique constraint');
      });

      it('should propagate foreign key constraint violation errors', async () => {
        const params: ExecuteParams = {
          database: 'testdb',
          sql: 'INSERT INTO orders (user_id) VALUES ($1)',
          params: [99999],
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('insert or update on table "orders" violates foreign key constraint "orders_user_id_fkey"');
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'insert',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn(),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(execute(params, mockConfig)).rejects.toThrow('violates foreign key constraint');
      });
    });
  });

  describe('timeout parameter', () => {
    it('should pass timeout to adapter when specified', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice'],
        timeout: 60000,
      };

      let capturedTimeout: number | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn, options) => {
          capturedTimeout = options?.timeout;
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

      await execute(params, mockConfig);

      expect(capturedTimeout).toBe(60000);
    });

    it('should use default timeout when not specified', async () => {
      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice'],
      };

      let capturedTimeout: number | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn, options) => {
          capturedTimeout = options?.timeout;
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

      await execute(params, mockConfig);

      expect(capturedTimeout).toBe(30000);
    });

    it('should cap timeout at database maxTimeout', async () => {
      const configWithMaxTimeout: Config = {
        databases: {
          testdb: {
            url: 'postgresql://localhost:5432/test',
            readonly: false,
            maxTimeout: 60000,
          },
          readonlydb: mockConfig.databases.readonlydb,
        },
        defaults: mockConfig.defaults,
      };

      const params: ExecuteParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice'],
        timeout: 120000,
      };

      let capturedTimeout: number | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn, options) => {
          capturedTimeout = options?.timeout;
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

      await execute(params, configWithMaxTimeout);

      expect(capturedTimeout).toBe(60000);
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
