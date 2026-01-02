/**
 * Integration tests for describe_table tool with SQLite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { describeTable } from '../../tools/describe-table.js';
import { createSqliteTestConfig, seedSqliteTestData } from '../helpers.js';

describe('describe_table SQLite integration', () => {
  beforeEach(async () => {
    await seedSqliteTestData();
  });

  it('returns all columns for users table', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    expect(result.columns.length).toBe(9);
    const columnNames = result.columns.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('email');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('age');
    expect(columnNames).toContain('balance');
    expect(columnNames).toContain('metadata');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
    expect(columnNames).toContain('is_active');
  });

  it('returns SQLite column types', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    const idCol = result.columns.find((c) => c.name === 'id');
    const emailCol = result.columns.find((c) => c.name === 'email');
    const ageCol = result.columns.find((c) => c.name === 'age');
    const balanceCol = result.columns.find((c) => c.name === 'balance');

    // SQLite uses TEXT, INTEGER, REAL, BLOB
    expect(idCol?.type).toBe('TEXT');
    expect(emailCol?.type).toBe('TEXT');
    expect(ageCol?.type).toBe('INTEGER');
    expect(balanceCol?.type).toBe('REAL');
  });

  it('returns correct nullable flags', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    const emailCol = result.columns.find((c) => c.name === 'email');
    const nameCol = result.columns.find((c) => c.name === 'name');

    expect(emailCol?.nullable).toBe(false); // NOT NULL
    expect(nameCol?.nullable).toBe(true); // nullable
  });

  it('detects primary key', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    const idCol = result.columns.find((c) => c.name === 'id');
    const emailCol = result.columns.find((c) => c.name === 'email');

    expect(idCol?.primaryKey).toBe(true);
    expect(emailCol?.primaryKey).toBe(false);
  });

  it('detects composite primary key', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'order_items' }, config);

    const orderIdCol = result.columns.find((c) => c.name === 'order_id');
    const productIdCol = result.columns.find((c) => c.name === 'product_id');
    const quantityCol = result.columns.find((c) => c.name === 'quantity');

    expect(orderIdCol?.primaryKey).toBe(true);
    expect(productIdCol?.primaryKey).toBe(true);
    expect(quantityCol?.primaryKey).toBe(false);
  });

  it('returns indexes', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    expect(result.indexes.length).toBeGreaterThan(0);
    const indexNames = result.indexes.map((i) => i.name);
    expect(indexNames).toContain('users_created_at_idx');
    expect(indexNames).toContain('users_name_email_idx');
  });

  it('detects unique indexes', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    // SQLite creates automatic unique index for UNIQUE constraint on email
    const emailIndex = result.indexes.find((i) => i.columns.includes('email') && i.columns.length === 1);
    const createdAtIndex = result.indexes.find((i) => i.name === 'users_created_at_idx');

    expect(emailIndex?.unique).toBe(true);
    expect(createdAtIndex?.unique).toBe(false);
  });

  it('detects multi-column indexes', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    const multiColIndex = result.indexes.find((i) => i.name === 'users_name_email_idx');
    expect(multiColIndex).toBeDefined();
    expect(multiColIndex?.columns).toContain('name');
    expect(multiColIndex?.columns).toContain('email');
  });

  it('returns foreign keys', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'orders' }, config);

    expect(result.foreignKeys.length).toBeGreaterThan(0);
    const userFk = result.foreignKeys.find((fk) => fk.column === 'user_id');
    expect(userFk).toBeDefined();
    expect(userFk?.references.table).toBe('users');
    expect(userFk?.references.column).toBe('id');
  });

  it('always uses "main" schema for SQLite', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'users' }, config);

    expect(result.table).toBe('users');
    expect(result.schema).toBe('main'); // SQLite always uses "main"
  });

  it('ignores schema parameter (SQLite has single namespace)', async () => {
    const config = createSqliteTestConfig();
    // SQLite ignores schema parameter
    const result = await describeTable(
      { database: 'sqlitedb', table: 'users', schema: 'nonexistent' },
      config
    );

    // Should still return users table (schema is ignored)
    expect(result.table).toBe('users');
    expect(result.schema).toBe('main');
    expect(result.columns.length).toBe(9);
  });

  it('truncates columns at maxColumns limit', async () => {
    const config = createSqliteTestConfig({
      defaults: {
        maxRows: 100,
        maxCellLength: 500,
        maxTotalSize: 65536,
        maxColumns: 10,
        maxTables: 200,
        maxIndexes: 20,
        timeout: 30000,
      },
    });
    const result = await describeTable({ database: 'sqlitedb', table: 'wide_table' }, config);

    expect(result.columns.length).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain('columns');
  });

  it('handles INTEGER PRIMARY KEY AUTOINCREMENT', async () => {
    const config = createSqliteTestConfig();
    const result = await describeTable({ database: 'sqlitedb', table: 'products' }, config);

    const idCol = result.columns.find((c) => c.name === 'id');
    expect(idCol?.type).toBe('INTEGER');
    expect(idCol?.primaryKey).toBe(true);
  });
});
