/**
 * Integration tests for list_tables tool (MySQL)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { listTables } from '../../tools/list-tables.js';
import { createMySqlTestConfig, seedMySqlTestData } from '../helpers.js';

describe('list_tables integration (MySQL)', () => {
  beforeEach(async () => {
    await seedMySqlTestData();
  });

  it('lists tables in database', async () => {
    const config = createMySqlTestConfig();
    const result = await listTables({ database: 'mysqldb' }, config);

    const tableNames = result.tables.map((t) => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('order_items');
  });

  it('lists views with correct type', async () => {
    const config = createMySqlTestConfig();
    const result = await listTables({ database: 'mysqldb' }, config);

    const view = result.tables.find((t) => t.name === 'user_order_summary');
    expect(view).toBeDefined();
    expect(view?.type).toBe('view');
  });

  it('returns row estimates for tables', async () => {
    const config = createMySqlTestConfig();
    const result = await listTables({ database: 'mysqldb' }, config);

    const usersTable = result.tables.find((t) => t.name === 'users');
    expect(usersTable).toBeDefined();
    // MySQL row estimates come from information_schema.TABLES.TABLE_ROWS
    expect(typeof usersTable?.rows_estimate).toBe('number');
  });

  it('uses test_db as default schema for MySQL', async () => {
    const config = createMySqlTestConfig();
    const result = await listTables({ database: 'mysqldb' }, config);

    // All tables should be in test_db schema (which is the database name in MySQL)
    for (const table of result.tables) {
      expect(table.schema).toBe('test_db');
    }
  });

  it('truncates at maxTables limit', async () => {
    const config = createMySqlTestConfig({
      defaults: {
        maxRows: 100,
        maxTotalSize: 65536,
        maxColumns: 50,
        maxTables: 3,
        maxIndexes: 20,
        timeout: 30000,
      },
    });
    const result = await listTables({ database: 'mysqldb' }, config);

    expect(result.tables.length).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.totalAvailable).toBeGreaterThan(3);
  });

  it('returns empty for non-existent schema', async () => {
    const config = createMySqlTestConfig();
    const result = await listTables({ database: 'mysqldb', schema: 'nonexistent_schema' }, config);

    expect(result.tables).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});
