import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listTables } from './list-tables.js';
import type { Config, TableInfo } from '../types.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

// Mock the adapters module
vi.mock('../adapters/index.js', () => ({
  createAdapter: vi.fn(),
}));

import { createAdapter } from '../adapters/index.js';

const mockCreateAdapter = vi.mocked(createAdapter);

function createConfig(overrides?: Partial<Config['defaults']>): Config {
  return {
    databases: {
      testdb: { url: 'postgresql://localhost/testdb', readonly: false },
    },
    defaults: {
      maxRows: 100,
      maxTotalSize: 65536,
      maxColumns: 50,
      maxTables: 200,
      maxIndexes: 20,
      timeout: 30000,
      ...overrides,
    },
  };
}

function createMockAdapter(listTablesResult: { tables: TableInfo[]; totalAvailable: number }) {
  return {
    type: 'postgresql' as const,
    withConnection: vi.fn().mockImplementation(async (fn) => {
      const mockConn = {
        query: vi.fn(),
        execute: vi.fn(),
        listTables: vi.fn().mockResolvedValue(listTablesResult),
        describeTable: vi.fn(),
      };
      return fn(mockConn);
    }),
    getDialect: vi.fn(),
    getDefaultSchema: vi.fn().mockReturnValue('public'),
    dispose: vi.fn(),
  };
}

describe('listTables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns tables for schema', async () => {
    const tables: TableInfo[] = [
      { name: 'users', schema: 'public', type: 'table', rows_estimate: 1000 },
      { name: 'orders', schema: 'public', type: 'table', rows_estimate: 5000 },
    ];

    const mockAdapter = createMockAdapter({ tables, totalAvailable: 2 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig();
    const result = await listTables({ database: 'testdb' }, config);

    expect(result.tables).toHaveLength(2);
    expect(result.tables[0]).toEqual({
      name: 'users',
      schema: 'public',
      type: 'table',
      rows_estimate: 1000,
    });
    expect(result.tables[1]).toEqual({
      name: 'orders',
      schema: 'public',
      type: 'table',
      rows_estimate: 5000,
    });
    expect(result.truncated).toBe(false);
  });

  it('default schema is "public"', async () => {
    const mockAdapter = createMockAdapter({ tables: [], totalAvailable: 0 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig();
    await listTables({ database: 'testdb' }, config);

    // Get the mock connection and check the listTables call
    const withConnectionFn = mockAdapter.withConnection.mock.calls[0][0];
    const mockConn = {
      listTables: vi.fn().mockResolvedValue({ tables: [], totalAvailable: 0 }),
    };
    await withConnectionFn(mockConn);

    expect(mockConn.listTables).toHaveBeenCalledWith('public', 200);
  });

  it('uses provided schema parameter', async () => {
    const mockAdapter = createMockAdapter({ tables: [], totalAvailable: 0 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig();
    await listTables({ database: 'testdb', schema: 'custom_schema' }, config);

    // Get the mock connection and check the listTables call
    const withConnectionFn = mockAdapter.withConnection.mock.calls[0][0];
    const mockConn = {
      listTables: vi.fn().mockResolvedValue({ tables: [], totalAvailable: 0 }),
    };
    await withConnectionFn(mockConn);

    expect(mockConn.listTables).toHaveBeenCalledWith('custom_schema', 200);
  });

  it('respects maxTables limit (truncation)', async () => {
    // Create more tables than the limit
    const tables: TableInfo[] = Array.from({ length: 10 }, (_, i) => ({
      name: `table_${i}`,
      schema: 'public',
      type: 'table' as const,
      rows_estimate: i * 100,
    }));

    const mockAdapter = createMockAdapter({ tables, totalAvailable: 10 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig({ maxTables: 5 });
    const result = await listTables({ database: 'testdb' }, config);

    expect(result.tables).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.totalAvailable).toBe(10);
  });

  it('handles views correctly', async () => {
    const tables: TableInfo[] = [
      { name: 'users', schema: 'public', type: 'table', rows_estimate: 1000 },
      { name: 'user_stats', schema: 'public', type: 'view', rows_estimate: null },
    ];

    const mockAdapter = createMockAdapter({ tables, totalAvailable: 2 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig();
    const result = await listTables({ database: 'testdb' }, config);

    expect(result.tables).toHaveLength(2);

    const table = result.tables.find((t) => t.name === 'users');
    const view = result.tables.find((t) => t.name === 'user_stats');

    expect(table?.type).toBe('table');
    expect(table?.rows_estimate).toBe(1000);

    expect(view?.type).toBe('view');
    expect(view?.rows_estimate).toBe(null);
  });

  it('returns truncated flag when over limit', async () => {
    const tables: TableInfo[] = Array.from({ length: 250 }, (_, i) => ({
      name: `table_${i}`,
      schema: 'public',
      type: 'table' as const,
      rows_estimate: 0,
    }));

    const mockAdapter = createMockAdapter({ tables, totalAvailable: 250 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig({ maxTables: 200 });
    const result = await listTables({ database: 'testdb' }, config);

    expect(result.truncated).toBe(true);
    expect(result.tables).toHaveLength(200);
    expect(result.totalAvailable).toBe(250);
  });

  it('does not set totalAvailable when not truncated', async () => {
    const tables: TableInfo[] = [
      { name: 'users', schema: 'public', type: 'table', rows_estimate: 0 },
      { name: 'orders', schema: 'public', type: 'table', rows_estimate: 0 },
    ];

    const mockAdapter = createMockAdapter({ tables, totalAvailable: 2 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig({ maxTables: 200 });
    const result = await listTables({ database: 'testdb' }, config);

    expect(result.truncated).toBe(false);
    expect(result.totalAvailable).toBeUndefined();
  });

  it('handles empty result', async () => {
    const mockAdapter = createMockAdapter({ tables: [], totalAvailable: 0 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig();
    const result = await listTables({ database: 'testdb' }, config);

    expect(result.tables).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  describe('error handling', () => {
    describe('database not found', () => {
      it('should throw DATABASE_NOT_FOUND when database does not exist in config', async () => {
        const config = createConfig();

        await expect(listTables({ database: 'nonexistent_db' }, config)).rejects.toThrow(DbMcpError);
        await expect(listTables({ database: 'nonexistent_db' }, config)).rejects.toMatchObject({
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

      it('should include all available databases in error details', async () => {
        const configWithMultipleDbs: Config = {
          databases: {
            production: { url: 'postgresql://localhost:5432/prod', readonly: false },
            staging: { url: 'postgresql://localhost:5432/staging', readonly: false },
            analytics: { url: 'mysql://localhost:3306/analytics', readonly: true },
          },
          defaults: {
            maxRows: 100,
            maxTotalSize: 65536,
            maxColumns: 50,
            maxTables: 200,
            maxIndexes: 20,
            timeout: 30000,
          },
        };

        try {
          await listTables({ database: 'unknown_db' }, configWithMultipleDbs);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(DbMcpError);
          const dbError = error as DbMcpError;
          expect(dbError.code).toBe(ErrorCode.DATABASE_NOT_FOUND);
          expect(dbError.details?.available).toEqual(['production', 'staging', 'analytics']);
        }
      });
    });

    describe('connection errors', () => {
      it('should propagate connection timeout errors', async () => {
        const mockAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new DbMcpError(
              ErrorCode.QUERY_TIMEOUT,
              'Query exceeded timeout of 30000ms',
              { timeout: 30000 }
            );
          }),
          getDialect: vi.fn(),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        const config = createConfig();

        await expect(listTables({ database: 'testdb' }, config)).rejects.toThrow(DbMcpError);
        await expect(listTables({ database: 'testdb' }, config)).rejects.toMatchObject({
          code: ErrorCode.QUERY_TIMEOUT,
        });
      });

      it('should propagate connection refused errors', async () => {
        const mockAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new DbMcpError(
              ErrorCode.CONNECTION_FAILED,
              'Connection refused: ECONNREFUSED 127.0.0.1:5432',
              { host: '127.0.0.1', port: 5432 }
            );
          }),
          getDialect: vi.fn(),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        const config = createConfig();

        await expect(listTables({ database: 'testdb' }, config)).rejects.toThrow(DbMcpError);
        await expect(listTables({ database: 'testdb' }, config)).rejects.toMatchObject({
          code: ErrorCode.CONNECTION_FAILED,
          message: 'Connection refused: ECONNREFUSED 127.0.0.1:5432',
        });
      });

      it('should handle authentication errors', async () => {
        const mockAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async () => {
            throw new Error('FATAL: password authentication failed for user "postgres"');
          }),
          getDialect: vi.fn(),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        const config = createConfig();

        await expect(listTables({ database: 'testdb' }, config)).rejects.toThrow('password authentication failed');
      });
    });

    describe('schema errors', () => {
      it('should propagate errors for non-existent schema', async () => {
        const mockAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async (fn) => {
            const mockConn = {
              listTables: vi.fn().mockImplementation(async () => {
                throw new Error('schema "nonexistent_schema" does not exist');
              }),
            };
            return fn(mockConn);
          }),
          getDialect: vi.fn(),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        const config = createConfig();

        await expect(
          listTables({ database: 'testdb', schema: 'nonexistent_schema' }, config)
        ).rejects.toThrow('schema "nonexistent_schema" does not exist');
      });
    });
  });

  it('converts rows_estimate to number', async () => {
    const tables: TableInfo[] = [
      { name: 'users', schema: 'public', type: 'table', rows_estimate: 15000 },
    ];

    const mockAdapter = createMockAdapter({ tables, totalAvailable: 1 });
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const config = createConfig();
    const result = await listTables({ database: 'testdb' }, config);

    expect(typeof result.tables[0].rows_estimate).toBe('number');
    expect(result.tables[0].rows_estimate).toBe(15000);
  });
});
