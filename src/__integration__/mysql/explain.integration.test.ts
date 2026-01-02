/**
 * Integration tests for explain tool (MySQL)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { explain } from '../../tools/explain.js';
import { createMySqlTestConfig, seedMySqlTestData } from '../helpers.js';
import { ErrorCode } from '../../utils/errors.js';

describe('explain integration (MySQL)', () => {
  beforeEach(async () => {
    await seedMySqlTestData();
  });

  describe('EXPLAIN without ANALYZE', () => {
    it('explains SELECT query', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        { database: 'mysqldb', sql: 'SELECT * FROM users' },
        config
      );

      // MySQL EXPLAIN output contains table info
      expect(result.plan).toContain('users');
    });

    it('explains SELECT with WHERE', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        { database: 'mysqldb', sql: "SELECT * FROM users WHERE email = 'alice@example.com'" },
        config
      );

      // Should show some type of access method
      expect(result.plan.length).toBeGreaterThan(0);
    });

    it('explains JOIN query', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        {
          database: 'mysqldb',
          sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
        },
        config
      );

      // MySQL EXPLAIN shows table aliases (u, o) not full names
      // The plan should contain meaningful output with multiple rows for the join
      const lines = result.plan.split('\n').filter((line) => line.trim());
      expect(lines.length).toBeGreaterThanOrEqual(2); // One row per table in join

      // Should reference the table aliases or related index/column info
      // MySQL output includes: aliases (u, o), indexes (orders_user_id_idx), refs (test_db.o.user_id)
      expect(result.plan).toMatch(/\bu\b|\borders\b|user/i);
      expect(result.plan).toMatch(/\bo\b|\borders\b|order/i);
    });

    it('explains INSERT query', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        {
          database: 'mysqldb',
          sql: "INSERT INTO products (name, price) VALUES ('Test', 1.00)",
        },
        config
      );

      expect(result.plan).toContain('products');
    });

    it('explains UPDATE query', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        {
          database: 'mysqldb',
          sql: 'UPDATE products SET price = 0 WHERE id = 1',
        },
        config
      );

      expect(result.plan).toContain('products');
    });

    it('explains DELETE query', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        {
          database: 'mysqldb',
          sql: 'DELETE FROM products WHERE id = 1',
        },
        config
      );

      expect(result.plan).toContain('products');
    });
  });

  describe('EXPLAIN ANALYZE', () => {
    it('includes actual execution stats', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        { database: 'mysqldb', sql: 'SELECT * FROM users', analyze: true },
        config
      );

      // MySQL EXPLAIN ANALYZE adds actual time info
      expect(result.plan).toMatch(/actual time/i);
    });

    it('shows execution time details', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        { database: 'mysqldb', sql: 'SELECT * FROM users', analyze: true },
        config
      );

      // EXPLAIN ANALYZE includes timing information
      expect(result.plan).toMatch(/rows/i);
    });
  });

  describe('security - blocked queries', () => {
    it('blocks DROP TABLE', async () => {
      const config = createMySqlTestConfig();

      await expect(
        explain(
          { database: 'mysqldb', sql: 'DROP TABLE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks TRUNCATE', async () => {
      const config = createMySqlTestConfig();

      await expect(
        explain(
          { database: 'mysqldb', sql: 'TRUNCATE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ALTER TABLE', async () => {
      const config = createMySqlTestConfig();

      await expect(
        explain(
          { database: 'mysqldb', sql: 'ALTER TABLE users ADD COLUMN hacked TEXT' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks CREATE TABLE', async () => {
      const config = createMySqlTestConfig();

      await expect(
        explain(
          { database: 'mysqldb', sql: 'CREATE TABLE hacked (id INT)' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks LOAD DATA', async () => {
      const config = createMySqlTestConfig();

      await expect(
        explain(
          { database: 'mysqldb', sql: "LOAD DATA INFILE '/tmp/data.txt' INTO TABLE users" },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });
  });

  describe('metadata', () => {
    it('records execution time', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        { database: 'mysqldb', sql: 'SELECT * FROM users' },
        config
      );

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('returns multi-line plan for complex queries', async () => {
      const config = createMySqlTestConfig();
      const result = await explain(
        {
          database: 'mysqldb',
          sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
        },
        config
      );

      const lines = result.plan.split('\n');
      expect(lines.length).toBeGreaterThan(1);
    });
  });
});
