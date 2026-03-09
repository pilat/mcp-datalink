/**
 * Integration tests for list_tables tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { listTables } from '../tools/list-tables.js';
import { createTestConfig, seedTestData } from './helpers.js';

describe('list_tables integration', () => {
  beforeEach(async () => {
    await seedTestData();
  });

  it('lists tables in public schema', async () => {
    const config = createTestConfig();
    const result = await listTables({ database: 'testdb' }, config);

    const tableNames = result.tables.map((t) => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('order_items');
  });

  it('lists views with correct type', async () => {
    const config = createTestConfig();
    const result = await listTables({ database: 'testdb' }, config);

    const view = result.tables.find((t) => t.name === 'user_order_summary');
    expect(view).toBeDefined();
    expect(view?.type).toBe('view');
  });

  it('returns row estimates for tables', async () => {
    const config = createTestConfig();
    const result = await listTables({ database: 'testdb' }, config);

    const usersTable = result.tables.find((t) => t.name === 'users');
    expect(usersTable).toBeDefined();
    // After ANALYZE, row estimate should be close to actual (3 users)
    expect(typeof usersTable?.rows_estimate).toBe('number');
  });

  it('supports custom schema', async () => {
    const config = createTestConfig();
    const result = await listTables({ database: 'testdb', schema: 'test_schema' }, config);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].name).toBe('special_table');
    expect(result.tables[0].schema).toBe('test_schema');
  });

  it('returns empty for non-existent schema', async () => {
    const config = createTestConfig();
    const result = await listTables({ database: 'testdb', schema: 'nonexistent' }, config);

    expect(result.tables).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it('truncates at maxTables limit', async () => {
    const config = createTestConfig({
      defaults: {
        maxRows: 100,
        maxTotalSize: 65536,
        maxColumns: 50,
        maxTables: 3,
        maxIndexes: 20,
        timeout: 30000,
      },
    });
    const result = await listTables({ database: 'testdb' }, config);

    expect(result.tables.length).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.totalAvailable).toBeGreaterThan(3);
  });

  it('shows correct schema for each table', async () => {
    const config = createTestConfig();
    const result = await listTables({ database: 'testdb' }, config);

    for (const table of result.tables) {
      expect(table.schema).toBe('public');
    }
  });
});
