/**
 * Tests for explain tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { explain, type ExplainParams } from './explain.js';
import type { Config, ParsedQuery } from '../types.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';
import type { RawQueryResult, DatabaseAdapter } from '../adapters/types.js';

// Mock the adapters module
vi.mock('../adapters/index.js', () => ({
  createAdapter: vi.fn(),
}));

import { createAdapter } from '../adapters/index.js';

const mockCreateAdapter = vi.mocked(createAdapter);

describe('explain', () => {
  const mockConfig: Config = {
    databases: {
      testdb: {
        url: 'postgresql://localhost:5432/test',
        readonly: false,
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

  // Sample plan rows - adapter returns rows as arrays (first element is plan line)
  const samplePlanRows: unknown[][] = [
    ['Seq Scan on users  (cost=0.00..15.00 rows=500 width=100)'],
    ["  Filter: (status = 'active')"],
  ];

  interface AdapterOverrides {
    parseQuery?: (sql: string) => ParsedQuery;
    injectLimit?: (sql: string, limit: number) => string;
    validateQueryForTool?: (sql: string, tool: 'query' | 'execute') => void;
    getExplainPrefix?: (analyze: boolean) => string;
    convertPlaceholders?: (sql: string) => string;
    type?: 'postgresql' | 'mysql' | 'sqlite';
  }

  function createMockAdapter(queryResult: RawQueryResult, overrides?: AdapterOverrides) {
    const executeCalls: string[] = [];
    const queryCalls: Array<{ sql: string; params?: unknown[] }> = [];

    return {
      type: overrides?.type ?? ('postgresql' as const),
      withConnection: vi.fn().mockImplementation(async (fn) => {
        const mockConn = {
          query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
            queryCalls.push({ sql, params });
            return Promise.resolve(queryResult);
          }),
          execute: vi.fn().mockImplementation((sql: string) => {
            executeCalls.push(sql);
            return Promise.resolve();
          }),
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
      injectLimit: overrides?.injectLimit ?? vi.fn(),
      validateQueryForTool: overrides?.validateQueryForTool ?? vi.fn(),
      getExplainPrefix: overrides?.getExplainPrefix ?? vi.fn().mockImplementation((analyze: boolean) =>
        analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN '
      ),
      convertPlaceholders: overrides?.convertPlaceholders ?? vi.fn((sql) => sql),
      // Expose captured calls for assertions
      _executeCalls: executeCalls,
      _queryCalls: queryCalls,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('EXPLAIN', () => {
    it('should execute EXPLAIN and return plan', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users WHERE status = $1',
      };

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'QUERY PLAN' }],
        rows: samplePlanRows,
        rowCount: 2,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await explain(params, mockConfig);

      // Should have BEGIN, query, COMMIT calls (security: read-only transaction)
      expect(mockAdapter._executeCalls).toContain('BEGIN TRANSACTION READ ONLY');
      expect(mockAdapter._executeCalls).toContain('COMMIT');
      expect(mockAdapter._queryCalls[0].sql).toBe('EXPLAIN SELECT * FROM users WHERE status = $1');
      expect(result.plan).toBe(
        "Seq Scan on users  (cost=0.00..15.00 rows=500 width=100)\n  Filter: (status = 'active')"
      );
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should default analyze to false', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'SELECT 1',
      };

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'QUERY PLAN' }],
        rows: [['Result']],
        rowCount: 1,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await explain(params, mockConfig);

      expect(mockAdapter._queryCalls[0].sql).toBe('EXPLAIN SELECT 1');
      expect(mockAdapter._queryCalls[0].sql).not.toContain('ANALYZE');
    });
  });

  describe('EXPLAIN ANALYZE', () => {
    it('should execute EXPLAIN ANALYZE when analyze=true', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
        analyze: true,
      };

      const analyzePlanRows: unknown[][] = [
        ['Seq Scan on users  (cost=0.00..15.00 rows=500 width=100) (actual time=0.015..0.020 rows=10 loops=1)'],
        ['Planning Time: 0.050 ms'],
        ['Execution Time: 0.035 ms'],
      ];

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'QUERY PLAN' }],
        rows: analyzePlanRows,
        rowCount: 3,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await explain(params, mockConfig);

      expect(mockAdapter._queryCalls[0].sql).toBe('EXPLAIN ANALYZE SELECT * FROM users');
      expect(result.plan).toContain('actual time');
      expect(result.plan).toContain('Planning Time');
      expect(result.plan).toContain('Execution Time');
    });
  });

  describe('dangerous queries blocking', () => {
    it('should block DROP queries', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'DROP TABLE users',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'other',
            hasLimit: false,
            isDangerous: true,
            dangerousReason: 'DROP statements are not allowed',
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(explain(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(explain(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });

      // Should not have called withConnection
      expect(mockAdapter.withConnection).not.toHaveBeenCalled();
    });

    it('should block TRUNCATE queries', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'TRUNCATE TABLE users',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'other',
            hasLimit: false,
            isDangerous: true,
            dangerousReason: 'TRUNCATE statements are not allowed',
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(explain(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(explain(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('should block ALTER queries', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'ALTER TABLE users ADD COLUMN email VARCHAR(255)',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'other',
            hasLimit: false,
            isDangerous: true,
            dangerousReason: 'ALTER statements are not allowed',
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(explain(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(explain(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('should block CREATE queries', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'CREATE TABLE new_users (id INT)',
      };

      const mockAdapter = createMockAdapter(
        { fields: [], rows: [], rowCount: 0 },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'other',
            hasLimit: false,
            isDangerous: true,
            dangerousReason: 'CREATE statements are not allowed',
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      await expect(explain(params, mockConfig)).rejects.toThrow(DbMcpError);
      await expect(explain(params, mockConfig)).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });
  });

  describe('plan formatting', () => {
    it('should return plan as text with newlines', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id',
      };

      const complexPlanRows: unknown[][] = [
        ['Hash Join  (cost=10.00..50.00 rows=100 width=200)'],
        ['  Hash Cond: (o.user_id = u.id)'],
        ['  ->  Seq Scan on orders o  (cost=0.00..30.00 rows=500 width=100)'],
        ['  ->  Hash  (cost=5.00..5.00 rows=100 width=100)'],
        ['        ->  Seq Scan on users u  (cost=0.00..5.00 rows=100 width=100)'],
      ];

      const mockAdapter = createMockAdapter({
        fields: [{ name: 'QUERY PLAN' }],
        rows: complexPlanRows,
        rowCount: 5,
      });
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await explain(params, mockConfig);

      const lines = result.plan.split('\n');
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe('Hash Join  (cost=10.00..50.00 rows=100 width=200)');
      expect(lines[1]).toBe('  Hash Cond: (o.user_id = u.id)');
    });
  });

  describe('execution time', () => {
    it('should record executionTime', async () => {
      const params: ExplainParams = {
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
              fields: [{ name: 'QUERY PLAN' }],
              rows: [['Result']],
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
        injectLimit: vi.fn(),
        validateQueryForTool: vi.fn(),
        getExplainPrefix: vi.fn().mockImplementation((analyze: boolean) =>
          analyze ? 'EXPLAIN ANALYZE ' : 'EXPLAIN '
        ),
        convertPlaceholders: vi.fn((sql) => sql),
      };
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await explain(params, mockConfig);

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.executionTime).toBe('number');
    });
  });

  describe('non-dangerous queries', () => {
    it('should allow SELECT queries', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'SELECT * FROM users',
      };

      const mockAdapter = createMockAdapter(
        {
          fields: [{ name: 'QUERY PLAN' }],
          rows: [['Seq Scan on users']],
          rowCount: 1,
        },
        {
          parseQuery: vi.fn().mockReturnValue({
            type: 'select',
            hasLimit: false,
            isDangerous: false,
            sql: params.sql,
          }),
        }
      );
      mockCreateAdapter.mockReturnValue(mockAdapter);

      const result = await explain(params, mockConfig);

      expect(result.plan).toBe('Seq Scan on users');
    });

    it('should allow INSERT queries (for plan analysis)', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'INSERT INTO users (name) VALUES ($1)',
      };

      const mockAdapter = createMockAdapter(
        {
          fields: [{ name: 'QUERY PLAN' }],
          rows: [['Insert on users']],
          rowCount: 1,
        },
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

      const result = await explain(params, mockConfig);

      expect(result.plan).toBe('Insert on users');
    });

    it('should allow UPDATE queries (for plan analysis)', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'UPDATE users SET name = $1 WHERE id = $2',
      };

      const mockAdapter = createMockAdapter(
        {
          fields: [{ name: 'QUERY PLAN' }],
          rows: [['Update on users']],
          rowCount: 1,
        },
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

      const result = await explain(params, mockConfig);

      expect(result.plan).toBe('Update on users');
    });

    it('should allow DELETE queries (for plan analysis)', async () => {
      const params: ExplainParams = {
        database: 'testdb',
        sql: 'DELETE FROM users WHERE id = $1',
      };

      const mockAdapter = createMockAdapter(
        {
          fields: [{ name: 'QUERY PLAN' }],
          rows: [['Delete on users']],
          rowCount: 1,
        },
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

      const result = await explain(params, mockConfig);

      expect(result.plan).toBe('Delete on users');
    });
  });
});
