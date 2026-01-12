/**
 * Tests for query tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query, type QueryParams } from './query.js';
import type { Config, ParsedQuery } from '../types.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';
import type { RawQueryResult, DatabaseAdapter } from '../adapters/types.js';

// Mock the adapters module
vi.mock('../adapters/index.js', () => ({
  createAdapter: vi.fn(),
}));

import { createAdapter } from '../adapters/index.js';

const mockCreateAdapter = vi.mocked(createAdapter);

describe('query', () => {
  const mockConfig: Config = {
    databases: {
      testdb: {
        url: 'postgresql://localhost:5432/test',
        readonly: false,
        maxRows: 50,
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
        type: 'select',
        hasLimit: false,
        isDangerous: false,
        sql: 'SELECT * FROM users',
      }),
      injectLimit: overrides?.injectLimit ?? vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
      validateQueryForTool: overrides?.validateQueryForTool ?? vi.fn(),
      getExplainPrefix: overrides?.getExplainPrefix ?? vi.fn().mockReturnValue('EXPLAIN '),
      convertPlaceholders: overrides?.convertPlaceholders ?? vi.fn((sql) => sql),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SELECT queries', () => {
    it('should execute SELECT and return formatted results', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT id, name FROM users',
      };

      const queryResult: RawQueryResult = {
        fields: [{ name: 'id' }, { name: 'name' }],
        rows: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
        rowCount: 2,
      };

      const mockAdapter = createMockAdapter(queryResult);
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await query(params, mockConfig);

      expect(result.columns).toEqual(['id', 'name']);
      expect(result.rows).toEqual([
        ['1', 'Alice'],
        ['2', 'Bob'],
      ]);
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should block non-SELECT queries', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
        params: ['Alice'],
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          validateQueryForTool: vi.fn().mockImplementation(() => {
            throw new DbMcpError(
              ErrorCode.QUERY_BLOCKED,
              'The query tool only accepts SELECT statements. Use the execute tool for INSERT statements.',
              { sql: params.sql, queryType: 'insert', tool: 'query' }
            );
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(query(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });
  });

  describe('parameter validation', () => {
    it('should throw INVALID_SQL when fewer params than placeholders', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users WHERE id = $1 AND name = $2',
        params: ['123'], // Only 1 param, but 2 placeholders
      };

      const mockAdapter = createMockAdapter({ fields: [], rows: [], rowCount: 0 });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(query(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.INVALID_SQL,
        message: 'Query has 2 placeholders but 1 parameter provided',
      });
    });

    it('should throw INVALID_SQL when more params than placeholders', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users WHERE id = $1',
        params: ['123', 'extra'], // 2 params, but 1 placeholder
      };

      const mockAdapter = createMockAdapter({ fields: [], rows: [], rowCount: 0 });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(query(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.INVALID_SQL,
        message: 'Query has 1 placeholder but 2 parameters provided',
      });
    });

    it('should throw INVALID_SQL when params provided but no placeholders', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
        params: ['unexpected'],
      };

      const mockAdapter = createMockAdapter({ fields: [], rows: [], rowCount: 0 });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(query(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.INVALID_SQL,
        message: 'Query has 0 placeholders but 1 parameter provided',
      });
    });
  });

  describe('prepared statements', () => {
    it('should pass params to prepared statement', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users WHERE id = $1',
        params: [123],
      };

      let capturedParams: unknown[] | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn) => {
          const mockConn = {
            query: vi.fn().mockImplementation((sql: string, queryParams: unknown[]) => {
              capturedParams = queryParams;
              return Promise.resolve({
                fields: [{ name: 'id' }],
                rows: [[123]],
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
        parseQuery: vi.fn().mockReturnValue({ type: 'select', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await query(params, mockConfig);

      expect(capturedParams).toEqual([123]);
    });
  });

  describe('LIMIT injection', () => {
    it('should inject LIMIT when missing', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
      };

      const injectLimitMock = vi.fn().mockReturnValue('SELECT * FROM users LIMIT 50');
      const mockAdapter = createMockAdapter(
        { fields: [{ name: 'id' }], rows: [], rowCount: 0 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'select',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: injectLimitMock,
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await query(params, mockConfig);

      // Should have called injectLimit with database-specific maxRows (50)
      expect(injectLimitMock).toHaveBeenCalledWith(params.sql, 50);
    });

    it('should not modify existing LIMIT', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users LIMIT 10',
      };

      const injectLimitMock = vi.fn();
      const mockAdapter = createMockAdapter(
        { fields: [{ name: 'id' }], rows: [], rowCount: 0 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'select',
            hasLimit: true,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: injectLimitMock,
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await query(params, mockConfig);

      // Should NOT have called injectLimit
      expect(injectLimitMock).not.toHaveBeenCalled();
    });
  });

  describe('truncation', () => {
    it('should truncate cells when over maxCellLength', async () => {
      const longText = 'x'.repeat(600); // Over default 500
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT content FROM posts',
      };

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'content' }],
        rows: [[longText]],
        rowCount: 1,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await query(params, mockConfig);

      expect(result.truncated).toBe(true);
      expect(result.truncationReason).toBe('maxCellLength');
      // The cell should be truncated
      expect((result.rows[0][0] as string).length).toBeLessThan(longText.length);
      expect((result.rows[0][0] as string).endsWith('...')).toBe(true);
    });

    it('should truncate rows when over maxRows', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT id FROM users',
      };

      // Generate 150 rows (over default maxRows of 100)
      const manyRows = Array.from({ length: 150 }, (_, i) => [i]);

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'id' }],
        rows: manyRows,
        rowCount: 150,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await query(params, mockConfig);

      expect(result.truncated).toBe(true);
      expect(result.truncationReason).toBe('maxRows');
      expect(result.rowCount).toBe(100); // maxRows default
      expect(result.totalAvailable).toBe(150);
      expect(result.returned).toBe(100);
      expect(result.hint).toBe('Use LIMIT/OFFSET or WHERE clause to paginate');
    });
  });

  describe('execution time', () => {
    it('should record executionTime', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT 1',
      };

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn) => {
          // Add small delay to ensure executionTime > 0
          await new Promise((resolve) => setTimeout(resolve, 5));
          const mockConn = {
            query: vi.fn().mockResolvedValue({
              fields: [{ name: '?column?' }],
              rows: [[1]],
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
        parseQuery: vi.fn().mockReturnValue({ type: 'select', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await query(params, mockConfig);

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.executionTime).toBe('number');
    });
  });

  describe('error handling', () => {
    describe('database not found', () => {
      it('should throw DATABASE_NOT_FOUND when database does not exist in config', async () => {
        const params: QueryParams = {
          database: 'nonexistent_db',
          sql: 'SELECT * FROM users',
        };

        await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(query(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.DATABASE_NOT_FOUND,
          message: 'Database "nonexistent_db" not found in configuration',
          details: {
            database: 'nonexistent_db',
            available: ['testdb'],
          },
        });

        // Should not have called createAdapter
        expect(mockCreateAdapter).not.toHaveBeenCalled();
      });

      it('should include available databases in error details', async () => {
        const configWithMultipleDbs: Config = {
          databases: {
            db1: { url: 'postgresql://localhost:5432/db1', readonly: false },
            db2: { url: 'postgresql://localhost:5432/db2', readonly: true },
            db3: { url: 'mysql://localhost:3306/db3', readonly: false },
          },
          defaults: mockConfig.defaults,
        };

        const params: QueryParams = {
          database: 'unknown',
          sql: 'SELECT 1',
        };

        try {
          await query(params, configWithMultipleDbs);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(DbMcpError);
          const dbError = error as DbMcpError;
          expect(dbError.details?.available).toEqual(['db1', 'db2', 'db3']);
        }
      });
    });

    describe('invalid SQL syntax', () => {
      it('should propagate parse errors for malformed SQL', async () => {
        const params: QueryParams = {
          database: 'testdb',
          sql: 'SELECT * FORM users', // Typo: FORM instead of FROM
        };

        const mockAdapter = createMockAdapter(
          { fields: [], rows: [], rowCount: 0 },
          {
            validateQueryForTool: vi.fn().mockImplementation(() => {
              throw new DbMcpError(
                ErrorCode.INVALID_SQL,
                'SQL parse error: unexpected token "FORM"',
                { sql: params.sql, position: 9 }
              );
            }),
          }
        );
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(query(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.INVALID_SQL,
        });
      });

      it('should propagate database errors for runtime SQL errors', async () => {
        const params: QueryParams = {
          database: 'testdb',
          sql: 'SELECT * FROM nonexistent_table',
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('relation "nonexistent_table" does not exist');
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'select',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(query(params, mockConfig)).rejects.toThrow('relation "nonexistent_table" does not exist');
      });
    });

    describe('connection errors', () => {
      it('should propagate connection timeout errors', async () => {
        const params: QueryParams = {
          database: 'testdb',
          sql: 'SELECT * FROM users',
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new DbMcpError(
              ErrorCode.QUERY_TIMEOUT,
              'Query exceeded timeout of 30000ms',
              { timeout: 30000, sql: params.sql }
            );
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'select',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(query(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.QUERY_TIMEOUT,
        });
      });

      it('should propagate connection refused errors', async () => {
        const params: QueryParams = {
          database: 'testdb',
          sql: 'SELECT * FROM users',
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
            type: 'select',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(query(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.CONNECTION_FAILED,
          message: 'Connection refused: ECONNREFUSED 127.0.0.1:5432',
        });
      });

      it('should handle generic connection errors', async () => {
        const params: QueryParams = {
          database: 'testdb',
          sql: 'SELECT * FROM users',
        };

        const mockAdapter: DatabaseAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('FATAL: password authentication failed for user "postgres"');
          }),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
          parseQuery: vi.fn().mockReturnValue({
            type: 'select',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
          injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
          validateQueryForTool: vi.fn(),
          getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
          convertPlaceholders: vi.fn((sql) => sql),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        await expect(query(params, mockConfig)).rejects.toThrow('password authentication failed');
      });
    });

    describe('multi-statement queries', () => {
      it('should block multi-statement queries', async () => {
        const params: QueryParams = {
          database: 'testdb',
          sql: 'SELECT * FROM users; DROP TABLE users;',
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

        await expect(query(params, mockConfig)).rejects.toThrow(DbMcpError);
        await expect(query(params, mockConfig)).rejects.toMatchObject({
          code: ErrorCode.MULTI_STATEMENT,
        });
      });
    });
  });

  describe('timeout parameter', () => {
    it('should pass timeout to adapter when specified', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
        timeout: 60000,
      };

      let capturedTimeout: number | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn, options) => {
          capturedTimeout = options?.timeout;
          const mockConn = {
            query: vi.fn().mockResolvedValue({
              fields: [{ name: 'id' }],
              rows: [[1]],
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
        parseQuery: vi.fn().mockReturnValue({ type: 'select', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await query(params, mockConfig);

      expect(capturedTimeout).toBe(60000);
    });

    it('should use default timeout when not specified', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
      };

      let capturedTimeout: number | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn, options) => {
          capturedTimeout = options?.timeout;
          const mockConn = {
            query: vi.fn().mockResolvedValue({
              fields: [{ name: 'id' }],
              rows: [[1]],
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
        parseQuery: vi.fn().mockReturnValue({ type: 'select', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await query(params, mockConfig);

      expect(capturedTimeout).toBe(30000); // default from config
    });

    it('should cap timeout at database maxTimeout', async () => {
      const configWithMaxTimeout: Config = {
        databases: {
          testdb: {
            url: 'postgresql://localhost:5432/test',
            readonly: false,
            maxTimeout: 60000, // cap at 60 seconds
          },
        },
        defaults: mockConfig.defaults,
      };

      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
        timeout: 120000, // request 120 seconds
      };

      let capturedTimeout: number | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn, options) => {
          capturedTimeout = options?.timeout;
          const mockConn = {
            query: vi.fn().mockResolvedValue({
              fields: [{ name: 'id' }],
              rows: [[1]],
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
        parseQuery: vi.fn().mockReturnValue({ type: 'select', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await query(params, configWithMaxTimeout);

      expect(capturedTimeout).toBe(60000); // capped at maxTimeout
    });

    it('should use requested timeout when below maxTimeout', async () => {
      const configWithMaxTimeout: Config = {
        databases: {
          testdb: {
            url: 'postgresql://localhost:5432/test',
            readonly: false,
            maxTimeout: 120000, // cap at 120 seconds
          },
        },
        defaults: mockConfig.defaults,
      };

      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
        timeout: 60000, // request 60 seconds
      };

      let capturedTimeout: number | undefined;

      const mockAdapter: DatabaseAdapter = {
        type: 'postgresql' as const,
        withConnection: vi.fn().mockImplementation(async (fn, options) => {
          capturedTimeout = options?.timeout;
          const mockConn = {
            query: vi.fn().mockResolvedValue({
              fields: [{ name: 'id' }],
              rows: [[1]],
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
        parseQuery: vi.fn().mockReturnValue({ type: 'select', hasLimit: false, isDangerous: false, sql: params.sql }),
        injectLimit: vi.fn().mockImplementation((sql: string) => sql + ' LIMIT 100'),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockReturnValue('EXPLAIN '),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await query(params, configWithMaxTimeout);

      expect(capturedTimeout).toBe(60000); // requested timeout used
    });
  });

  describe('value formatting', () => {
    it('should format NULL values', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT nullable_col FROM test',
      };

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'nullable_col' }],
        rows: [[null]],
        rowCount: 1,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await query(params, mockConfig);

      expect(result.rows[0][0]).toBe('NULL');
    });

    it('should format dates as ISO strings', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT created_at FROM users',
      };

      const testDate = new Date('2024-01-15T10:30:00Z');

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'created_at' }],
        rows: [[testDate]],
        rowCount: 1,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await query(params, mockConfig);

      expect(result.rows[0][0]).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should format objects as JSON', async () => {
      const params: QueryParams = {
        database: 'testdb',
        sql: 'SELECT metadata FROM users',
      };

      const jsonData = { key: 'value', nested: { a: 1 } };

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'metadata' }],
        rows: [[jsonData]],
        rowCount: 1,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await query(params, mockConfig);

      expect(result.rows[0][0]).toBe(JSON.stringify(jsonData));
    });
  });
});
