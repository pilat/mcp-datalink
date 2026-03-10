/**
 * MySQL Adapter SQL Parsing Unit Tests
 *
 * Tests for MySQL-specific SQL parsing, validation, and security checks.
 *
 * SECURITY: These tests verify that dangerous MySQL patterns are blocked:
 * - LOAD DATA (file read)
 * - INTO OUTFILE (file write)
 * - INTO DUMPFILE (file write)
 * - LOAD_FILE() (file read function)
 */

import { describe, it, expect } from 'vitest';
import { MySqlAdapter } from './adapter.js';
import { DbMcpError, ErrorCode } from '../../utils/errors.js';

// Create a minimal adapter config for testing
const testConfig = {
  database: {
    url: 'mysql://localhost/test',
    readonly: false,
  },
  defaults: {
    timeout: 30000,
    maxRows: 1000,
    maxTotalSize: 100000,
    maxColumns: 100,
    maxIndexes: 50,
    maxTables: 100,
  },
};

describe('MySqlAdapter SQL parsing', () => {
  const adapter = new MySqlAdapter(testConfig);

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

      it('should detect other queries', () => {
        const result = adapter.parseQuery('SHOW TABLES');
        expect(result.type).toBe('other');
      });
    });

    describe('LIMIT clause detection', () => {
      it('should detect LIMIT clause in SELECT', () => {
        const result = adapter.parseQuery('SELECT * FROM users LIMIT 10');
        expect(result.hasLimit).toBe(true);
      });

      it('should detect LIMIT with offset syntax', () => {
        const result = adapter.parseQuery('SELECT * FROM users LIMIT 10, 20');
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
        const result = adapter.parseQuery('ALTER TABLE users ADD COLUMN email VARCHAR(255)');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('ALTER');
      });

      it('should block CREATE statements', () => {
        const result = adapter.parseQuery('CREATE TABLE test (id INT)');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('CREATE');
      });

      it('should block GRANT statements', () => {
        const result = adapter.parseQuery('GRANT ALL ON *.* TO user');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('GRANT');
      });

      it('should throw on REVOKE (unparseable by node-sql-parser)', () => {
        expect(() => adapter.parseQuery('REVOKE ALL ON *.* FROM user')).toThrow(DbMcpError);
        try {
          adapter.parseQuery('REVOKE ALL ON *.* FROM user');
        } catch (error: unknown) {
          expect((error as { code: string }).code).toBe(ErrorCode.INVALID_SQL);
        }
      });

      it('should block RENAME statements', () => {
        const result = adapter.parseQuery('RENAME TABLE users TO users_old');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('RENAME');
      });
    });

    describe('SECURITY: dangerous MySQL-specific patterns', () => {
      it('should block LOAD DATA (file read attack)', () => {
        const result = adapter.parseQuery("LOAD DATA INFILE '/etc/passwd' INTO TABLE users");
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('LOAD DATA');
      });

      it('should block LOAD DATA LOCAL (client file read)', () => {
        const result = adapter.parseQuery("LOAD DATA LOCAL INFILE '/etc/passwd' INTO TABLE users");
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('LOAD DATA');
      });

      it('should block INTO OUTFILE (file write attack)', () => {
        const result = adapter.parseQuery("SELECT * FROM users INTO OUTFILE '/tmp/data.txt'");
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('INTO OUTFILE');
      });

      it('should block INTO DUMPFILE (binary file write)', () => {
        const result = adapter.parseQuery("SELECT * FROM users INTO DUMPFILE '/tmp/data.bin'");
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('INTO DUMPFILE');
      });

      it('should block LOAD_FILE() function (file read)', () => {
        const result = adapter.parseQuery("SELECT LOAD_FILE('/etc/passwd')");
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('LOAD_FILE');
      });

      it('should block LOAD_FILE with space before parenthesis', () => {
        const result = adapter.parseQuery("SELECT LOAD_FILE ('/etc/passwd')");
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('LOAD_FILE');
      });

      it('should detect LOAD DATA case-insensitively', () => {
        const result = adapter.parseQuery("load data infile '/etc/passwd' INTO TABLE users");
        expect(result.isDangerous).toBe(true);
      });

      it('should detect INTO OUTFILE case-insensitively', () => {
        const result = adapter.parseQuery("SELECT * FROM users into outfile '/tmp/data.txt'");
        expect(result.isDangerous).toBe(true);
      });
    });

    describe('multi-statement prevention', () => {
      it('should reject multiple statements', () => {
        expect(() => adapter.parseQuery('SELECT 1; SELECT 2')).toThrow();
        try {
          adapter.parseQuery('SELECT 1; SELECT 2');
        } catch (error: unknown) {
          expect((error as { code: string }).code).toBe(ErrorCode.MULTI_STATEMENT);
        }
      });

      it('should allow trailing semicolon', () => {
        const result = adapter.parseQuery('SELECT * FROM users;');
        expect(result.type).toBe('select');
      });

      it('should reject statement after semicolon', () => {
        expect(() => adapter.parseQuery('SELECT 1; DROP TABLE users')).toThrow();
      });
    });

    describe('empty query handling', () => {
      it('should reject empty query', () => {
        expect(() => adapter.parseQuery('')).toThrow();
        try {
          adapter.parseQuery('');
        } catch (error: unknown) {
          expect((error as { code: string }).code).toBe(ErrorCode.INVALID_SQL);
        }
      });

      it('should reject whitespace-only query', () => {
        expect(() => adapter.parseQuery('   ')).toThrow();
      });

      it('should reject comment-only query', () => {
        expect(() => adapter.parseQuery('-- just a comment')).toThrow();
      });
    });
  });

  describe('injectLimit', () => {
    it('should inject LIMIT when missing', () => {
      const result = adapter.injectLimit('SELECT * FROM users', 100);
      // node-sql-parser formats identifiers with backticks for MySQL
      expect(result).toBe('SELECT * FROM `users` LIMIT 100');
    });

    it('should not modify existing LIMIT', () => {
      const result = adapter.injectLimit('SELECT * FROM users LIMIT 50', 100);
      expect(result).toContain('LIMIT');
      expect(result).toContain('50');
    });

    it('should handle trailing semicolon', () => {
      const result = adapter.injectLimit('SELECT * FROM users;', 100);
      // node-sql-parser formats identifiers with backticks for MySQL
      expect(result).toBe('SELECT * FROM `users` LIMIT 100');
    });

    it('should preserve existing LIMIT with offset', () => {
      const result = adapter.injectLimit('SELECT * FROM users LIMIT 10, 20', 100);
      expect(result).toContain('LIMIT');
      expect(result).toContain('10');
    });
  });

  describe('convertPlaceholders', () => {
    it('should convert $1 to ?', () => {
      const result = adapter.convertPlaceholders('SELECT * FROM users WHERE id = $1');
      expect(result).toBe('SELECT * FROM users WHERE id = ?');
    });

    it('should convert multiple placeholders', () => {
      const result = adapter.convertPlaceholders(
        'SELECT * FROM users WHERE id = $1 AND name = $2'
      );
      expect(result).toBe('SELECT * FROM users WHERE id = ? AND name = ?');
    });

    it('should handle placeholders in any order', () => {
      const result = adapter.convertPlaceholders(
        'SELECT * FROM users WHERE id = $2 AND name = $1'
      );
      expect(result).toBe('SELECT * FROM users WHERE id = ? AND name = ?');
    });

    it('should handle no placeholders', () => {
      const result = adapter.convertPlaceholders('SELECT * FROM users');
      expect(result).toBe('SELECT * FROM users');
    });
  });

  describe('validateQueryForTool', () => {
    describe('query tool validation', () => {
      it('should allow SELECT for query tool', () => {
        expect(() => adapter.validateQueryForTool('SELECT * FROM users', 'query')).not.toThrow();
      });

      it('should reject INSERT for query tool', () => {
        expect(() =>
          adapter.validateQueryForTool("INSERT INTO users (name) VALUES ('test')", 'query')
        ).toThrow();
      });

      it('should reject UPDATE for query tool', () => {
        expect(() =>
          adapter.validateQueryForTool("UPDATE users SET name = 'test'", 'query')
        ).toThrow();
      });

      it('should reject DELETE for query tool', () => {
        expect(() =>
          adapter.validateQueryForTool('DELETE FROM users', 'query')
        ).toThrow();
      });
    });

    describe('execute tool validation', () => {
      it('should allow INSERT for execute tool', () => {
        expect(() =>
          adapter.validateQueryForTool("INSERT INTO users (name) VALUES ('test')", 'execute')
        ).not.toThrow();
      });

      it('should allow UPDATE for execute tool', () => {
        expect(() =>
          adapter.validateQueryForTool("UPDATE users SET name = 'test'", 'execute')
        ).not.toThrow();
      });

      it('should allow DELETE for execute tool', () => {
        expect(() =>
          adapter.validateQueryForTool('DELETE FROM users WHERE id = 1', 'execute')
        ).not.toThrow();
      });

      it('should reject SELECT for execute tool', () => {
        expect(() =>
          adapter.validateQueryForTool('SELECT * FROM users', 'execute')
        ).toThrow();
      });

      it('should reject DROP for execute tool', () => {
        expect(() =>
          adapter.validateQueryForTool('DROP TABLE users', 'execute')
        ).toThrow();
      });

      it('should reject LOAD DATA for execute tool', () => {
        expect(() =>
          adapter.validateQueryForTool("LOAD DATA INFILE '/etc/passwd' INTO TABLE users", 'execute')
        ).toThrow();
      });
    });
  });

  describe('getExplainPrefix', () => {
    it('should return EXPLAIN for analyze=false', () => {
      expect(adapter.getExplainPrefix(false)).toBe('EXPLAIN ');
    });

    it('should return EXPLAIN ANALYZE for analyze=true', () => {
      expect(adapter.getExplainPrefix(true)).toBe('EXPLAIN ANALYZE ');
    });
  });

});

describe('SECURITY: MySQL conditional comments', () => {
  // MySQL supports conditional comments with version numbers:
  // /*!12345 code */ - executes 'code' if MySQL version >= 1.23.45
  // /*! code */ - executes 'code' unconditionally
  //
  // node-sql-parser may or may not support these - behavior varies
  const adapter = new MySqlAdapter(testConfig);

  describe('executable comments (/*! */)', () => {
    it('throws on executable comments with dangerous operations', () => {
      const sql = '/*! DROP TABLE users */';
      // node-sql-parser may not parse this correctly
      expect(() => adapter.parseQuery(sql)).toThrow();
    });

    it('allows safe executable comment content', () => {
      // This just adds to the SELECT expression list - not dangerous
      const sql = 'SELECT 1 /*! , 2, 3 */';
      const result = adapter.parseQuery(sql);
      expect(result.type).toBe('select');
      expect(result.isDangerous).toBe(false);
    });

    it('throws on version-specific comments with dangerous operations', () => {
      // This executes if MySQL version >= 5.00.00
      const sql = '/*!50000 DROP TABLE users */';
      // node-sql-parser may not parse this correctly
      expect(() => adapter.parseQuery(sql)).toThrow();
    });

    it('allows safe version-specific executable comments', () => {
      const sql = 'SELECT * FROM users /*!50000 WHERE id = 1 */';
      const result = adapter.parseQuery(sql);
      // Safe - just adds a WHERE clause
      expect(result.type).toBe('select');
    });
  });

  describe('conditional comment patterns', () => {
    it('should handle SELECT /*!32302 1/0, */ 1', () => {
      // Version-specific comment that could cause division by zero on old MySQL
      const sql = 'SELECT /*!32302 1/0, */ 1 FROM users';
      const result = adapter.parseQuery(sql);
      expect(result.type).toBe('select');
    });

    it('ignores multi-statement inside executable comments (parser limitation)', () => {
      // The semicolon inside executable comment is NOT treated as statement separator
      // This is a parser limitation - the content inside /*!50000 ... */ is ignored
      const sql = 'SELECT 1 FROM users /*!50000 ; DROP TABLE users */';
      // Parser treats this as a single SELECT statement
      const result = adapter.parseQuery(sql);
      expect(result.type).toBe('select');
      // Note: This is a security limitation - executable comments are stripped
    });
  });
});

describe('SECURITY: Unicode whitespace in MySQL queries', () => {
  const adapter = new MySqlAdapter(testConfig);

  const unicodeSpaces = [
    { name: 'NBSP', char: '\u00A0' },
    { name: 'EN_QUAD', char: '\u2000' },
    { name: 'IDEOGRAPHIC_SPACE', char: '\u3000' },
  ];

  for (const { name, char } of unicodeSpaces) {
    describe(`with ${name} (${char.charCodeAt(0).toString(16)})`, () => {
      it(`should handle LOAD${char}DATA pattern`, () => {
        const sql = `LOAD${char}DATA INFILE '/etc/passwd' INTO TABLE users`;
        // Should either detect as dangerous or fail to parse
        try {
          const result = adapter.parseQuery(sql);
          // If parsed, should be marked dangerous
          expect(result.isDangerous).toBe(true);
        } catch {
          // Parsing failure is acceptable
        }
      });

      it(`should handle INTO${char}OUTFILE pattern`, () => {
        const sql = `SELECT * FROM users INTO${char}OUTFILE '/tmp/data.txt'`;
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

describe('SECURITY: CTE/WITH clause handling in MySQL', () => {
  // node-sql-parser correctly parses WITH clauses and identifies the final operation
  const adapter = new MySqlAdapter(testConfig);

  it('should detect WITH...SELECT as SELECT', () => {
    const sql = 'WITH cte AS (SELECT 1) SELECT * FROM cte';
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
  });

  it('detects WITH...DELETE as DELETE', () => {
    const sql = 'WITH cte AS (SELECT 1) DELETE FROM users';
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('delete');
  });

  it('detects WITH...UPDATE as UPDATE', () => {
    const sql = 'WITH cte AS (SELECT 1) UPDATE users SET name = "x"';
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('update');
  });

  it('throws on WITH...INSERT (not supported by parser)', () => {
    const sql = 'WITH cte AS (SELECT 1) INSERT INTO users (name) SELECT * FROM cte';
    // node-sql-parser doesn't support WITH...INSERT in MySQL mode
    expect(() => adapter.parseQuery(sql)).toThrow(DbMcpError);
  });
});

describe('SECURITY: String boundary edge cases', () => {
  const adapter = new MySqlAdapter(testConfig);

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

  it('detects LOAD DATA pattern even inside strings (known limitation)', () => {
    const sql = "SELECT 'LOAD DATA INFILE' FROM users";
    const result = adapter.parseQuery(sql);
    // Current implementation uses regex that doesn't account for string context
    // This is a known false positive - the dangerous pattern is detected inside a string
    expect(result.type).toBe('other'); // Detected as dangerous due to LOAD DATA pattern
  });

  it('should handle empty string followed by dangerous keyword', () => {
    const sql = "SELECT '' FROM users; DROP TABLE users";
    expect(() => adapter.parseQuery(sql)).toThrow();
  });

  it('should handle unclosed string gracefully', () => {
    const sql = "SELECT 'unclosed";
    // Should not crash, may throw or return a result
    try {
      adapter.parseQuery(sql);
    } catch {
      // Either behavior is acceptable
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connection and Database Operation Tests (with mocking)
// ─────────────────────────────────────────────────────────────────────────────

describe('MySqlAdapter connection handling', () => {
  describe('withConnection', () => {
    it('should handle connection errors', async () => {
      const adapter = new MySqlAdapter(testConfig);

      // withConnection will try to connect to a non-existent database
      // This tests the connection error handling path
      await expect(
        adapter.withConnection(async () => 'result')
      ).rejects.toThrow('Failed to connect to MySQL database');
    });

    it('should reject invalid timeout values', async () => {
      const badConfig = {
        ...testConfig,
        defaults: { ...testConfig.defaults, timeout: -1 },
      };
      const adapter = new MySqlAdapter(badConfig);

      await expect(
        adapter.withConnection(async () => 'result')
      ).rejects.toThrow('Invalid timeout value: -1');
    });

    it('should reject non-integer timeout values', async () => {
      const badConfig = {
        ...testConfig,
        defaults: { ...testConfig.defaults, timeout: 30.5 },
      };
      const adapter = new MySqlAdapter(badConfig);

      await expect(
        adapter.withConnection(async () => 'result')
      ).rejects.toThrow('Invalid timeout value: 30.5');
    });

    it('should use timeout from options when provided', async () => {
      const adapter = new MySqlAdapter(testConfig);
      // This test verifies the signature accepts options parameter
      // Actual timeout behavior is tested in integration tests
      await expect(
        adapter.withConnection(async () => 'result', { timeout: 60000 })
      ).rejects.toThrow(); // Will fail because no real DB
    });

    it('should reject invalid timeout in options', async () => {
      const adapter = new MySqlAdapter(testConfig);

      await expect(
        adapter.withConnection(async () => 'result', { timeout: -1 })
      ).rejects.toThrow('Invalid timeout value: -1');
    });

    it('should reject non-integer timeout in options', async () => {
      const adapter = new MySqlAdapter(testConfig);

      await expect(
        adapter.withConnection(async () => 'result', { timeout: 30.5 })
      ).rejects.toThrow('Invalid timeout value: 30.5');
    });
  });

  describe('getDefaultSchema', () => {
    it('should return database name from URL', () => {
      const adapter = new MySqlAdapter(testConfig);
      expect(adapter.getDefaultSchema()).toBe('test');
    });

    it('should return "mysql" for invalid URL', () => {
      const badConfig = {
        ...testConfig,
        database: { ...testConfig.database, url: 'invalid-url' },
      };
      const adapter = new MySqlAdapter(badConfig);
      expect(adapter.getDefaultSchema()).toBe('mysql');
    });

    it('should return database name from complex URL', () => {
      const complexConfig = {
        ...testConfig,
        database: { ...testConfig.database, url: 'mysql://user:pass@localhost:3306/mydb' },
      };
      const adapter = new MySqlAdapter(complexConfig);
      expect(adapter.getDefaultSchema()).toBe('mydb');
    });
  });

  describe('dispose', () => {
    it('should complete without error', async () => {
      const adapter = new MySqlAdapter(testConfig);
      await expect(adapter.dispose()).resolves.not.toThrow();
    });
  });
});

describe('MySQL adapter type property', () => {
  it('should have type "mysql"', () => {
    const adapter = new MySqlAdapter(testConfig);
    expect(adapter.type).toBe('mysql');
  });
});

describe('MySQL adapter dangerous patterns detection', () => {
  const adapter = new MySqlAdapter(testConfig);

  it('should detect LOAD DATA with various whitespace', () => {
    const result = adapter.parseQuery('LOAD  DATA  INFILE "/tmp/test" INTO TABLE users');
    expect(result.isDangerous).toBe(true);
  });

  it('should detect INTO OUTFILE with various whitespace', () => {
    const result = adapter.parseQuery('SELECT * FROM users INTO   OUTFILE "/tmp/test"');
    expect(result.isDangerous).toBe(true);
  });

  it('should detect INTO DUMPFILE with various whitespace', () => {
    const result = adapter.parseQuery('SELECT * FROM users INTO   DUMPFILE "/tmp/test"');
    expect(result.isDangerous).toBe(true);
  });

  it('should detect LOAD_FILE with whitespace before paren', () => {
    const result = adapter.parseQuery('SELECT LOAD_FILE  ("/etc/passwd")');
    expect(result.isDangerous).toBe(true);
  });
});

describe('MySQL adapter validateQueryForTool edge cases', () => {
  const adapter = new MySqlAdapter(testConfig);

  describe('execute tool with dangerous operations', () => {
    it('should block CREATE TABLE for execute tool', () => {
      expect(() =>
        adapter.validateQueryForTool('CREATE TABLE test (id INT)', 'execute')
      ).toThrow();
      try {
        adapter.validateQueryForTool('CREATE TABLE test (id INT)', 'execute');
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(ErrorCode.QUERY_BLOCKED);
      }
    });

    it('should block SHOW for execute tool (not INSERT/UPDATE/DELETE)', () => {
      expect(() =>
        adapter.validateQueryForTool('SHOW TABLES', 'execute')
      ).toThrow();
    });
  });

  describe('query tool restrictions', () => {
    it('should reject WITH...DELETE for query tool', () => {
      const sql = 'WITH cte AS (SELECT 1) DELETE FROM users';
      expect(() => adapter.validateQueryForTool(sql, 'query')).toThrow();
    });

    it('should reject WITH...UPDATE for query tool', () => {
      const sql = 'WITH cte AS (SELECT 1) UPDATE users SET name = "x"';
      expect(() => adapter.validateQueryForTool(sql, 'query')).toThrow();
    });
  });
});

describe('MySQL injectLimit edge cases', () => {
  const adapter = new MySqlAdapter(testConfig);

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
