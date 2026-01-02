/**
 * Integration tests for explain tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { explain } from '../tools/explain.js';
import { createTestConfig, seedTestData } from './helpers.js';
import { ErrorCode } from '../utils/errors.js';

describe('explain integration', () => {
  beforeEach(async () => {
    await seedTestData();
  });

  describe('EXPLAIN without ANALYZE', () => {
    it('explains SELECT query', async () => {
      const config = createTestConfig();
      const result = await explain(
        { database: 'testdb', sql: 'SELECT * FROM users' },
        config
      );

      expect(result.plan).toContain('Seq Scan');
      expect(result.plan).toContain('users');
    });

    it('explains SELECT with WHERE', async () => {
      const config = createTestConfig();
      const result = await explain(
        { database: 'testdb', sql: "SELECT * FROM users WHERE email = 'alice@example.com'" },
        config
      );

      expect(result.plan).toContain('Filter');
    });

    it('explains JOIN query', async () => {
      const config = createTestConfig();
      const result = await explain(
        {
          database: 'testdb',
          sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
        },
        config
      );

      // Should show some kind of join in the plan
      expect(result.plan.toLowerCase()).toMatch(/join|nested loop/);
    });

    it('explains INSERT query', async () => {
      const config = createTestConfig();
      const result = await explain(
        {
          database: 'testdb',
          sql: "INSERT INTO products (name, price) VALUES ('Test', 1.00)",
        },
        config
      );

      expect(result.plan).toContain('Insert');
    });

    it('explains UPDATE query', async () => {
      const config = createTestConfig();
      const result = await explain(
        {
          database: 'testdb',
          sql: 'UPDATE products SET price = 0 WHERE id = 1',
        },
        config
      );

      expect(result.plan).toContain('Update');
    });

    it('explains DELETE query', async () => {
      const config = createTestConfig();
      const result = await explain(
        {
          database: 'testdb',
          sql: 'DELETE FROM products WHERE id = 1',
        },
        config
      );

      expect(result.plan).toContain('Delete');
    });
  });

  describe('EXPLAIN ANALYZE', () => {
    it('includes actual execution stats', async () => {
      const config = createTestConfig();
      const result = await explain(
        { database: 'testdb', sql: 'SELECT * FROM users', analyze: true },
        config
      );

      // ANALYZE adds actual time and row counts
      expect(result.plan).toMatch(/actual time/i);
      expect(result.plan).toMatch(/rows=/i);
    });

    it('shows planning and execution time', async () => {
      const config = createTestConfig();
      const result = await explain(
        { database: 'testdb', sql: 'SELECT * FROM users', analyze: true },
        config
      );

      expect(result.plan).toMatch(/Planning Time/i);
      expect(result.plan).toMatch(/Execution Time/i);
    });
  });

  describe('security - blocked queries', () => {
    it('blocks DROP TABLE', async () => {
      const config = createTestConfig();

      await expect(
        explain(
          { database: 'testdb', sql: 'DROP TABLE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks TRUNCATE', async () => {
      const config = createTestConfig();

      await expect(
        explain(
          { database: 'testdb', sql: 'TRUNCATE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ALTER TABLE', async () => {
      const config = createTestConfig();

      await expect(
        explain(
          { database: 'testdb', sql: 'ALTER TABLE users ADD COLUMN hacked TEXT' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks CREATE TABLE', async () => {
      const config = createTestConfig();

      await expect(
        explain(
          { database: 'testdb', sql: 'CREATE TABLE hacked (id INT)' },
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
      const result = await explain(
        { database: 'testdb', sql: 'SELECT * FROM users' },
        config
      );

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('returns multi-line plan', async () => {
      const config = createTestConfig();
      const result = await explain(
        {
          database: 'testdb',
          sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
        },
        config
      );

      const lines = result.plan.split('\n');
      expect(lines.length).toBeGreaterThan(1);
    });
  });
});
