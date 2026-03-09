/**
 * Integration tests for query tool with SQLite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../tools/query.js';
import { createSqliteTestConfig, seedSqliteTestData } from '../helpers.js';
import { ErrorCode } from '../../utils/errors.js';

describe('query SQLite integration', () => {
  beforeEach(async () => {
    await seedSqliteTestData();
  });

  describe('basic queries', () => {
    it('executes basic SELECT', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT * FROM users ORDER BY name' },
        config
      );

      expect(result.rowCount).toBe(3);
      expect(result.columns).toContain('id');
      expect(result.columns).toContain('email');
      expect(result.columns).toContain('name');
    });

    it('filters with WHERE clause', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT * FROM users WHERE is_active = 1' },
        config
      );

      expect(result.rowCount).toBe(2);
    });

    it('supports prepared statement params', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: 'SELECT * FROM users WHERE id = $1',
          params: ['11111111-1111-1111-1111-111111111111'],
        },
        config
      );

      expect(result.rowCount).toBe(1);
      // Find email column index and check value
      const emailIdx = result.columns.indexOf('email');
      expect(result.rows[0][emailIdx]).toBe('alice@example.com');
    });

    it('supports multiple params', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: 'SELECT * FROM users WHERE age > $1 AND balance < $2',
          params: [26, 600],
        },
        config
      );

      expect(result.rowCount).toBe(1);
      const nameIdx = result.columns.indexOf('name');
      expect(result.rows[0][nameIdx]).toBe('Charlie Brown');
    });

    it('respects explicit LIMIT', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT * FROM users LIMIT 1' },
        config
      );

      expect(result.rowCount).toBe(1);
    });

    it('auto-injects LIMIT when missing', async () => {
      const config = createSqliteTestConfig({
        defaults: {
          maxRows: 2,
          maxTotalSize: 65536,
          maxColumns: 50,
          maxTables: 200,
          maxIndexes: 20,
          timeout: 30000,
        },
      });
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT * FROM users' },
        config
      );

      // Should be limited to maxRows
      expect(result.rowCount).toBeLessThanOrEqual(2);
    });

    it('supports JOIN queries', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: `
            SELECT u.name, o.total, o.status
            FROM users u
            JOIN orders o ON u.id = o.user_id
            ORDER BY o.total DESC
          `,
        },
        config
      );

      expect(result.rowCount).toBe(3);
      expect(result.columns).toContain('name');
      expect(result.columns).toContain('total');
      expect(result.columns).toContain('status');
    });

    it('supports aggregate functions', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT COUNT(*) as cnt, SUM(balance) as total FROM users' },
        config
      );

      expect(result.rowCount).toBe(1);
      expect(result.columns).toContain('cnt');
      expect(result.columns).toContain('total');
    });

    it('supports COALESCE and SQLite functions', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        { database: 'sqlitedb', sql: "SELECT COALESCE(metadata, 'none') as meta FROM users ORDER BY name" },
        config
      );

      expect(result.rowCount).toBe(3);
      const metaIdx = result.columns.indexOf('meta');
      // Charlie Brown has NULL metadata
      expect(result.rows.some((r) => r[metaIdx] === 'none')).toBe(true);
    });
  });

  describe('data formatting', () => {
    it('formats NULL as string', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: "SELECT metadata FROM users WHERE name = 'Charlie Brown'",
        },
        config
      );

      expect(result.rows[0][0]).toBe('NULL');
    });

    it('formats integer boolean values (SQLite stores as 0/1)', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT is_active FROM users ORDER BY name' },
        config
      );

      // SQLite stores boolean as 0/1 integers
      const values = result.rows.map((r) => r[0]);
      expect(values).toContain('1'); // active
      expect(values).toContain('0'); // inactive
    });

    it('formats JSON values stored as TEXT', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: "SELECT metadata FROM users WHERE name = 'Alice Smith'",
        },
        config
      );

      const metadata = result.rows[0][0];
      expect(metadata).toContain('admin');
    });

    it('formats REAL decimal values', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: "SELECT balance FROM users WHERE name = 'Alice Smith'",
        },
        config
      );

      expect(result.rows[0][0]).toMatch(/1000\.5/);
    });
  });

  describe('truncation', () => {
    it('limits rows at maxRows', async () => {
      const config = createSqliteTestConfig({
        defaults: {
          maxRows: 2,
          maxTotalSize: 65536,
          maxColumns: 50,
          maxTables: 200,
          maxIndexes: 20,
          timeout: 30000,
        },
      });
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT * FROM users' },
        config
      );

      // maxRows auto-injects LIMIT, so rowCount should be <= maxRows
      expect(result.rowCount).toBeLessThanOrEqual(2);
    });

    it('handles empty results', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT * FROM users WHERE 1=0' },
        config
      );

      expect(result.rowCount).toBe(0);
      expect(result.rows).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe('security - blocked queries', () => {
    it('blocks INSERT', async () => {
      const config = createSqliteTestConfig();

      await expect(
        query(
          { database: 'sqlitedb', sql: "INSERT INTO users (id, email, name) VALUES ('test-id', 'test@test.com', 'Test')" },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks UPDATE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        query(
          { database: 'sqlitedb', sql: "UPDATE users SET name = 'Hacked'" },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks DELETE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        query(
          { database: 'sqlitedb', sql: 'DELETE FROM users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks DROP', async () => {
      const config = createSqliteTestConfig();

      await expect(
        query(
          { database: 'sqlitedb', sql: 'DROP TABLE users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks ATTACH DATABASE', async () => {
      const config = createSqliteTestConfig();

      await expect(
        query(
          { database: 'sqlitedb', sql: "ATTACH DATABASE '/tmp/hack.db' AS hack" },
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
      const result = await query(
        { database: 'sqlitedb', sql: 'SELECT * FROM users' },
        config
      );

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('SQLite-specific features', () => {
    it('supports WITH CTEs', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: `
            WITH active_users AS (
              SELECT * FROM users WHERE is_active = 1
            )
            SELECT name, email FROM active_users ORDER BY name
          `,
        },
        config
      );

      expect(result.rowCount).toBe(2);
    });

    it('supports CASE expressions', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: `
            SELECT name,
                   CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END as status
            FROM users
            ORDER BY name
          `,
        },
        config
      );

      expect(result.rowCount).toBe(3);
      expect(result.columns).toContain('status');
    });

    it('supports SQLite date functions', async () => {
      const config = createSqliteTestConfig();
      const result = await query(
        {
          database: 'sqlitedb',
          sql: "SELECT date('now') as today",
        },
        config
      );

      expect(result.rowCount).toBe(1);
      expect(result.columns).toContain('today');
    });
  });
});
