/**
 * Integration tests for execute tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { execute } from '../tools/execute.js';
import { createTestConfig, seedTestData } from './helpers.js';
import { execSql } from './setup.js';
import { ErrorCode } from '../utils/errors.js';

describe('execute integration', () => {
  beforeEach(async () => {
    await seedTestData();
  });

  describe('INSERT operations', () => {
    it('inserts single row', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: "INSERT INTO products (name, price, stock, category) VALUES ('New Product', 49.99, 10, 'new')",
        },
        config
      );

      expect(result.command).toBe('INSERT');
      expect(result.rowsAffected).toBe(1);

      // Verify insertion
      const verify = await execSql("SELECT * FROM products WHERE name = 'New Product'");
      expect(verify.rows.length).toBe(1);
      expect(verify.rows[0].price).toBe('49.99');
    });

    it('inserts with params', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: 'INSERT INTO products (name, price, stock, category) VALUES ($1, $2, $3, $4)',
          params: ['Param Product', 99.99, 5, 'param'],
        },
        config
      );

      expect(result.rowsAffected).toBe(1);

      const verify = await execSql("SELECT * FROM products WHERE name = 'Param Product'");
      expect(verify.rows.length).toBe(1);
    });
  });

  describe('UPDATE operations', () => {
    it('updates single row', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: "UPDATE products SET price = 15.99 WHERE name = 'Widget'",
        },
        config
      );

      expect(result.command).toBe('UPDATE');
      expect(result.rowsAffected).toBe(1);

      const verify = await execSql("SELECT price FROM products WHERE name = 'Widget'");
      expect(verify.rows[0].price).toBe('15.99');
    });

    it('updates multiple rows', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: "UPDATE products SET stock = 0 WHERE category = 'gadgets'",
        },
        config
      );

      expect(result.rowsAffected).toBe(2);

      const verify = await execSql("SELECT stock FROM products WHERE category = 'gadgets'");
      expect(verify.rows.every((r) => r.stock === 0)).toBe(true);
    });

    it('updates with params', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: 'UPDATE products SET price = $1 WHERE id = $2',
          params: [99.99, 1],
        },
        config
      );

      expect(result.rowsAffected).toBe(1);
    });
  });

  describe('DELETE operations', () => {
    it('deletes single row', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: "DELETE FROM products WHERE name = 'Thingamajig'",
        },
        config
      );

      expect(result.command).toBe('DELETE');
      expect(result.rowsAffected).toBe(1);

      const verify = await execSql("SELECT * FROM products WHERE name = 'Thingamajig'");
      expect(verify.rows.length).toBe(0);
    });

    it('deletes with FK cascade', async () => {
      const config = createTestConfig();

      // First delete order_items to avoid FK violation when orders are cascade-deleted
      // Use execute tool to ensure same connection handling pattern
      await execute(
        {
          database: 'testdb',
          sql: 'DELETE FROM order_items WHERE 1=1',
        },
        config
      );

      // Delete a user should cascade to their orders
      const result = await execute(
        {
          database: 'testdb',
          sql: "DELETE FROM users WHERE id = '11111111-1111-1111-1111-111111111111'",
        },
        config
      );

      expect(result.rowsAffected).toBe(1);

      // Verify orders are also deleted (CASCADE from users to orders)
      const verify = await execSql(
        "SELECT * FROM orders WHERE user_id = '11111111-1111-1111-1111-111111111111'"
      );
      expect(verify.rows.length).toBe(0);
    });
  });

  describe('readonly database', () => {
    it('blocks INSERT on readonly database', async () => {
      const config = createTestConfig();

      await expect(
        execute(
          {
            database: 'readonlydb',
            sql: "INSERT INTO products (name, price) VALUES ('test', 1.00)",
          },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.READONLY_VIOLATION,
      });
    });

    it('blocks UPDATE on readonly database', async () => {
      const config = createTestConfig();

      await expect(
        execute(
          {
            database: 'readonlydb',
            sql: 'UPDATE products SET price = 0',
          },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.READONLY_VIOLATION,
      });
    });

    it('blocks DELETE on readonly database', async () => {
      const config = createTestConfig();

      await expect(
        execute(
          {
            database: 'readonlydb',
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
      const config = createTestConfig();

      await expect(
        execute(
          { database: 'testdb', sql: 'SELECT * FROM users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks DROP', async () => {
      const config = createTestConfig();

      await expect(
        execute(
          { database: 'testdb', sql: 'DROP TABLE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks CREATE', async () => {
      const config = createTestConfig();

      await expect(
        execute(
          { database: 'testdb', sql: 'CREATE TABLE hacked (id INT)' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ALTER', async () => {
      const config = createTestConfig();

      await expect(
        execute(
          { database: 'testdb', sql: 'ALTER TABLE users ADD COLUMN hacked TEXT' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks TRUNCATE', async () => {
      const config = createTestConfig();

      await expect(
        execute(
          { database: 'testdb', sql: 'TRUNCATE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });
  });

  describe('metadata', () => {
    it('records execution time', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: "INSERT INTO products (name, price) VALUES ('Time Test', 1.00)",
        },
        config
      );

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('handles zero affected rows', async () => {
      const config = createTestConfig();
      const result = await execute(
        {
          database: 'testdb',
          sql: 'DELETE FROM products WHERE id = 99999',
        },
        config
      );

      expect(result.rowsAffected).toBe(0);
    });
  });
});
