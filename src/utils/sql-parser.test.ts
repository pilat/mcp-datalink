/**
 * SQL Parser Unit Tests
 *
 * Tests for the unified SQL parser utility that handles
 * PostgreSQL, MySQL, and SQLite dialects.
 */

import { describe, it, expect } from 'vitest';
import { parseQuery, injectLimit } from './sql-parser.js';
import { ErrorCode } from './errors.js';

describe('parseQuery', () => {
  describe('PostgreSQL dialect', () => {
    it('should parse SELECT query', () => {
      const result = parseQuery('SELECT * FROM users', 'PostgreSQL');
      expect(result.type).toBe('select');
      expect(result.isDangerous).toBe(false);
    });

    it('should parse INSERT query', () => {
      const result = parseQuery("INSERT INTO users (name) VALUES ('test')", 'PostgreSQL');
      expect(result.type).toBe('insert');
      expect(result.isDangerous).toBe(false);
    });

    it('should parse UPDATE query', () => {
      const result = parseQuery("UPDATE users SET name = 'test'", 'PostgreSQL');
      expect(result.type).toBe('update');
      expect(result.isDangerous).toBe(false);
    });

    it('should parse DELETE query', () => {
      const result = parseQuery('DELETE FROM users WHERE id = 1', 'PostgreSQL');
      expect(result.type).toBe('delete');
      expect(result.isDangerous).toBe(false);
    });

    it('should detect LIMIT clause', () => {
      const result = parseQuery('SELECT * FROM users LIMIT 10', 'PostgreSQL');
      expect(result.hasLimit).toBe(true);
    });

    it('should detect missing LIMIT clause', () => {
      const result = parseQuery('SELECT * FROM users', 'PostgreSQL');
      expect(result.hasLimit).toBe(false);
    });

    it('should mark DROP as dangerous', () => {
      const result = parseQuery('DROP TABLE users', 'PostgreSQL');
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousReason).toContain('DROP');
    });

    it('should reject multi-statement queries', () => {
      expect(() => parseQuery('SELECT 1; SELECT 2', 'PostgreSQL')).toThrow();
      try {
        parseQuery('SELECT 1; SELECT 2', 'PostgreSQL');
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.MULTI_STATEMENT);
      }
    });

    it('should reject empty queries', () => {
      expect(() => parseQuery('', 'PostgreSQL')).toThrow();
      try {
        parseQuery('', 'PostgreSQL');
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.INVALID_SQL);
      }
    });
  });

  describe('MySQL dialect', () => {
    it('should parse SELECT query', () => {
      const result = parseQuery('SELECT * FROM users', 'MySQL');
      expect(result.type).toBe('select');
    });

    it('should detect LIMIT clause', () => {
      const result = parseQuery('SELECT * FROM users LIMIT 10', 'MySQL');
      expect(result.hasLimit).toBe(true);
    });

    it('should mark TRUNCATE as dangerous', () => {
      const result = parseQuery('TRUNCATE TABLE users', 'MySQL');
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousReason).toContain('TRUNCATE');
    });
  });

  describe('SQLite dialect', () => {
    it('should parse SELECT query', () => {
      const result = parseQuery('SELECT * FROM users', 'SQLite');
      expect(result.type).toBe('select');
    });

    it('should block DETACH as unparseable dangerous operation', () => {
      expect(() => parseQuery('DETACH DATABASE other', 'SQLite')).toThrow();
      try {
        parseQuery('DETACH DATABASE other', 'SQLite');
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.QUERY_BLOCKED);
      }
    });

    it('should block VACUUM as unparseable dangerous operation', () => {
      expect(() => parseQuery('VACUUM', 'SQLite')).toThrow();
      try {
        parseQuery('VACUUM', 'SQLite');
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.QUERY_BLOCKED);
      }
    });

    it('should block REINDEX as unparseable dangerous operation', () => {
      expect(() => parseQuery('REINDEX', 'SQLite')).toThrow();
      try {
        parseQuery('REINDEX', 'SQLite');
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.QUERY_BLOCKED);
      }
    });

    it('should mark ATTACH as dangerous', () => {
      const result = parseQuery("ATTACH DATABASE 'other.db' AS other", 'SQLite');
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousReason).toContain('ATTACH');
    });
  });

  describe('query type detection', () => {
    it('should detect other query types', () => {
      const result = parseQuery('SHOW TABLES', 'MySQL');
      expect(result.type).toBe('other');
    });
  });

  describe('dangerous operations across dialects', () => {
    const dialects = ['PostgreSQL', 'MySQL', 'SQLite'] as const;
    const dangerousOperations = [
      { sql: 'DROP TABLE users', keyword: 'DROP' },
      { sql: 'TRUNCATE TABLE users', keyword: 'TRUNCATE' },
      { sql: 'ALTER TABLE users ADD COLUMN email TEXT', keyword: 'ALTER' },
      { sql: 'CREATE TABLE test (id INT)', keyword: 'CREATE' },
    ];

    for (const dialect of dialects) {
      for (const { sql, keyword } of dangerousOperations) {
        it(`should block ${keyword} in ${dialect}`, () => {
          const result = parseQuery(sql, dialect);
          expect(result.isDangerous).toBe(true);
          expect(result.dangerousReason).toContain(keyword);
        });
      }
    }
  });
});

describe('injectLimit', () => {
  describe('PostgreSQL dialect', () => {
    it('should inject LIMIT when missing', () => {
      const result = injectLimit('SELECT * FROM users', 100, 'PostgreSQL');
      expect(result).toContain('LIMIT');
      expect(result).toContain('100');
    });

    it('should not modify existing LIMIT', () => {
      const result = injectLimit('SELECT * FROM users LIMIT 50', 100, 'PostgreSQL');
      expect(result).toContain('50');
      expect(result).not.toMatch(/LIMIT\s+100/);
    });

    it('should not modify non-SELECT queries', () => {
      const sql = "INSERT INTO users (name) VALUES ('test')";
      const result = injectLimit(sql, 100, 'PostgreSQL');
      expect(result).not.toContain('LIMIT');
    });
  });

  describe('MySQL dialect', () => {
    it('should inject LIMIT when missing', () => {
      const result = injectLimit('SELECT * FROM users', 100, 'MySQL');
      expect(result).toContain('LIMIT');
      expect(result).toContain('100');
    });

    it('should not modify existing LIMIT with offset', () => {
      const result = injectLimit('SELECT * FROM users LIMIT 10, 20', 100, 'MySQL');
      expect(result).toContain('10');
    });
  });

  describe('SQLite dialect', () => {
    it('should inject LIMIT when missing', () => {
      const result = injectLimit('SELECT * FROM users', 100, 'SQLite');
      expect(result).toContain('LIMIT');
      expect(result).toContain('100');
    });

    it('should handle trailing semicolon', () => {
      const result = injectLimit('SELECT * FROM users;', 100, 'SQLite');
      expect(result).toContain('LIMIT');
      expect(result).toContain('100');
    });
  });

  describe('multi-statement handling', () => {
    it('should return original for multiple statements (safety)', () => {
      // Multi-statement queries successfully parse but return original
      // because we can't safely inject LIMIT into multi-statement
      const sql = 'SELECT 1; SELECT 2';
      const result = injectLimit(sql, 100, 'PostgreSQL');
      // Returns original because statements.length !== 1
      expect(result).toBe('SELECT 1; SELECT 2');
    });
  });

  describe('LIMIT injection verification', () => {
    it('should successfully inject LIMIT for standard queries', () => {
      const sql = 'SELECT id, name FROM users WHERE active = true';
      const result = injectLimit(sql, 100, 'PostgreSQL');
      expect(result).toMatch(/LIMIT\s+100/i);
    });

    it('should inject LIMIT for complex queries with JOINs', () => {
      const sql = 'SELECT u.id, u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id';
      const result = injectLimit(sql, 50, 'PostgreSQL');
      expect(result).toMatch(/LIMIT\s+50/i);
    });

    it('should inject LIMIT for queries with subqueries', () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)';
      const result = injectLimit(sql, 25, 'PostgreSQL');
      expect(result).toMatch(/LIMIT\s+25/i);
    });

    it('should inject LIMIT for queries with ORDER BY', () => {
      const sql = 'SELECT * FROM users ORDER BY created_at DESC';
      const result = injectLimit(sql, 10, 'MySQL');
      expect(result).toMatch(/LIMIT\s+10/i);
    });

    it('should inject LIMIT for queries with GROUP BY and HAVING', () => {
      const sql = 'SELECT department, COUNT(*) as cnt FROM employees GROUP BY department HAVING COUNT(*) > 5';
      const result = injectLimit(sql, 100, 'SQLite');
      expect(result).toMatch(/LIMIT\s+100/i);
    });
  });
});

describe('edge cases', () => {
  describe('comment handling', () => {
    it('should handle inline comments', () => {
      const result = parseQuery('SELECT * FROM users -- comment', 'PostgreSQL');
      expect(result.type).toBe('select');
    });

    it('should handle block comments', () => {
      const result = parseQuery('SELECT /* comment */ * FROM users', 'PostgreSQL');
      expect(result.type).toBe('select');
    });
  });

  describe('string handling', () => {
    it('should handle semicolons in strings', () => {
      const result = parseQuery("SELECT 'test;value' FROM users", 'PostgreSQL');
      expect(result.type).toBe('select');
    });

    it('should handle escaped quotes', () => {
      const result = parseQuery("SELECT 'it''s fine' FROM users", 'PostgreSQL');
      expect(result.type).toBe('select');
    });
  });

  describe('whitespace handling', () => {
    it('should reject whitespace-only queries', () => {
      expect(() => parseQuery('   ', 'PostgreSQL')).toThrow();
    });

    it('should reject comment-only queries', () => {
      expect(() => parseQuery('-- just a comment', 'PostgreSQL')).toThrow();
    });
  });
});
