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
