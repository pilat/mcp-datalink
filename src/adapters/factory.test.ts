/**
 * Tests for database adapter factory
 */

import { describe, it, expect } from 'vitest';
import { createAdapter, isSupportedUrl, isImplemented } from './factory.js';
import { PostgreSqlAdapter } from './postgresql/adapter.js';
import { MySqlAdapter } from './mysql/adapter.js';
import { SqliteAdapter } from './sqlite/adapter.js';

const defaults = {
  timeout: 30000,
  maxRows: 1000,
  maxColumns: 50,
  maxIndexes: 20,
  maxTables: 200,
};

describe('createAdapter', () => {
  describe('PostgreSQL', () => {
    it('creates PostgreSqlAdapter for postgresql:// URL', () => {
      const adapter = createAdapter(
        { url: 'postgresql://localhost/test', readonly: false },
        defaults
      );
      expect(adapter).toBeInstanceOf(PostgreSqlAdapter);
      expect(adapter.type).toBe('postgresql');
    });

    it('creates PostgreSqlAdapter for postgres:// URL', () => {
      const adapter = createAdapter(
        { url: 'postgres://localhost/test', readonly: false },
        defaults
      );
      expect(adapter).toBeInstanceOf(PostgreSqlAdapter);
    });
  });

  describe('MySQL', () => {
    it('creates MySqlAdapter for mysql:// URL', () => {
      const adapter = createAdapter(
        { url: 'mysql://localhost/test', readonly: false },
        defaults
      );
      expect(adapter).toBeInstanceOf(MySqlAdapter);
      expect(adapter.type).toBe('mysql');
    });
  });

  describe('SQLite', () => {
    it('creates SqliteAdapter for sqlite://:memory: URL', () => {
      const adapter = createAdapter(
        { url: 'sqlite://:memory:', readonly: false },
        defaults
      );
      expect(adapter).toBeInstanceOf(SqliteAdapter);
      expect(adapter.type).toBe('sqlite');
    });
  });

  describe('unsupported URLs', () => {
    it('throws for unknown scheme', () => {
      expect(() =>
        createAdapter({ url: 'mongodb://localhost/test', readonly: false }, defaults)
      ).toThrow('Unknown database URL scheme');
    });

    it('throws for random string', () => {
      expect(() =>
        createAdapter({ url: 'not-a-valid-url', readonly: false }, defaults)
      ).toThrow('Unknown database URL scheme');
    });
  });
});

describe('isSupportedUrl', () => {
  it('returns true for postgresql://', () => {
    expect(isSupportedUrl('postgresql://localhost/db')).toBe(true);
  });

  it('returns true for postgres://', () => {
    expect(isSupportedUrl('postgres://localhost/db')).toBe(true);
  });

  it('returns true for mysql://', () => {
    expect(isSupportedUrl('mysql://localhost/db')).toBe(true);
  });

  it('returns true for sqlite://', () => {
    expect(isSupportedUrl('sqlite:///path/to/db')).toBe(true);
  });

  it('returns true for .db file', () => {
    expect(isSupportedUrl('/path/to/file.db')).toBe(true);
  });

  it('returns false for mongodb://', () => {
    expect(isSupportedUrl('mongodb://localhost/db')).toBe(false);
  });

  it('returns false for random string', () => {
    expect(isSupportedUrl('random-string')).toBe(false);
  });
});

describe('isImplemented', () => {
  it('returns true for postgresql://', () => {
    expect(isImplemented('postgresql://localhost/db')).toBe(true);
  });

  it('returns true for mysql://', () => {
    expect(isImplemented('mysql://localhost/db')).toBe(true);
  });

  it('returns true for sqlite://', () => {
    expect(isImplemented('sqlite:///path/to/db')).toBe(true);
  });

  it('returns false for unsupported URL', () => {
    expect(isImplemented('mongodb://localhost/db')).toBe(false);
  });
});
