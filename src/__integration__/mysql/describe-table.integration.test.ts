/**
 * Integration tests for describe_table tool (MySQL)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { describeTable } from '../../tools/describe-table.js';
import { createMySqlTestConfig, seedMySqlTestData } from '../helpers.js';

describe('describe_table integration (MySQL)', () => {
  beforeEach(async () => {
    await seedMySqlTestData();
  });

  it('returns all columns for users table', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'users' }, config);

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

  it('returns accurate column types', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'users' }, config);

    const idCol = result.columns.find((c) => c.name === 'id');
    const emailCol = result.columns.find((c) => c.name === 'email');
    const ageCol = result.columns.find((c) => c.name === 'age');
    const metadataCol = result.columns.find((c) => c.name === 'metadata');

    expect(idCol?.type).toMatch(/char/i);
    expect(emailCol?.type).toMatch(/varchar/i);
    expect(ageCol?.type).toMatch(/int/i);
    expect(metadataCol?.type).toMatch(/json/i);
  });

  it('returns correct nullable flags', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'users' }, config);

    const emailCol = result.columns.find((c) => c.name === 'email');
    const nameCol = result.columns.find((c) => c.name === 'name');

    expect(emailCol?.nullable).toBe(false);
    expect(nameCol?.nullable).toBe(true);
  });

  it('detects primary key', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'users' }, config);

    const idCol = result.columns.find((c) => c.name === 'id');
    const emailCol = result.columns.find((c) => c.name === 'email');

    expect(idCol?.primaryKey).toBe(true);
    expect(emailCol?.primaryKey).toBe(false);
  });

  it('detects composite primary key', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'order_items' }, config);

    const orderIdCol = result.columns.find((c) => c.name === 'order_id');
    const productIdCol = result.columns.find((c) => c.name === 'product_id');
    const quantityCol = result.columns.find((c) => c.name === 'quantity');

    expect(orderIdCol?.primaryKey).toBe(true);
    expect(productIdCol?.primaryKey).toBe(true);
    expect(quantityCol?.primaryKey).toBe(false);
  });

  it('returns indexes', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'users' }, config);

    expect(result.indexes.length).toBeGreaterThan(0);
    const indexNames = result.indexes.map((i) => i.name);
    expect(indexNames).toContain('PRIMARY');
    expect(indexNames).toContain('email');
    expect(indexNames).toContain('users_created_at_idx');
  });

  it('detects unique indexes', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'users' }, config);

    const emailIndex = result.indexes.find((i) => i.name === 'email');
    const createdAtIndex = result.indexes.find((i) => i.name === 'users_created_at_idx');

    expect(emailIndex?.unique).toBe(true);
    expect(createdAtIndex?.unique).toBe(false);
  });

  it('detects multi-column indexes', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'users' }, config);

    const multiColIndex = result.indexes.find((i) => i.name === 'users_name_email_idx');
    expect(multiColIndex).toBeDefined();
    expect(multiColIndex?.columns).toContain('name');
    expect(multiColIndex?.columns).toContain('email');
  });

  it('returns foreign keys', async () => {
    const config = createMySqlTestConfig();
    const result = await describeTable({ database: 'mysqldb', table: 'orders' }, config);

    expect(result.foreignKeys.length).toBeGreaterThan(0);
    const userFk = result.foreignKeys.find((fk) => fk.column === 'user_id');
    expect(userFk).toBeDefined();
    expect(userFk?.references.table).toBe('users');
    expect(userFk?.references.column).toBe('id');
  });

  it('truncates columns at maxColumns limit', async () => {
    const config = createMySqlTestConfig({
      defaults: {
        maxRows: 100,
        maxTotalSize: 65536,
        maxColumns: 10,
        maxTables: 200,
        maxIndexes: 20,
        timeout: 30000,
      },
    });
    const result = await describeTable({ database: 'mysqldb', table: 'wide_table' }, config);

    expect(result.columns.length).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain('columns');
  });
});
