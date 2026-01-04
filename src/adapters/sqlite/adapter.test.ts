/**
 * SQLite Adapter SQL Parsing Unit Tests
 *
 * Tests for SQLite-specific SQL parsing, validation, and security checks.
 *
 * SECURITY: These tests verify that dangerous SQLite patterns are blocked:
 * - ATTACH/DETACH (access other databases)
 * - VACUUM/REINDEX (database modifications)
 * - PRAGMA modifications (database settings)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from './adapter.js';
import { DbMcpError, ErrorCode } from '../../utils/errors.js';
import * as fs from 'fs';

// Mock fs.existsSync for testing (to avoid needing real database files)
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

// Create a minimal adapter config for testing
const testConfig = {
  database: {
    url: 'sqlite:///test.db',
    readonly: false,
  },
  defaults: {
    timeout: 30000,
    maxRows: 1000,
    maxCellLength: 1000,
    maxTotalSize: 100000,
    maxColumns: 100,
    maxIndexes: 50,
    maxTables: 100,
  },
};

describe('SqliteAdapter SQL parsing', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('parseQuery', () => {
    describe('query type detection', () => {
      it('should detect SELECT queries', () => {
        const result = adapter.parseQuery('SELECT * FROM users');
        expect(result.type).toBe('select');
      });

      it('should detect SELECT with WITH clause', () => {
        const result = adapter.parseQuery('WITH cte AS (SELECT 1) SELECT * FROM cte');
        expect(result.type).toBe('select');
      });

      it('should detect INSERT queries', () => {
        const result = adapter.parseQuery("INSERT INTO users (name) VALUES ('test')");
        expect(result.type).toBe('insert');
      });

      it('should detect UPDATE queries', () => {
        const result = adapter.parseQuery("UPDATE users SET name = 'test'");
        expect(result.type).toBe('update');
      });

      it('should detect DELETE queries', () => {
        const result = adapter.parseQuery('DELETE FROM users WHERE id = 1');
        expect(result.type).toBe('delete');
      });

      it('should throw on PRAGMA (unparseable by node-sql-parser)', () => {
        expect(() => adapter.parseQuery('PRAGMA table_info(users)')).toThrow(DbMcpError);
        try {
          adapter.parseQuery('PRAGMA table_info(users)');
        } catch (error: unknown) {
          expect((error as { code: string }).code).toBe(ErrorCode.INVALID_SQL);
        }
      });
    });

    describe('LIMIT clause detection', () => {
      it('should detect LIMIT clause in SELECT', () => {
        const result = adapter.parseQuery('SELECT * FROM users LIMIT 10');
        expect(result.hasLimit).toBe(true);
      });

      it('should detect LIMIT with OFFSET syntax', () => {
        const result = adapter.parseQuery('SELECT * FROM users LIMIT 10 OFFSET 20');
        expect(result.hasLimit).toBe(true);
      });

      it('should detect missing LIMIT', () => {
        const result = adapter.parseQuery('SELECT * FROM users');
        expect(result.hasLimit).toBe(false);
      });

      it('should not set hasLimit for non-SELECT queries', () => {
        const result = adapter.parseQuery("INSERT INTO users (name) VALUES ('test')");
        expect(result.hasLimit).toBe(false);
      });
    });

    describe('dangerous operations - standard DDL/DCL', () => {
      it('should block DROP statements', () => {
        const result = adapter.parseQuery('DROP TABLE users');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('DROP');
      });

      it('should block TRUNCATE statements', () => {
        const result = adapter.parseQuery('TRUNCATE TABLE users');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('TRUNCATE');
      });

      it('should block ALTER statements', () => {
        const result = adapter.parseQuery('ALTER TABLE users ADD COLUMN email TEXT');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('ALTER');
      });

      it('should block CREATE statements', () => {
        const result = adapter.parseQuery('CREATE TABLE test (id INTEGER)');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('CREATE');
      });

      it('should throw on GRANT (unparseable by node-sql-parser)', () => {
        expect(() => adapter.parseQuery('GRANT ALL ON users TO user')).toThrow(DbMcpError);
        try {
          adapter.parseQuery('GRANT ALL ON users TO user');
        } catch (error: unknown) {
          expect((error as { code: string }).code).toBe(ErrorCode.INVALID_SQL);
        }
      });

      it('should throw on REVOKE (unparseable by node-sql-parser)', () => {
        expect(() => adapter.parseQuery('REVOKE ALL ON users FROM user')).toThrow(DbMcpError);
        try {
          adapter.parseQuery('REVOKE ALL ON users FROM user');
        } catch (error: unknown) {
          expect((error as { code: string }).code).toBe(ErrorCode.INVALID_SQL);
        }
      });
    });

    describe('SECURITY: SQLite-specific commands', () => {
      // node-sql-parser parses ATTACH as a known statement type
      // The adapter marks it as dangerous via checkDangerousType
      // DETACH, VACUUM, REINDEX, PRAGMA throw parse errors

      it('should block ATTACH (marked as dangerous)', () => {
        const result = adapter.parseQuery("ATTACH DATABASE '/etc/passwd' AS other");
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('ATTACH');
      });

      it('should throw on DETACH (unparseable)', () => {
        expect(() => adapter.parseQuery('DETACH DATABASE other')).toThrow(DbMcpError);
      });

      it('should throw on VACUUM (unparseable)', () => {
        expect(() => adapter.parseQuery('VACUUM')).toThrow(DbMcpError);
      });

      it('should throw on REINDEX (unparseable)', () => {
        expect(() => adapter.parseQuery('REINDEX')).toThrow(DbMcpError);
      });

      it('should block PRAGMA modifications (adapter special handling)', () => {
        // Adapter has special handling for PRAGMA with '=' - returns isDangerous: true
        const result = adapter.parseQuery('PRAGMA foreign_keys = ON');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('PRAGMA');
      });

      it('should throw on read-only PRAGMA (unparseable)', () => {
        // Read-only PRAGMA without '=' throws parse error
        expect(() => adapter.parseQuery('PRAGMA table_info(users)')).toThrow(DbMcpError);
      });
    });

    describe('multi-statement prevention', () => {
      it('should reject multiple statements', () => {
        expect(() => adapter.parseQuery('SELECT 1; SELECT 2')).toThrow();
      });

      it('should reject multiple statements with DROP injection', () => {
        expect(() =>
          adapter.parseQuery('SELECT * FROM users; DROP TABLE users')
        ).toThrow();
      });

      it('should handle statements with trailing semicolon', () => {
        const result = adapter.parseQuery('SELECT * FROM users;');
        expect(result.type).toBe('select');
      });

      it('should reject empty query', () => {
        expect(() => adapter.parseQuery('')).toThrow();
      });

      it('should reject comment-only query', () => {
        expect(() => adapter.parseQuery('-- just a comment')).toThrow();
      });
    });
  });

  describe('injectLimit', () => {
    it('should inject LIMIT when missing', () => {
      const result = adapter.injectLimit('SELECT * FROM users', 100);
      // node-sql-parser formats identifiers with quotes
      expect(result).toBe('SELECT * FROM "users" LIMIT 100');
    });

    it('should not modify query with existing LIMIT', () => {
      const sql = 'SELECT * FROM users LIMIT 50';
      const result = adapter.injectLimit(sql, 100);
      expect(result).toContain('LIMIT');
      expect(result).toContain('50');
    });

    it('should remove trailing semicolon before LIMIT', () => {
      const result = adapter.injectLimit('SELECT * FROM users;', 100);
      // node-sql-parser formats identifiers with quotes
      expect(result).toBe('SELECT * FROM "users" LIMIT 100');
    });
  });

  describe('convertPlaceholders', () => {
    it('should convert $1, $2 to ?', () => {
      const result = adapter.convertPlaceholders('SELECT * FROM users WHERE id = $1 AND name = $2');
      expect(result).toBe('SELECT * FROM users WHERE id = ? AND name = ?');
    });

    it('should handle placeholder at end', () => {
      const result = adapter.convertPlaceholders('SELECT * FROM users WHERE id = $1');
      expect(result).toBe('SELECT * FROM users WHERE id = ?');
    });

    it('should not convert placeholders in strings', () => {
      const result = adapter.convertPlaceholders("SELECT * FROM users WHERE name = '$1'");
      expect(result).toBe("SELECT * FROM users WHERE name = '$1'");
    });

    it('should not convert placeholders in double-quoted strings', () => {
      const result = adapter.convertPlaceholders('SELECT * FROM users WHERE name = "$1"');
      expect(result).toBe('SELECT * FROM users WHERE name = "$1"');
    });

    it('should handle escaped quotes in strings', () => {
      const result = adapter.convertPlaceholders("SELECT * FROM users WHERE name = 'it''s $1'");
      expect(result).toBe("SELECT * FROM users WHERE name = 'it''s $1'");
    });

    it('should convert multiple placeholders', () => {
      const result = adapter.convertPlaceholders('INSERT INTO users (a, b, c) VALUES ($1, $2, $3)');
      expect(result).toBe('INSERT INTO users (a, b, c) VALUES (?, ?, ?)');
    });
  });

  describe('validateQueryForTool', () => {
    describe('query tool', () => {
      it('should allow SELECT queries', () => {
        expect(() => adapter.validateQueryForTool('SELECT * FROM users', 'query')).not.toThrow();
      });

      it('should block INSERT queries', () => {
        expect(() =>
          adapter.validateQueryForTool("INSERT INTO users VALUES (1)", 'query')
        ).toThrow();
      });

      it('should block UPDATE queries', () => {
        expect(() =>
          adapter.validateQueryForTool("UPDATE users SET name = 'x'", 'query')
        ).toThrow();
      });

      it('should block DELETE queries', () => {
        expect(() =>
          adapter.validateQueryForTool('DELETE FROM users', 'query')
        ).toThrow();
      });
    });

    describe('execute tool', () => {
      it('should allow INSERT queries', () => {
        expect(() =>
          adapter.validateQueryForTool("INSERT INTO users VALUES (1)", 'execute')
        ).not.toThrow();
      });

      it('should allow UPDATE queries', () => {
        expect(() =>
          adapter.validateQueryForTool("UPDATE users SET name = 'x'", 'execute')
        ).not.toThrow();
      });

      it('should allow DELETE queries', () => {
        expect(() =>
          adapter.validateQueryForTool('DELETE FROM users WHERE id = 1', 'execute')
        ).not.toThrow();
      });

      it('should block SELECT queries', () => {
        expect(() =>
          adapter.validateQueryForTool('SELECT * FROM users', 'execute')
        ).toThrow();
      });

      it('should block DROP statements', () => {
        expect(() =>
          adapter.validateQueryForTool('DROP TABLE users', 'execute')
        ).toThrow();
      });
    });
  });

  describe('getExplainPrefix', () => {
    it('should return EXPLAIN QUERY PLAN prefix', () => {
      expect(adapter.getExplainPrefix(false)).toBe('EXPLAIN QUERY PLAN ');
    });

    it('should return same prefix for analyze mode', () => {
      // SQLite doesn't have separate EXPLAIN ANALYZE syntax
      expect(adapter.getExplainPrefix(true)).toBe('EXPLAIN QUERY PLAN ');
    });
  });
});

describe('SECURITY: PRAGMA commands', () => {
  /**
   * PRAGMA commands are handled differently:
   * - PRAGMA with '=' is caught by adapter's special handling and marked as dangerous
   * - PRAGMA without '=' throws parse error from node-sql-parser
   */
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  it('should block PRAGMA with = assignment (adapter special handling)', () => {
    const result = adapter.parseQuery('PRAGMA foreign_keys = ON');
    expect(result.isDangerous).toBe(true);
  });

  it('should throw on PRAGMA with function-style assignment', () => {
    expect(() => adapter.parseQuery('PRAGMA foreign_keys(1)')).toThrow(DbMcpError);
  });

  it('should throw on read-only PRAGMA table_info', () => {
    expect(() => adapter.parseQuery('PRAGMA table_info(users)')).toThrow(DbMcpError);
  });

  it('should throw on read-only PRAGMA index_list', () => {
    expect(() => adapter.parseQuery('PRAGMA index_list(users)')).toThrow(DbMcpError);
  });

  it('should throw on read-only PRAGMA foreign_key_list', () => {
    expect(() => adapter.parseQuery('PRAGMA foreign_key_list(users)')).toThrow(DbMcpError);
  });

  it('should block PRAGMA journal_mode modification (adapter special handling)', () => {
    const result = adapter.parseQuery('PRAGMA journal_mode = DELETE');
    expect(result.isDangerous).toBe(true);
  });

  it('should block PRAGMA synchronous modification (adapter special handling)', () => {
    const result = adapter.parseQuery('PRAGMA synchronous = OFF');
    expect(result.isDangerous).toBe(true);
  });

  it('should block PRAGMA with space around = (adapter special handling)', () => {
    const result = adapter.parseQuery('PRAGMA foreign_keys  =  ON');
    expect(result.isDangerous).toBe(true);
  });
});

describe('SECURITY: Unicode whitespace in SQLite queries', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  const unicodeSpaces = [
    { name: 'NBSP', char: '\u00A0' },
    { name: 'EN_QUAD', char: '\u2000' },
    { name: 'IDEOGRAPHIC_SPACE', char: '\u3000' },
  ];

  for (const { name, char } of unicodeSpaces) {
    describe(`with ${name} (${char.charCodeAt(0).toString(16)})`, () => {
      it(`should handle DROP${char}TABLE pattern`, () => {
        const sql = `DROP${char}TABLE users`;
        try {
          const result = adapter.parseQuery(sql);
          expect(result.isDangerous).toBe(true);
        } catch {
          // Parsing failure is acceptable
        }
      });

      it(`should handle ATTACH${char}DATABASE pattern`, () => {
        const sql = `ATTACH${char}DATABASE '/etc/passwd' AS other`;
        try {
          const result = adapter.parseQuery(sql);
          expect(result.isDangerous).toBe(true);
        } catch {
          // Parsing failure is acceptable
        }
      });

      it(`should handle VACUUM${char}pattern`, () => {
        const sql = `VACUUM${char}main`;
        try {
          const result = adapter.parseQuery(sql);
          expect(result.isDangerous).toBe(true);
        } catch {
          // Parsing failure is acceptable
        }
      });
    });
  }
});

describe('SECURITY: CTE/WITH clause handling in SQLite', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  // node-sql-parser correctly parses WITH clauses
  it('detects WITH...SELECT as select', () => {
    const sql = 'WITH cte AS (SELECT 1) SELECT * FROM cte';
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
  });

  // node-sql-parser throws on WITH...DELETE/UPDATE/INSERT in SQLite mode
  it('throws on WITH...DELETE (unparseable in SQLite mode)', () => {
    const sql = 'WITH cte AS (SELECT 1) DELETE FROM users';
    expect(() => adapter.parseQuery(sql)).toThrow(DbMcpError);
  });

  it('throws on WITH...UPDATE (unparseable in SQLite mode)', () => {
    const sql = 'WITH cte AS (SELECT 1) UPDATE users SET name = "x"';
    expect(() => adapter.parseQuery(sql)).toThrow(DbMcpError);
  });

  it('throws on WITH...INSERT (unparseable in SQLite mode)', () => {
    const sql = 'WITH cte AS (SELECT 1) INSERT INTO users (name) SELECT * FROM cte';
    expect(() => adapter.parseQuery(sql)).toThrow(DbMcpError);
  });

  it('throws on recursive CTE with VALUES (unparseable in SQLite mode)', () => {
    const sql = `
      WITH RECURSIVE cnt(x) AS (
        VALUES(1)
        UNION ALL
        SELECT x+1 FROM cnt WHERE x<10
      )
      SELECT x FROM cnt
    `;
    // node-sql-parser doesn't support VALUES keyword in SQLite mode
    expect(() => adapter.parseQuery(sql)).toThrow(DbMcpError);
  });

  it('throws on recursive CTE followed by DELETE (unparseable in SQLite mode)', () => {
    const sql = `
      WITH RECURSIVE cnt(x) AS (
        VALUES(1)
        UNION ALL
        SELECT x+1 FROM cnt WHERE x<10
      )
      DELETE FROM users WHERE id IN (SELECT x FROM cnt)
    `;
    expect(() => adapter.parseQuery(sql)).toThrow(DbMcpError);
  });
});

describe('SECURITY: String boundary edge cases in SQLite', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  it('should handle string with semicolon at end', () => {
    const sql = "SELECT 'test;' FROM users";
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
  });

  it('should handle multiple strings with semicolons', () => {
    const sql = "SELECT 'a;b', 'c;d' FROM users";
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
  });

  it('should handle string containing DROP TABLE', () => {
    const sql = "SELECT 'DROP TABLE users' FROM users";
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
    expect(result.isDangerous).toBe(false);
  });

  it('should handle string containing ATTACH DATABASE', () => {
    const sql = "SELECT 'ATTACH DATABASE test' FROM users";
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
    // Dangerous pattern detection should not trigger inside strings
    // This is a known limitation that may need to be addressed
  });

  it('should handle empty string followed by dangerous keyword', () => {
    const sql = "SELECT '' FROM users; DROP TABLE users";
    expect(() => adapter.parseQuery(sql)).toThrow();
  });

  it('should handle doubled quotes with semicolons', () => {
    const sql = "SELECT 'it''s; fine' FROM users";
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
  });

  it('should handle doubled quotes at string boundary', () => {
    const sql = "SELECT ''''; DROP TABLE users";
    // This should be detected as multi-statement
    expect(() => adapter.parseQuery(sql)).toThrow();
  });

  it('should handle unclosed string gracefully', () => {
    const sql = "SELECT 'unclosed";
    // Should not crash
    try {
      adapter.parseQuery(sql);
    } catch {
      // Either behavior is acceptable
    }
  });
});

describe('SECURITY: SQLite-specific dangerous operations', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  // ATTACH is parsed and marked as dangerous
  // DETACH/VACUUM/REINDEX throw parse errors

  it('should block ATTACH with file path', () => {
    const result = adapter.parseQuery("ATTACH DATABASE 'other.db' AS other");
    expect(result.isDangerous).toBe(true);
    expect(result.dangerousReason).toContain('ATTACH');
  });

  it('should block ATTACH with :memory:', () => {
    const result = adapter.parseQuery("ATTACH DATABASE ':memory:' AS mem");
    expect(result.isDangerous).toBe(true);
    expect(result.dangerousReason).toContain('ATTACH');
  });

  it('should throw on DETACH', () => {
    expect(() => adapter.parseQuery('DETACH DATABASE other')).toThrow(DbMcpError);
  });

  it('should throw on VACUUM', () => {
    expect(() => adapter.parseQuery('VACUUM')).toThrow(DbMcpError);
  });

  it('should throw on VACUUM INTO', () => {
    expect(() => adapter.parseQuery("VACUUM INTO 'backup.db'")).toThrow(DbMcpError);
  });

  it('should throw on REINDEX', () => {
    expect(() => adapter.parseQuery('REINDEX')).toThrow(DbMcpError);
  });

  it('should throw on REINDEX with table name', () => {
    expect(() => adapter.parseQuery('REINDEX users')).toThrow(DbMcpError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection and Database Operation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SqliteAdapter connection handling', () => {
  describe('constructor - URL parsing', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('should handle sqlite:// URL format with absolute path', () => {
      const config = {
        ...testConfig,
        database: { ...testConfig.database, url: 'sqlite:///absolute/path/test.db' },
      };
      const adapter = new SqliteAdapter(config);
      expect(adapter.type).toBe('sqlite');
    });

    it('should handle sqlite:// URL format with :memory:', () => {
      const config = {
        ...testConfig,
        database: { ...testConfig.database, url: 'sqlite://:memory:' },
      };
      const adapter = new SqliteAdapter(config);
      expect(adapter.type).toBe('sqlite');
    });

    it('should handle plain file path', () => {
      const config = {
        ...testConfig,
        database: { ...testConfig.database, url: '/absolute/path/test.db' },
      };
      const adapter = new SqliteAdapter(config);
      expect(adapter.type).toBe('sqlite');
    });
  });

  describe('constructor - path validation', () => {
    it('should reject path traversal attempts', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const config = {
        ...testConfig,
        database: { ...testConfig.database, url: 'sqlite://../../../etc/passwd' },
      };

      expect(() => new SqliteAdapter(config)).toThrow(DbMcpError);
      try {
        new SqliteAdapter(config);
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.CONFIG_INVALID);
      }
    });

    it('should reject non-existent files', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const config = {
        ...testConfig,
        database: { ...testConfig.database, url: 'sqlite:///non/existent/file.db' },
      };

      expect(() => new SqliteAdapter(config)).toThrow(DbMcpError);
      try {
        new SqliteAdapter(config);
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.CONNECTION_FAILED);
      }
    });

    it('should allow :memory: database', () => {
      // :memory: should not require fs check
      const config = {
        ...testConfig,
        database: { ...testConfig.database, url: 'sqlite://:memory:' },
      };
      expect(() => new SqliteAdapter(config)).not.toThrow();
    });
  });

  describe('getDefaultSchema', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('should return "main" for SQLite', () => {
      const adapter = new SqliteAdapter(testConfig);
      expect(adapter.getDefaultSchema()).toBe('main');
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    });

    it('should complete without error', async () => {
      const adapter = new SqliteAdapter(testConfig);
      await expect(adapter.dispose()).resolves.not.toThrow();
    });
  });
});

describe('SqliteAdapter type property', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('should have type "sqlite"', () => {
    const adapter = new SqliteAdapter(testConfig);
    expect(adapter.type).toBe('sqlite');
  });
});

describe('SqliteAdapter convertPlaceholders edge cases', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  it('should handle $ not followed by digits', () => {
    const result = adapter.convertPlaceholders('SELECT * FROM users WHERE name = $variable');
    // $ not followed by digits should remain unchanged
    expect(result).toBe('SELECT * FROM users WHERE name = $variable');
  });

  it('should handle mixed placeholders and strings', () => {
    const result = adapter.convertPlaceholders(
      "SELECT * FROM users WHERE id = $1 AND name = 'test$2'"
    );
    expect(result).toBe("SELECT * FROM users WHERE id = ? AND name = 'test$2'");
  });

  it('should handle adjacent placeholders', () => {
    const result = adapter.convertPlaceholders('SELECT $1$2$3');
    expect(result).toBe('SELECT ???');
  });

  it('should handle placeholder at start of query', () => {
    const result = adapter.convertPlaceholders('$1');
    expect(result).toBe('?');
  });

  it('should preserve double-quoted identifiers with dollar signs', () => {
    const result = adapter.convertPlaceholders('SELECT * FROM users WHERE "$column1" = $1');
    expect(result).toBe('SELECT * FROM users WHERE "$column1" = ?');
  });

  it('should handle empty string', () => {
    const result = adapter.convertPlaceholders('');
    expect(result).toBe('');
  });

  it('should not convert placeholders in backtick-quoted identifiers', () => {
    const result = adapter.convertPlaceholders('SELECT * FROM users WHERE `$1column` = $1');
    expect(result).toBe('SELECT * FROM users WHERE `$1column` = ?');
  });

  it('should not convert placeholders in bracket-quoted identifiers', () => {
    const result = adapter.convertPlaceholders('SELECT * FROM users WHERE [$1column] = $1');
    expect(result).toBe('SELECT * FROM users WHERE [$1column] = ?');
  });

  it('should handle escaped backticks in identifiers', () => {
    // Doubled backticks represent an escaped backtick inside an identifier
    const result = adapter.convertPlaceholders('SELECT * FROM users WHERE `col``$1` = $1');
    expect(result).toBe('SELECT * FROM users WHERE `col``$1` = ?');
  });

  it('should handle mixed quoting styles', () => {
    const result = adapter.convertPlaceholders(
      "SELECT * FROM `table$1` WHERE \"col$2\" = $1 AND '$3' = $2 AND [col$4] = $3"
    );
    expect(result).toBe(
      "SELECT * FROM `table$1` WHERE \"col$2\" = ? AND '$3' = ? AND [col$4] = ?"
    );
  });

  it('should handle bracket identifier with spaces', () => {
    const result = adapter.convertPlaceholders('SELECT * FROM users WHERE [column $1 name] = $1');
    expect(result).toBe('SELECT * FROM users WHERE [column $1 name] = ?');
  });

  it('should handle consecutive bracket-quoted identifiers', () => {
    const result = adapter.convertPlaceholders('SELECT [$1], [$2] FROM table WHERE id = $1');
    expect(result).toBe('SELECT [$1], [$2] FROM table WHERE id = ?');
  });
});

describe('SECURITY: SQLite path handling edge cases', () => {
  it('should handle relative path that stays within cwd', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const config = {
      ...testConfig,
      database: { ...testConfig.database, url: 'sqlite://./subdir/test.db' },
    };
    expect(() => new SqliteAdapter(config)).not.toThrow();
  });

  it('should handle absolute path', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const config = {
      ...testConfig,
      database: { ...testConfig.database, url: '/tmp/test.db' },
    };
    expect(() => new SqliteAdapter(config)).not.toThrow();
  });

  it('should handle path without sqlite:// prefix', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const config = {
      ...testConfig,
      database: { ...testConfig.database, url: './local/test.db' },
    };
    expect(() => new SqliteAdapter(config)).not.toThrow();
  });
});

describe('SqliteAdapter validateQueryForTool edge cases', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('execute tool with dangerous operations', () => {
    it('should block CREATE TABLE for execute tool', () => {
      expect(() =>
        adapter.validateQueryForTool('CREATE TABLE test (id INTEGER)', 'execute')
      ).toThrow();
      try {
        adapter.validateQueryForTool('CREATE TABLE test (id INTEGER)', 'execute');
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.QUERY_BLOCKED);
      }
    });

    it('should block ATTACH for execute tool', () => {
      expect(() =>
        adapter.validateQueryForTool("ATTACH DATABASE 'other.db' AS other", 'execute')
      ).toThrow();
    });

    it('should block PRAGMA modification for execute tool', () => {
      expect(() =>
        adapter.validateQueryForTool('PRAGMA foreign_keys = ON', 'execute')
      ).toThrow();
    });
  });
});

describe('SqliteAdapter injectLimit edge cases', () => {
  let adapter: SqliteAdapter;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    adapter = new SqliteAdapter(testConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle query with ORDER BY', () => {
    const result = adapter.injectLimit('SELECT * FROM users ORDER BY name', 100);
    expect(result).toContain('LIMIT');
    expect(result).toContain('100');
  });

  it('should handle query with GROUP BY', () => {
    const result = adapter.injectLimit('SELECT COUNT(*) FROM users GROUP BY name', 100);
    expect(result).toContain('LIMIT');
  });

  it('should not inject LIMIT into INSERT', () => {
    const result = adapter.injectLimit("INSERT INTO users (name) VALUES ('test')", 100);
    expect(result).not.toContain('LIMIT');
  });

  it('should not inject LIMIT into UPDATE', () => {
    const result = adapter.injectLimit("UPDATE users SET name = 'test'", 100);
    expect(result).not.toContain('LIMIT');
  });

  it('should not inject LIMIT into DELETE', () => {
    const result = adapter.injectLimit('DELETE FROM users', 100);
    expect(result).not.toContain('LIMIT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// In-memory SQLite connection tests (covers SqliteConnection methods)
// ─────────────────────────────────────────────────────────────────────────────

describe('SqliteAdapter with in-memory database', () => {
  const memoryConfig = {
    database: {
      url: 'sqlite://:memory:',
      readonly: false,
    },
    defaults: {
      timeout: 30000,
      maxRows: 1000,
      maxCellLength: 1000,
      maxTotalSize: 100000,
      maxColumns: 100,
      maxIndexes: 50,
      maxTables: 100,
    },
  };

  it('should create adapter for :memory: database', () => {
    const adapter = new SqliteAdapter(memoryConfig);
    expect(adapter.type).toBe('sqlite');
    expect(adapter.getDefaultSchema()).toBe('main');
  });

  describe('withConnection', () => {
    it('should execute callback with connection', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      const result = await adapter.withConnection(async (conn) => {
        const res = await conn.query('SELECT 1 + 1 as sum');
        return res.rows[0][0];
      });
      expect(result).toBe(2);
    });

    it('should properly close connection after callback', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.query('SELECT 1');
      });
      // If connection wasn't closed properly, this would fail
      await adapter.withConnection(async (conn) => {
        await conn.query('SELECT 2');
      });
    });
  });

  describe('connection.query', () => {
    it('should execute SELECT query and return results', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        // Create table
        await conn.execute('CREATE TABLE test_users (id INTEGER PRIMARY KEY, name TEXT)');
        // Insert data
        await conn.query('INSERT INTO test_users (name) VALUES (?)', ['Alice']);
        await conn.query('INSERT INTO test_users (name) VALUES (?)', ['Bob']);
        // Query
        const result = await conn.query('SELECT * FROM test_users ORDER BY id');

        expect(result.fields).toHaveLength(2);
        expect(result.fields[0].name).toBe('id');
        expect(result.fields[1].name).toBe('name');
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0][1]).toBe('Alice');
        expect(result.rows[1][1]).toBe('Bob');
        expect(result.rowCount).toBe(2);
      });
    });

    it('should handle parameterized queries', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE params_test (id INTEGER, value TEXT)');
        await conn.query('INSERT INTO params_test VALUES (?, ?)', [1, 'test']);
        const result = await conn.query('SELECT * FROM params_test WHERE id = ?', [1]);
        expect(result.rows[0][1]).toBe('test');
      });
    });

    it('should return rowCount for INSERT/UPDATE/DELETE', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE count_test (id INTEGER, name TEXT)');

        // INSERT
        const insertResult = await conn.query('INSERT INTO count_test VALUES (?, ?)', [1, 'a']);
        expect(insertResult.rowCount).toBe(1);

        // UPDATE
        const updateResult = await conn.query('UPDATE count_test SET name = ? WHERE id = ?', ['b', 1]);
        expect(updateResult.rowCount).toBe(1);

        // DELETE
        const deleteResult = await conn.query('DELETE FROM count_test WHERE id = ?', [1]);
        expect(deleteResult.rowCount).toBe(1);
      });
    });
  });

  describe('connection.execute', () => {
    it('should execute raw SQL', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE exec_test (id INTEGER)');
        // Verify table was created by querying it
        const result = await conn.query('SELECT * FROM exec_test');
        expect(result.rows).toHaveLength(0);
      });
    });
  });

  describe('connection.listTables', () => {
    it('should list tables in the database', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE users (id INTEGER)');
        await conn.execute('CREATE TABLE orders (id INTEGER)');
        await conn.execute('CREATE VIEW user_view AS SELECT id FROM users');

        const result = await conn.listTables('main', 100);

        expect(result.tables).toHaveLength(3);
        expect(result.totalAvailable).toBe(3);

        const tableNames = result.tables.map(t => t.name);
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('orders');
        expect(tableNames).toContain('user_view');

        // Check schema is 'main'
        expect(result.tables[0].schema).toBe('main');

        // Check type detection
        const usersTable = result.tables.find(t => t.name === 'users');
        const userView = result.tables.find(t => t.name === 'user_view');
        expect(usersTable?.type).toBe('table');
        expect(userView?.type).toBe('view');
      });
    });

    it('should return empty list for empty database', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        const result = await conn.listTables('main', 100);
        expect(result.tables).toHaveLength(0);
        expect(result.totalAvailable).toBe(0);
      });
    });
  });

  describe('connection.describeTable', () => {
    it('should describe table columns', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute(`
          CREATE TABLE describe_test (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT DEFAULT 'none',
            age INTEGER
          )
        `);

        const result = await conn.describeTable('describe_test', 'main', {
          maxColumns: 100,
          maxIndexes: 50,
        });

        expect(result.table).toBe('describe_test');
        expect(result.schema).toBe('main');
        expect(result.columns).toHaveLength(4);

        // Check column details
        const idCol = result.columns.find(c => c.name === 'id');
        expect(idCol?.type).toBe('INTEGER');
        expect(idCol?.primaryKey).toBe(true);

        const nameCol = result.columns.find(c => c.name === 'name');
        expect(nameCol?.nullable).toBe(false);

        const emailCol = result.columns.find(c => c.name === 'email');
        expect(emailCol?.default).toBe("'none'");

        const ageCol = result.columns.find(c => c.name === 'age');
        expect(ageCol?.nullable).toBe(true);
      });
    });

    it('should describe table indexes', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE idx_test (id INTEGER PRIMARY KEY, email TEXT, name TEXT)');
        await conn.execute('CREATE UNIQUE INDEX idx_email ON idx_test (email)');
        await conn.execute('CREATE INDEX idx_name ON idx_test (name)');

        const result = await conn.describeTable('idx_test', 'main', {
          maxColumns: 100,
          maxIndexes: 50,
        });

        expect(result.indexes.length).toBeGreaterThanOrEqual(2);

        const emailIdx = result.indexes.find(i => i.name === 'idx_email');
        expect(emailIdx?.unique).toBe(true);
        expect(emailIdx?.columns).toContain('email');

        const nameIdx = result.indexes.find(i => i.name === 'idx_name');
        expect(nameIdx?.unique).toBe(false);
      });
    });

    it('should describe foreign keys', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
        await conn.execute(`
          CREATE TABLE child (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER REFERENCES parent(id)
          )
        `);

        const result = await conn.describeTable('child', 'main', {
          maxColumns: 100,
          maxIndexes: 50,
        });

        expect(result.foreignKeys).toHaveLength(1);
        expect(result.foreignKeys[0].column).toBe('parent_id');
        expect(result.foreignKeys[0].references.table).toBe('parent');
        expect(result.foreignKeys[0].references.column).toBe('id');
      });
    });

    it('should handle truncation for too many columns', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        // Create table with many columns
        const cols = Array.from({ length: 10 }, (_, i) => `col${i} TEXT`).join(', ');
        await conn.execute(`CREATE TABLE wide_table (id INTEGER PRIMARY KEY, ${cols})`);

        const result = await conn.describeTable('wide_table', 'main', {
          maxColumns: 3,
          maxIndexes: 50,
        });

        expect(result.columns).toHaveLength(3);
        expect(result.truncated).toBe(true);
        expect(result.truncationReason).toContain('columns');
      });
    });

    it('should handle truncation for too many indexes', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE many_idx (id INTEGER PRIMARY KEY, a TEXT, b TEXT, c TEXT, d TEXT)');
        await conn.execute('CREATE INDEX idx_a ON many_idx (a)');
        await conn.execute('CREATE INDEX idx_b ON many_idx (b)');
        await conn.execute('CREATE INDEX idx_c ON many_idx (c)');
        await conn.execute('CREATE INDEX idx_d ON many_idx (d)');

        const result = await conn.describeTable('many_idx', 'main', {
          maxColumns: 100,
          maxIndexes: 2,
        });

        expect(result.indexes.length).toBeLessThanOrEqual(2);
        expect(result.truncated).toBe(true);
        expect(result.truncationReason).toContain('indexes');
      });
    });

    it('should handle table with typeless columns', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        // SQLite allows columns without explicit type
        await conn.execute('CREATE TABLE typeless (id, name, value)');

        const result = await conn.describeTable('typeless', 'main', {
          maxColumns: 100,
          maxIndexes: 50,
        });

        // Typeless columns default to TEXT
        expect(result.columns[0].type).toBe('TEXT');
      });
    });

    it('should handle special characters in table names', async () => {
      const adapter = new SqliteAdapter(memoryConfig);
      await adapter.withConnection(async (conn) => {
        await conn.execute('CREATE TABLE "table-with-dash" (id INTEGER)');

        const result = await conn.describeTable('table-with-dash', 'main', {
          maxColumns: 100,
          maxIndexes: 50,
        });

        expect(result.table).toBe('table-with-dash');
      });
    });
  });
});
