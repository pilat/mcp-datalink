/**
 * Tests for validation utilities
 */

import { describe, expect, it } from 'vitest';

import { countPlaceholders, validateParamCount } from './validation.js';
import { DbMcpError, ErrorCode } from './errors.js';

describe('countPlaceholders', () => {
  it('should count single placeholder', () => {
    expect(countPlaceholders('SELECT * FROM users WHERE id = $1')).toBe(1);
  });

  it('should count multiple unique placeholders', () => {
    expect(countPlaceholders('SELECT * FROM users WHERE id = $1 AND name = $2')).toBe(2);
  });

  it('should count reused placeholders as one', () => {
    expect(countPlaceholders('SELECT * FROM users WHERE id = $1 OR parent_id = $1')).toBe(1);
  });

  it('should handle non-sequential placeholders', () => {
    expect(countPlaceholders('SELECT * FROM users WHERE id = $1 AND age = $3')).toBe(2);
  });

  it('should return 0 for query without placeholders', () => {
    expect(countPlaceholders('SELECT * FROM users')).toBe(0);
  });

  it('should ignore placeholders inside single-quoted strings', () => {
    expect(countPlaceholders("SELECT * FROM users WHERE name = '$1'")).toBe(0);
  });

  it('should ignore placeholders inside double-quoted strings', () => {
    expect(countPlaceholders('SELECT * FROM users WHERE "column$1" = $1')).toBe(1);
  });

  it('should handle escaped single quotes in strings', () => {
    expect(countPlaceholders("SELECT * FROM users WHERE name = 'O''Brien $1' AND id = $1")).toBe(1);
  });

  it('should handle escaped double quotes in strings', () => {
    expect(countPlaceholders('SELECT * FROM users WHERE "col""$1" = $1')).toBe(1);
  });

  it('should handle complex query with multiple placeholders and strings', () => {
    const sql = `
      SELECT * FROM users
      WHERE name = $1
      AND description LIKE '%$2%'
      AND status = $2
      AND note = 'contains $3 text'
    `;
    expect(countPlaceholders(sql)).toBe(2);
  });

  it('should handle empty string', () => {
    expect(countPlaceholders('')).toBe(0);
  });

  it('should handle $ without number', () => {
    expect(countPlaceholders('SELECT $amount FROM prices WHERE id = $1')).toBe(1);
  });

  it('should handle large placeholder numbers', () => {
    expect(countPlaceholders('SELECT * FROM t WHERE a = $1 AND b = $10 AND c = $100')).toBe(3);
  });
});

describe('validateParamCount', () => {
  it('should not throw when counts match', () => {
    expect(() => validateParamCount('SELECT * FROM users WHERE id = $1', ['123'])).not.toThrow();
  });

  it('should not throw when counts match with multiple params', () => {
    expect(() =>
      validateParamCount('SELECT * FROM users WHERE id = $1 AND name = $2', ['123', 'John'])
    ).not.toThrow();
  });

  it('should not throw for query without placeholders and empty params', () => {
    expect(() => validateParamCount('SELECT * FROM users', [])).not.toThrow();
  });

  it('should throw when fewer params than placeholders', () => {
    try {
      validateParamCount('SELECT * FROM users WHERE id = $1 AND name = $2', ['123']);
      expect.fail('Expected an error to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DbMcpError);
      const dbError = error as DbMcpError;
      expect(dbError.code).toBe(ErrorCode.INVALID_SQL);
      expect(dbError.message).toBe('Query has 2 placeholders but 1 parameter provided');
      expect(dbError.details).toEqual({
        sql: 'SELECT * FROM users WHERE id = $1 AND name = $2',
        placeholderCount: 2,
        paramCount: 1,
      });
    }
  });

  it('should throw when more params than placeholders', () => {
    try {
      validateParamCount('SELECT * FROM users WHERE id = $1', ['123', 'extra']);
      expect.fail('Expected an error to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DbMcpError);
      const dbError = error as DbMcpError;
      expect(dbError.code).toBe(ErrorCode.INVALID_SQL);
      expect(dbError.message).toBe('Query has 1 placeholder but 2 parameters provided');
    }
  });

  it('should throw when params provided but no placeholders', () => {
    try {
      validateParamCount('SELECT * FROM users', ['123']);
      expect.fail('Expected an error to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DbMcpError);
      const dbError = error as DbMcpError;
      expect(dbError.code).toBe(ErrorCode.INVALID_SQL);
      expect(dbError.message).toBe('Query has 0 placeholders but 1 parameter provided');
    }
  });

  it('should throw when placeholders exist but no params', () => {
    try {
      validateParamCount('SELECT * FROM users WHERE id = $1', []);
      expect.fail('Expected an error to be thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DbMcpError);
      const dbError = error as DbMcpError;
      expect(dbError.code).toBe(ErrorCode.INVALID_SQL);
      expect(dbError.message).toBe('Query has 1 placeholder but 0 parameters provided');
    }
  });

  it('should handle reused placeholders correctly', () => {
    // $1 is used twice, so we only need 1 parameter
    expect(() =>
      validateParamCount('SELECT * FROM users WHERE id = $1 OR parent_id = $1', ['123'])
    ).not.toThrow();
  });
});
