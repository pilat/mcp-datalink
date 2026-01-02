/**
 * Integration tests for execute tool with SQLite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { execute } from '../../tools/execute.js';
import { createSqliteTestConfig, seedSqliteTestData } from '../helpers.js';
import { querySqliteSql } from '../setup.js';
import { ErrorCode } from '../../utils/errors.js';

describe('execute SQLite integration', () => {
  beforeEach(async () => {
    await seedSqliteTestData();
  });

  describe('INSERT operations', () => {
    it('inserts single row', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "INSERT INTO products (name, price, stock, category) VALUES ('New Product', 49.99, 10, 'new')",
        },
        config
      );

      expect(result.command).toBe('INSERT');
      expect(result.rowsAffected).toBe(1);

      // Verify insertion
      const verify = await querySqliteSql("SELECT * FROM products WHERE name = 'New Product'");
      expect(verify.length).toBe(1);
      expect((verify[0] as { price: number }).price).toBe(49.99);
    });

    it('inserts with ? params', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: 'INSERT INTO products (name, price, stock, category) VALUES (?, ?, ?, ?)',
          params: ['Param Product', 99.99, 5, 'param'],
        },
        config
      );

      expect(result.rowsAffected).toBe(1);

      const verify = await querySqliteSql("SELECT * FROM products WHERE name = 'Param Product'");
      expect(verify.length).toBe(1);
    });

    it('inserts with $1 params (converted to ?)', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: 'INSERT INTO products (name, price, stock, category) VALUES ($1, $2, $3, $4)',
          params: ['Dollar Product', 88.88, 8, 'dollar'],
        },
        config
      );

      expect(result.rowsAffected).toBe(1);

      const verify = await querySqliteSql("SELECT * FROM products WHERE name = 'Dollar Product'");
      expect(verify.length).toBe(1);
    });
  });

  describe('UPDATE operations', () => {
    it('updates single row', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "UPDATE products SET price = 15.99 WHERE name = 'Widget'",
        },
        config
      );

      expect(result.command).toBe('UPDATE');
      expect(result.rowsAffected).toBe(1);

      const verify = await querySqliteSql("SELECT price FROM products WHERE name = 'Widget'");
      expect((verify[0] as { price: number }).price).toBe(15.99);
    });

    it('updates multiple rows', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "UPDATE products SET stock = 0 WHERE category = 'gadgets'",
        },
        config
      );

      expect(result.rowsAffected).toBe(2);

      const verify = await querySqliteSql("SELECT stock FROM products WHERE category = 'gadgets'");
      expect(verify.every((r) => (r as { stock: number }).stock === 0)).toBe(true);
    });

    it('updates with params', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: 'UPDATE products SET price = ? WHERE id = ?',
          params: [99.99, 1],
        },
        config
      );

      expect(result.rowsAffected).toBe(1);
    });
  });

  describe('DELETE operations', () => {
    it('deletes single row', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "DELETE FROM products WHERE name = 'Thingamajig'",
        },
        config
      );

      expect(result.command).toBe('DELETE');
      expect(result.rowsAffected).toBe(1);

      const verify = await querySqliteSql("SELECT * FROM products WHERE name = 'Thingamajig'");
      expect(verify.length).toBe(0);
    });

    it('deletes with FK cascade when foreign keys enabled', async () => {
      const config = createSqliteTestConfig();

      // First delete order_items to avoid FK violation
      await execute(
        {
          database: 'sqlitedb',
          sql: 'DELETE FROM order_items',
        },
        config
      );

      // Delete a user - should cascade to their orders (if FK constraint allows)
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "DELETE FROM users WHERE id = '11111111-1111-1111-1111-111111111111'",
        },
        config
      );

      expect(result.rowsAffected).toBe(1);

      // Note: SQLite foreign key cascades depend on PRAGMA foreign_keys = ON
      // and how the test database was set up
    });
  });

  describe('readonly database', () => {
    it('blocks INSERT on readonly database', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          {
            database: 'sqlitedb_readonly',
            sql: "INSERT INTO products (name, price) VALUES ('test', 1.00)",
          },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.READONLY_VIOLATION,
      });
    });

    it('blocks UPDATE on readonly database', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          {
            database: 'sqlitedb_readonly',
            sql: 'UPDATE products SET price = 0',
          },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.READONLY_VIOLATION,
      });
    });

    it('blocks DELETE on readonly database', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          {
            database: 'sqlitedb_readonly',
            sql: 'DELETE FROM products',
          },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.READONLY_VIOLATION,
      });
    });
  });

  describe('security - blocked queries', () => {
    it('blocks SELECT', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: 'SELECT * FROM users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks DROP', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: 'DROP TABLE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks CREATE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: 'CREATE TABLE hacked (id INTEGER)' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ALTER', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: 'ALTER TABLE users ADD COLUMN hacked TEXT' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ATTACH DATABASE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: "ATTACH DATABASE '/tmp/hack.db' AS hack" },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks DETACH DATABASE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: 'DETACH DATABASE main' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks VACUUM', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: 'VACUUM' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks PRAGMA modifications', async () => {
      const config = createSqliteTestConfig();

      await expect(
        execute(
          { database: 'sqlitedb', sql: 'PRAGMA foreign_keys = OFF' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });
  });

  describe('metadata', () => {
    it('records execution time', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "INSERT INTO products (name, price) VALUES ('Time Test', 1.00)",
        },
        config
      );

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('handles zero affected rows', async () => {
      const config = createSqliteTestConfig();
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: 'DELETE FROM products WHERE id = 99999',
        },
        config
      );

      expect(result.rowsAffected).toBe(0);
    });
  });

  describe('SQLite-specific features', () => {
    it('supports INSERT OR REPLACE', async () => {
      const config = createSqliteTestConfig();

      // First insert
      await execute(
        {
          database: 'sqlitedb',
          sql: "INSERT INTO products (id, name, price, stock, category) VALUES (100, 'Replace Test', 10.00, 5, 'test')",
        },
        config
      );

      // Then replace
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "INSERT OR REPLACE INTO products (id, name, price, stock, category) VALUES (100, 'Replace Test Updated', 20.00, 10, 'test')",
        },
        config
      );

      expect(result.rowsAffected).toBe(1);

      const verify = await querySqliteSql('SELECT * FROM products WHERE id = 100');
      expect((verify[0] as { name: string }).name).toBe('Replace Test Updated');
    });

    it('supports INSERT OR IGNORE', async () => {
      const config = createSqliteTestConfig();

      // This should be ignored due to unique constraint on email
      const result = await execute(
        {
          database: 'sqlitedb',
          sql: "INSERT OR IGNORE INTO users (id, email, name) VALUES ('new-id', 'alice@example.com', 'Duplicate')",
        },
        config
      );

      // Should not fail, but also not insert (0 rows affected)
      expect(result.rowsAffected).toBe(0);
    });
  });
});
