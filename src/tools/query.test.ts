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
