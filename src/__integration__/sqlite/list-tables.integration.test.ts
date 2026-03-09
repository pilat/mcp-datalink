/**
 * Integration tests for list_tables tool with SQLite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { listTables } from '../../tools/list-tables.js';
import { createSqliteTestConfig, seedSqliteTestData } from '../helpers.js';

describe('list_tables SQLite integration', () => {
  beforeEach(async () => {
    await seedSqliteTestData();
  });

  it('lists tables in database', async () => {
    const config = createSqliteTestConfig();
    const result = await listTables({ database: 'sqlitedb' }, config);

    const tableNames = result.tables.map((t) => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('order_items');
  });

  it('lists views with correct type', async () => {
    const config = createSqliteTestConfig();
    const result = await listTables({ database: 'sqlitedb' }, config);

    const view = result.tables.find((t) => t.name === 'user_order_summary');
    expect(view).toBeDefined();
    expect(view?.type).toBe('view');
  });

  it('returns null for row estimates (SQLite does not have stats)', async () => {
    const config = createSqliteTestConfig();
    const result = await listTables({ database: 'sqlitedb' }, config);

    const usersTable = result.tables.find((t) => t.name === 'users');
    expect(usersTable).toBeDefined();
    // SQLite doesn't have row statistics
    expect(usersTable?.rows_estimate).toBeNull();
  });

  it('always uses "main" schema for SQLite', async () => {
    const config = createSqliteTestConfig();
    const result = await listTables({ database: 'sqlitedb' }, config);

    // All tables should have schema = 'main'
    for (const table of result.tables) {
      expect(table.schema).toBe('main');
    }
  });

  it('ignores schema parameter (SQLite has single namespace)', async () => {
    const config = createSqliteTestConfig();
    // SQLite ignores schema parameter - always returns tables from "main"
    const result = await listTables({ database: 'sqlitedb', schema: 'nonexistent' }, config);

    // Should still return tables (schema is ignored)
    const tableNames = result.tables.map((t) => t.name);
    expect(tableNames).toContain('users');
  });

  it('truncates at maxTables limit', async () => {
    const config = createSqliteTestConfig({
      defaults: {
        maxRows: 100,
        maxTotalSize: 65536,
        maxColumns: 50,
        maxTables: 3,
        maxIndexes: 20,
        timeout: 30000,
      },
    });
    const result = await listTables({ database: 'sqlitedb' }, config);

    expect(result.tables.length).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.totalAvailable).toBeGreaterThan(3);
  });

  it('excludes sqlite_ internal tables', async () => {
    const config = createSqliteTestConfig();
    const result = await listTables({ database: 'sqlitedb' }, config);

    const tableNames = result.tables.map((t) => t.name);
    // SQLite internal tables should not be listed
    expect(tableNames.some((name) => name.startsWith('sqlite_'))).toBe(false);
  });
});
