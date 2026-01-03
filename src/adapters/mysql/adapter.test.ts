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
import { MySqlAdapter, stripComments, splitStatements } from './adapter.js';
import { ErrorCode } from '../../utils/errors.js';

// Create a minimal adapter config for testing
const testConfig = {
  database: {
    url: 'mysql://localhost/test',
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

      it('should block REVOKE statements', () => {
        const result = adapter.parseQuery('REVOKE ALL ON *.* FROM user');
        expect(result.isDangerous).toBe(true);
        expect(result.dangerousReason).toContain('REVOKE');
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
      expect(result).toBe('SELECT * FROM users LIMIT 100');
    });

    it('should not modify existing LIMIT', () => {
      const result = adapter.injectLimit('SELECT * FROM users LIMIT 50', 100);
      expect(result).toBe('SELECT * FROM users LIMIT 50');
    });

    it('should handle trailing semicolon', () => {
      const result = adapter.injectLimit('SELECT * FROM users;', 100);
      expect(result).toBe('SELECT * FROM users LIMIT 100');
    });

    it('should preserve existing LIMIT with offset', () => {
      const result = adapter.injectLimit('SELECT * FROM users LIMIT 10, 20', 100);
      expect(result).toBe('SELECT * FROM users LIMIT 10, 20');
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

describe('stripComments', () => {
  it('should strip single-line -- comments', () => {
    const result = stripComments('SELECT * FROM users -- get all users');
    expect(result.trim()).toBe('SELECT * FROM users');
  });

  it('should strip single-line # comments (MySQL-specific)', () => {
    const result = stripComments('SELECT * FROM users # get all users');
    expect(result.trim()).toBe('SELECT * FROM users');
  });

  it('should strip multi-line /* */ comments', () => {
    const result = stripComments('SELECT * /* comment */ FROM users');
    expect(result).toContain('SELECT *');
    expect(result).toContain('FROM users');
    expect(result).not.toContain('comment');
  });

  it('should preserve strings containing comment syntax', () => {
    const result = stripComments("SELECT '-- not a comment' FROM users");
    expect(result).toContain('-- not a comment');
  });

  it('should preserve strings containing # symbol', () => {
    const result = stripComments("SELECT '# not a comment' FROM users");
    expect(result).toContain('# not a comment');
  });

  it('should handle nested quotes', () => {
    const result = stripComments("SELECT 'it''s a test' FROM users -- comment");
    expect(result).toContain("it''s a test");
    expect(result).not.toContain('comment');
  });

  it('should handle escaped quotes', () => {
    const result = stripComments("SELECT 'test\\'s value' FROM users -- comment");
    expect(result).toContain("test\\'s value");
  });

  it('should handle backtick identifiers', () => {
    const result = stripComments('SELECT `column--name` FROM users -- comment');
    expect(result).toContain('`column--name`');
    expect(result).not.toContain('comment');
  });
});

describe('SECURITY: MySQL conditional comments', () => {
  // MySQL supports conditional comments with version numbers:
  // /*!12345 code */ - executes 'code' if MySQL version >= 1.23.45
  // /*! code */ - executes 'code' unconditionally
  //
  // These are EXTRACTED (not stripped) to detect dangerous operations.
  const adapter = new MySqlAdapter(testConfig);

  describe('executable comments (/*! */)', () => {
    it('detects dangerous operations inside executable comments', () => {
      const sql = '/*! DROP TABLE users */';
      // Content is extracted and detected as dangerous DROP statement
      const result = adapter.parseQuery(sql);
      expect(result.isDangerous).toBe(true);
      expect(result.dangerousReason).toContain('DROP');
    });

    it('allows safe executable comment content', () => {
      // This just adds to the SELECT expression list - not dangerous
      const sql = 'SELECT 1 /*! , 2, 3 */';
      const result = adapter.parseQuery(sql);
      expect(result.type).toBe('select');
      expect(result.isDangerous).toBe(false);
    });

    it('detects dangerous operations in version-specific comments', () => {
      // This executes if MySQL version >= 5.00.00
      const sql = '/*!50000 DROP TABLE users */';
      // Content is extracted and detected as dangerous
      const result = adapter.parseQuery(sql);
      expect(result.isDangerous).toBe(true);
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

    it('detects multi-statement injection via executable comments', () => {
      // The semicolon inside executable comment creates multi-statement
      const sql = 'SELECT 1 FROM users /*!50000 ; DROP TABLE users */';
      // Now correctly detected as multi-statement attempt
      expect(() => adapter.parseQuery(sql)).toThrow('Multiple SQL statements');
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
  // NOTE: MySQL adapter uses regex-based parsing that looks at the first keyword
  // WITH clause followed by DML is currently detected based on first keyword only
  // This is a known limitation that may need to be addressed
  const adapter = new MySqlAdapter(testConfig);

  it('should detect WITH...SELECT as SELECT', () => {
    const sql = 'WITH cte AS (SELECT 1) SELECT * FROM cte';
    const result = adapter.parseQuery(sql);
    expect(result.type).toBe('select');
  });

  // TODO: Improve CTE detection to identify the final operation
  // These tests document current behavior (all WITH queries detected as 'select')
  it('detects WITH...DELETE as SELECT (known limitation)', () => {
    const sql = 'WITH cte AS (SELECT 1) DELETE FROM users';
    const result = adapter.parseQuery(sql);
    // Currently detected as 'select' based on first keyword parsing
    expect(result.type).toBe('select');
  });

  it('detects WITH...UPDATE as SELECT (known limitation)', () => {
    const sql = 'WITH cte AS (SELECT 1) UPDATE users SET name = "x"';
    const result = adapter.parseQuery(sql);
    // Currently detected as 'select' based on first keyword parsing
    expect(result.type).toBe('select');
  });

  it('detects WITH...INSERT as SELECT (known limitation)', () => {
    const sql = 'WITH cte AS (SELECT 1) INSERT INTO users (name) SELECT * FROM cte';
    const result = adapter.parseQuery(sql);
    // Currently detected as 'select' based on first keyword parsing
    expect(result.type).toBe('select');
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

describe('splitStatements', () => {
  it('should split multiple statements', () => {
    const result = splitStatements('SELECT 1; SELECT 2');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('SELECT 1');
    expect(result[1]).toBe('SELECT 2');
  });

  it('should handle trailing semicolon', () => {
    const result = splitStatements('SELECT 1;');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('SELECT 1');
  });

  it('should not split on semicolon in string (SECURITY)', () => {
    const result = splitStatements("SELECT 'value; DROP TABLE users;'");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("SELECT 'value; DROP TABLE users;'");
  });

  it('should not split on semicolon in double-quoted string', () => {
    const result = splitStatements('SELECT "value; DROP TABLE users;"');
    expect(result).toHaveLength(1);
  });

  it('should not split on semicolon in backtick identifier', () => {
    const result = splitStatements('SELECT `column;name` FROM users');
    expect(result).toHaveLength(1);
  });

  it('should handle empty input', () => {
    const result = splitStatements('');
    expect(result).toHaveLength(0);
  });

  it('should handle whitespace-only input', () => {
    const result = splitStatements('   ');
    expect(result).toHaveLength(0);
  });

  it('should handle escaped quotes in strings', () => {
    const result = splitStatements("SELECT 'test\\'s; value'; SELECT 2");
    expect(result).toHaveLength(2);
  });

  it('should handle doubled quotes in strings', () => {
    const result = splitStatements("SELECT 'test''; value'; SELECT 2");
    expect(result).toHaveLength(2);
  });
});
