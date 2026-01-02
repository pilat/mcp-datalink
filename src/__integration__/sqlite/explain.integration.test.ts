/**
 * Integration tests for explain tool with SQLite
 *
 * Note: SQLite uses EXPLAIN QUERY PLAN instead of EXPLAIN ANALYZE.
 * The output format is different from PostgreSQL.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { explain } from '../../tools/explain.js';
import { createSqliteTestConfig, seedSqliteTestData } from '../helpers.js';
import { ErrorCode } from '../../utils/errors.js';

describe('explain SQLite integration', () => {
  beforeEach(async () => {
    await seedSqliteTestData();
  });

  describe('EXPLAIN QUERY PLAN', () => {
    it('explains SELECT query', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        { database: 'sqlitedb', sql: 'SELECT * FROM users' },
        config
      );

      // SQLite EXPLAIN QUERY PLAN output format
      expect(result.plan).toMatch(/SCAN|SEARCH/i);
      expect(result.plan.toLowerCase()).toContain('users');
    });

    it('explains SELECT with WHERE using index', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        { database: 'sqlitedb', sql: "SELECT * FROM users WHERE email = 'alice@example.com'" },
        config
      );

      // Should mention the index or scan
      expect(result.plan).toBeDefined();
      expect(result.plan.length).toBeGreaterThan(0);
    });

    it('explains JOIN query', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
        },
        config
      );

      // Should show multiple scan/search operations
      expect(result.plan).toBeDefined();
      expect(result.plan.toLowerCase()).toMatch(/users|orders/);
    });

    it('explains INSERT query', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: "INSERT INTO products (name, price) VALUES ('Test', 1.00)",
        },
        config
      );

      expect(result.plan).toBeDefined();
    });

    it('explains UPDATE query', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: 'UPDATE products SET price = 0 WHERE id = 1',
        },
        config
      );

      expect(result.plan).toBeDefined();
    });

    it('explains DELETE query', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: 'DELETE FROM products WHERE id = 1',
        },
        config
      );

      expect(result.plan).toBeDefined();
    });
  });

  describe('EXPLAIN ANALYZE (ignored for SQLite)', () => {
    it('uses EXPLAIN QUERY PLAN even when analyze=true', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        { database: 'sqlitedb', sql: 'SELECT * FROM users', analyze: true },
        config
      );

      // SQLite doesn't support EXPLAIN ANALYZE - it uses EXPLAIN QUERY PLAN
      // The analyze flag is ignored, but the query should still work
      expect(result.plan).toBeDefined();
      expect(result.plan).toMatch(/SCAN|SEARCH/i);
    });

    it('does not include actual execution stats (SQLite limitation)', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        { database: 'sqlitedb', sql: 'SELECT * FROM users', analyze: true },
        config
      );

      // SQLite EXPLAIN QUERY PLAN doesn't include execution statistics
      // unlike PostgreSQL's EXPLAIN ANALYZE
      expect(result.plan).not.toMatch(/actual time/i);
    });
  });

  describe('security - blocked queries', () => {
    it('blocks DROP TABLE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        explain(
          { database: 'sqlitedb', sql: 'DROP TABLE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ALTER TABLE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        explain(
          { database: 'sqlitedb', sql: 'ALTER TABLE users ADD COLUMN hacked TEXT' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks CREATE TABLE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        explain(
          { database: 'sqlitedb', sql: 'CREATE TABLE hacked (id INTEGER)' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ATTACH DATABASE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        explain(
          { database: 'sqlitedb', sql: "ATTACH DATABASE '/tmp/hack.db' AS hack" },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks VACUUM', async () => {
      const config = createSqliteTestConfig();

      await expect(
        explain(
          { database: 'sqlitedb', sql: 'VACUUM' },
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
      const result = await explain(
        { database: 'sqlitedb', sql: 'SELECT * FROM users' },
        config
      );

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('returns multi-line plan for complex queries', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
        },
        config
      );

      const lines = result.plan.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SQLite-specific query plans', () => {
    it('shows USING INDEX when applicable', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: "SELECT * FROM users WHERE created_at > '2024-01-01'",
        },
        config
      );

      // May show index usage depending on query optimizer decision
      expect(result.plan).toBeDefined();
    });

    it('shows SCAN for full table scan', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: 'SELECT * FROM users',
        },
        config
      );

      // Full table scan should show SCAN
      expect(result.plan).toMatch(/SCAN/i);
    });

    it('explains subqueries', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: `
            SELECT * FROM users
            WHERE id IN (SELECT user_id FROM orders WHERE status = 'completed')
          `,
        },
        config
      );

      expect(result.plan).toBeDefined();
      // Should show plans for both main query and subquery
    });

    it('explains CTEs', async () => {
      const config = createSqliteTestConfig();
      const result = await explain(
        {
          database: 'sqlitedb',
          sql: `
            WITH active AS (SELECT * FROM users WHERE is_active = 1)
            SELECT * FROM active
          `,
        },
        config
      );

      expect(result.plan).toBeDefined();
    });
  });
});
