/**
 * Tests for describe_table tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { describeTable, type DescribeTableParams } from './describe-table.js';
import type { Config, TableDescription } from '../types.js';
import { DbMcpError, ErrorCode } from '../utils/errors.js';

// Mock the adapters module
vi.mock('../adapters/index.js', () => ({
  createAdapter: vi.fn(),
}));

import { createAdapter } from '../adapters/index.js';

const mockCreateAdapter = vi.mocked(createAdapter);

const defaultConfig: Config = {
  databases: {
    testdb: {
      url: 'postgresql://localhost/test',
      readonly: false,
    },
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

function createMockAdapter(describeTableResult: TableDescription) {
  return {
    type: 'postgresql' as const,
    withConnection: vi.fn().mockImplementation(async (fn) => {
      const mockConn = {
        query: vi.fn(),
        execute: vi.fn(),
        listTables: vi.fn(),
        describeTable: vi.fn().mockResolvedValue(describeTableResult),
      };
      return fn(mockConn);
    }),
    getDialect: vi.fn(),
    getDefaultSchema: vi.fn().mockReturnValue('public'),
    dispose: vi.fn(),
  };
}

describe('describeTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns column metadata correctly', async () => {
    const mockResult: TableDescription = {
      table: 'users',
      schema: 'public',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()', primaryKey: false },
        { name: 'email', type: 'varchar(255)', nullable: false, default: null, primaryKey: false },
        { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()', primaryKey: false },
      ],
      indexes: [],
      foreignKeys: [],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'users' };
    const result = await describeTable(params, defaultConfig);

    expect(result.columns).toHaveLength(3);
    expect(result.columns[0]).toEqual({
      name: 'id',
      type: 'uuid',
      nullable: false,
      default: 'gen_random_uuid()',
      primaryKey: false,
    });
    expect(result.columns[1]).toEqual({
      name: 'email',
      type: 'varchar(255)',
      nullable: false,
      default: null,
      primaryKey: false,
    });
  });

  it('marks primary key columns with primaryKey: true', async () => {
    const mockResult: TableDescription = {
      table: 'users',
      schema: 'public',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()', primaryKey: true },
        { name: 'email', type: 'varchar(255)', nullable: false, default: null, primaryKey: false },
      ],
      indexes: [],
      foreignKeys: [],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'users' };
    const result = await describeTable(params, defaultConfig);

    expect(result.columns[0].primaryKey).toBe(true);
    expect(result.columns[1].primaryKey).toBe(false);
  });

  it('parses index metadata correctly (columns, unique, primary)', async () => {
    const mockResult: TableDescription = {
      table: 'users',
      schema: 'public',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, default: null, primaryKey: true },
        { name: 'email', type: 'varchar(255)', nullable: false, default: null, primaryKey: false },
      ],
      indexes: [
        { name: 'users_pkey', columns: ['id'], unique: true, primary: true },
        { name: 'users_email_idx', columns: ['email'], unique: true, primary: false },
        { name: 'users_name_idx', columns: ['first_name', 'last_name'], unique: false, primary: false },
      ],
      foreignKeys: [],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'users' };
    const result = await describeTable(params, defaultConfig);

    expect(result.indexes).toHaveLength(3);

    // Primary key index
    expect(result.indexes[0]).toEqual({
      name: 'users_pkey',
      columns: ['id'],
      unique: true,
      primary: true,
    });

    // Unique index (not primary)
    expect(result.indexes[1]).toEqual({
      name: 'users_email_idx',
      columns: ['email'],
      unique: true,
      primary: false,
    });

    // Non-unique multi-column index
    expect(result.indexes[2]).toEqual({
      name: 'users_name_idx',
      columns: ['first_name', 'last_name'],
      unique: false,
      primary: false,
    });
  });

  it('returns foreign key metadata correctly', async () => {
    const mockResult: TableDescription = {
      table: 'users',
      schema: 'public',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, default: null, primaryKey: true },
        { name: 'organization_id', type: 'uuid', nullable: false, default: null, primaryKey: false },
      ],
      indexes: [],
      foreignKeys: [
        { column: 'organization_id', references: { table: 'organizations', column: 'id' } },
      ],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'users' };
    const result = await describeTable(params, defaultConfig);

    expect(result.foreignKeys).toHaveLength(1);
    expect(result.foreignKeys[0]).toEqual({
      column: 'organization_id',
      references: {
        table: 'organizations',
        column: 'id',
      },
    });
  });

  it('uses "public" as default schema', async () => {
    const mockResult: TableDescription = {
      table: 'users',
      schema: 'public',
      columns: [],
      indexes: [],
      foreignKeys: [],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'users' };
    const result = await describeTable(params, defaultConfig);

    expect(result.schema).toBe('public');

    // Check that describeTable was called with 'public' as the schema parameter
    const withConnectionFn = mockAdapter.withConnection.mock.calls[0][0];
    const mockConn = {
      describeTable: vi.fn().mockResolvedValue(mockResult),
    };
    await withConnectionFn(mockConn);

    expect(mockConn.describeTable).toHaveBeenCalledWith('users', 'public', { maxColumns: 50, maxIndexes: 20 });
  });

  it('uses custom schema when provided', async () => {
    const mockResult: TableDescription = {
      table: 'users',
      schema: 'custom_schema',
      columns: [],
      indexes: [],
      foreignKeys: [],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = {
      database: 'testdb',
      table: 'users',
      schema: 'custom_schema',
    };
    const result = await describeTable(params, defaultConfig);

    expect(result.schema).toBe('custom_schema');

    // Check that describeTable was called with custom schema
    const withConnectionFn = mockAdapter.withConnection.mock.calls[0][0];
    const mockConn = {
      describeTable: vi.fn().mockResolvedValue(mockResult),
    };
    await withConnectionFn(mockConn);

    expect(mockConn.describeTable).toHaveBeenCalledWith('users', 'custom_schema', { maxColumns: 50, maxIndexes: 20 });
  });

  it('respects maxColumns limit', async () => {
    const manyColumns = Array.from({ length: 60 }, (_, i) => ({
      name: `col_${i}`,
      type: 'varchar(255)',
      nullable: true,
      default: null,
      primaryKey: false,
    }));

    // The adapter should return truncated results
    const mockResult: TableDescription = {
      table: 'wide_table',
      schema: 'public',
      columns: manyColumns.slice(0, 50),
      indexes: [],
      foreignKeys: [],
      truncated: true,
      truncationReason: 'columns (60 > 50)',
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'wide_table' };
    const result = await describeTable(params, defaultConfig);

    expect(result.columns).toHaveLength(50); // maxColumns default
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain('columns');
  });

  it('respects maxIndexes limit', async () => {
    const manyIndexes = Array.from({ length: 30 }, (_, i) => ({
      name: `idx_${i}`,
      columns: [`col_${i}`],
      unique: false,
      primary: false,
    }));

    // The adapter should return truncated results
    const mockResult: TableDescription = {
      table: 'indexed_table',
      schema: 'public',
      columns: [{ name: 'id', type: 'int', nullable: false, default: null, primaryKey: false }],
      indexes: manyIndexes.slice(0, 20),
      foreignKeys: [],
      truncated: true,
      truncationReason: 'indexes (30 > 20)',
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'indexed_table' };
    const result = await describeTable(params, defaultConfig);

    expect(result.indexes).toHaveLength(20); // maxIndexes default
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain('indexes');
  });

  it('sets truncated flag when multiple limits exceeded', async () => {
    const mockResult: TableDescription = {
      table: 'huge_table',
      schema: 'public',
      columns: Array.from({ length: 50 }, (_, i) => ({
        name: `col_${i}`,
        type: 'varchar(255)',
        nullable: true,
        default: null,
        primaryKey: false,
      })),
      indexes: Array.from({ length: 20 }, (_, i) => ({
        name: `idx_${i}`,
        columns: [`col_${i}`],
        unique: false,
        primary: false,
      })),
      foreignKeys: [],
      truncated: true,
      truncationReason: 'columns (60 > 50), indexes (30 > 20)',
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'huge_table' };
    const result = await describeTable(params, defaultConfig);

    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain('columns');
    expect(result.truncationReason).toContain('indexes');
  });

  it('does not set truncated flag when within limits', async () => {
    const mockResult: TableDescription = {
      table: 'users',
      schema: 'public',
      columns: [
        { name: 'id', type: 'uuid', nullable: false, default: null, primaryKey: true },
        { name: 'name', type: 'varchar(255)', nullable: true, default: null, primaryKey: false },
      ],
      indexes: [
        { name: 'users_pkey', columns: ['id'], unique: true, primary: true },
      ],
      foreignKeys: [],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'users' };
    const result = await describeTable(params, defaultConfig);

    expect(result.truncated).toBe(false);
    expect(result.truncationReason).toBeUndefined();
  });

  it('handles composite primary keys', async () => {
    const mockResult: TableDescription = {
      table: 'user_roles',
      schema: 'public',
      columns: [
        { name: 'user_id', type: 'uuid', nullable: false, default: null, primaryKey: true },
        { name: 'role_id', type: 'uuid', nullable: false, default: null, primaryKey: true },
        { name: 'granted_at', type: 'timestamptz', nullable: false, default: 'now()', primaryKey: false },
      ],
      indexes: [
        { name: 'user_roles_pkey', columns: ['user_id', 'role_id'], unique: true, primary: true },
      ],
      foreignKeys: [],
      truncated: false,
    };

    const mockAdapter = createMockAdapter(mockResult);
    mockCreateAdapter.mockReturnValue(mockAdapter);

    const params: DescribeTableParams = { database: 'testdb', table: 'user_roles' };
    const result = await describeTable(params, defaultConfig);

    expect(result.columns[0].primaryKey).toBe(true);
    expect(result.columns[1].primaryKey).toBe(true);
    expect(result.columns[2].primaryKey).toBe(false);

    expect(result.indexes[0].primary).toBe(true);
    expect(result.indexes[0].columns).toEqual(['user_id', 'role_id']);
  });

  describe('error handling', () => {
    describe('database not found', () => {
      it('should throw DATABASE_NOT_FOUND when database does not exist in config', async () => {
        const params: DescribeTableParams = {
          database: 'nonexistent_db',
          table: 'users',
        };

        await expect(describeTable(params, defaultConfig)).rejects.toThrow(DbMcpError);
        await expect(describeTable(params, defaultConfig)).rejects.toMatchObject({
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
          defaults: defaultConfig.defaults,
        };

        const params: DescribeTableParams = {
          database: 'unknown_db',
          table: 'users',
        };

        try {
          await describeTable(params, configWithMultipleDbs);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(DbMcpError);
          const dbError = error as DbMcpError;
          expect(dbError.code).toBe(ErrorCode.DATABASE_NOT_FOUND);
          expect(dbError.details?.available).toEqual(['production', 'staging', 'analytics']);
        }
      });
    });

    describe('table not found', () => {
      it('should propagate error when describing non-existent table', async () => {
        const mockAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async (fn) => {
            const mockConn = {
              query: vi.fn(),
              execute: vi.fn(),
              listTables: vi.fn(),
              describeTable: vi.fn().mockImplementation(async () => {
                throw new Error('relation "nonexistent_table" does not exist');
              }),
            };
            return fn(mockConn);
          }),
          getDialect: vi.fn(),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        const params: DescribeTableParams = {
          database: 'testdb',
          table: 'nonexistent_table',
        };

        await expect(describeTable(params, defaultConfig)).rejects.toThrow(
          'relation "nonexistent_table" does not exist'
        );
      });

      it('should propagate error for table in non-existent schema', async () => {
        const mockAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async (fn) => {
            const mockConn = {
              query: vi.fn(),
              execute: vi.fn(),
              listTables: vi.fn(),
              describeTable: vi.fn().mockImplementation(async () => {
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

        const params: DescribeTableParams = {
          database: 'testdb',
          table: 'users',
          schema: 'nonexistent_schema',
        };

        await expect(describeTable(params, defaultConfig)).rejects.toThrow(
          'schema "nonexistent_schema" does not exist'
        );
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

        const params: DescribeTableParams = {
          database: 'testdb',
          table: 'users',
        };

        await expect(describeTable(params, defaultConfig)).rejects.toThrow(DbMcpError);
        await expect(describeTable(params, defaultConfig)).rejects.toMatchObject({
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

        const params: DescribeTableParams = {
          database: 'testdb',
          table: 'users',
        };

        await expect(describeTable(params, defaultConfig)).rejects.toThrow(DbMcpError);
        await expect(describeTable(params, defaultConfig)).rejects.toMatchObject({
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

        const params: DescribeTableParams = {
          database: 'testdb',
          table: 'users',
        };

        await expect(describeTable(params, defaultConfig)).rejects.toThrow(
          'password authentication failed'
        );
      });
    });

    describe('permission errors', () => {
      it('should propagate permission denied errors', async () => {
        const mockAdapter = {
          type: 'postgresql' as const,
          withConnection: vi.fn().mockImplementation(async (fn) => {
            const mockConn = {
              query: vi.fn(),
              execute: vi.fn(),
              listTables: vi.fn(),
              describeTable: vi.fn().mockImplementation(async () => {
                throw new Error('permission denied for table users');
              }),
            };
            return fn(mockConn);
          }),
          getDialect: vi.fn(),
          getDefaultSchema: vi.fn().mockReturnValue('public'),
          dispose: vi.fn(),
        };
        mockCreateAdapter.mockReturnValue(mockAdapter);

        const params: DescribeTableParams = {
          database: 'testdb',
          table: 'users',
        };

        await expect(describeTable(params, defaultConfig)).rejects.toThrow(
          'permission denied for table users'
        );
      });
    });
  });
});
