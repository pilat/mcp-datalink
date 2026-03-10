/**
 * Integration tests for query tool
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../tools/query.js';
import { createTestConfig, seedTestData } from './helpers.js';
import { ErrorCode } from '../utils/errors.js';

describe('query integration', () => {
  beforeEach(async () => {
    await seedTestData();
  });

  describe('basic queries', () => {
    it('executes basic SELECT', async () => {
      const config = createTestConfig();
      const result = await query(
        { database: 'testdb', sql: 'SELECT * FROM users ORDER BY name' },
        config
      );

      expect(result.rowCount).toBe(3);
      expect(result.columns).toContain('id');
      expect(result.columns).toContain('email');
      expect(result.columns).toContain('name');
    });

    it('filters with WHERE clause', async () => {
      const config = createTestConfig();
      const result = await query(
        { database: 'testdb', sql: 'SELECT * FROM users WHERE is_active = true' },
        config
      );

      expect(result.rowCount).toBe(2);
    });

    it('supports prepared statement params', async () => {
      const config = createTestConfig();
      const result = await query(
        {
          database: 'testdb',
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
      const config = createTestConfig();
      const result = await query(
        {
          database: 'testdb',
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
      const config = createTestConfig();
      const result = await query(
        { database: 'testdb', sql: 'SELECT * FROM users LIMIT 1' },
        config
      );

      expect(result.rowCount).toBe(1);
    });

    it('auto-injects LIMIT when missing', async () => {
      const config = createTestConfig({
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
        { database: 'testdb', sql: 'SELECT * FROM users' },
        config
      );

      // Should be limited to maxRows
      expect(result.rowCount).toBeLessThanOrEqual(2);
    });

    it('supports JOIN queries', async () => {
      const config = createTestConfig();
      const result = await query(
        {
          database: 'testdb',
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
      const config = createTestConfig();
      const result = await query(
        { database: 'testdb', sql: 'SELECT COUNT(*) as count, SUM(balance) as total FROM users' },
        config
      );

      expect(result.rowCount).toBe(1);
      expect(result.columns).toContain('count');
      expect(result.columns).toContain('total');
    });
  });

  describe('data formatting', () => {
    it('formats NULL as string', async () => {
      const config = createTestConfig();
      const result = await query(
        {
          database: 'testdb',
          sql: "SELECT metadata FROM users WHERE name = 'Charlie Brown'",
        },
        config
      );

      expect(result.rows[0][0]).toBe('NULL');
    });

    it('formats boolean values', async () => {
      const config = createTestConfig();
      const result = await query(
        { database: 'testdb', sql: 'SELECT is_active FROM users ORDER BY name' },
        config
      );

      expect(result.rows.map((r) => r[0])).toContain('true');
      expect(result.rows.map((r) => r[0])).toContain('false');
    });

    it('formats JSON/JSONB values', async () => {
      const config = createTestConfig();
      const result = await query(
        {
          database: 'testdb',
          sql: "SELECT metadata FROM users WHERE name = 'Alice Smith'",
        },
        config
      );

      const metadata = result.rows[0][0];
      expect(metadata).toContain('admin');
    });

    it('formats decimal values', async () => {
      const config = createTestConfig();
      const result = await query(
        {
          database: 'testdb',
          sql: "SELECT balance FROM users WHERE name = 'Alice Smith'",
        },
        config
      );

      expect(result.rows[0][0]).toMatch(/1000\.50/);
    });
  });

  describe('truncation', () => {
    it('limits rows at maxRows', async () => {
      const config = createTestConfig({
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
        { database: 'testdb', sql: 'SELECT * FROM users' },
        config
      );

      // maxRows auto-injects LIMIT, so rowCount should be <= maxRows
      expect(result.rowCount).toBeLessThanOrEqual(2);
    });

    it('handles empty results', async () => {
      const config = createTestConfig();
      const result = await query(
        { database: 'testdb', sql: 'SELECT * FROM users WHERE 1=0' },
        config
      );

      expect(result.rowCount).toBe(0);
      expect(result.rows).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });
  });

  describe('security - blocked queries', () => {
    it('blocks INSERT', async () => {
      const config = createTestConfig();

      await expect(
        query(
          { database: 'testdb', sql: "INSERT INTO users (email, name) VALUES ('test@test.com', 'Test')" },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks UPDATE', async () => {
      const config = createTestConfig();

      await expect(
        query(
          { database: 'testdb', sql: "UPDATE users SET name = 'Hacked'" },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks DELETE', async () => {
      const config = createTestConfig();

      await expect(
        query(
          { database: 'testdb', sql: 'DELETE FROM users' },
          config
        )
      ).rejects.toMatchObject({
        code: ErrorCode.QUERY_BLOCKED,
      });
    });

    it('blocks DROP', async () => {
      const config = createTestConfig();

      await expect(
        query(
          { database: 'testdb', sql: 'DROP TABLE users' },
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
      const result = await query(
        { database: 'testdb', sql: 'SELECT * FROM users' },
        config
      );

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });
  });
});
