import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorCode } from '../utils/errors.js';
import { loadConfig, expandEnvVariables } from './loader.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear any DATALINK_ env vars
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('DATALINK_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('DATALINK_{NAME}_URL pattern', () => {
    it('should create database from env var', () => {
      process.env.DATALINK_MAIN_URL = 'postgresql://localhost/main';

      const result = loadConfig();

      expect(result.databases.main).toEqual({
        url: 'postgresql://localhost/main',
        readonly: false,
      });
    });

    it('should create multiple databases from env vars', () => {
      process.env.DATALINK_MAIN_URL = 'postgresql://localhost/main';
      process.env.DATALINK_ANALYTICS_URL = 'mysql://localhost/analytics';

      const result = loadConfig();

      expect(result.databases.main.url).toBe('postgresql://localhost/main');
      expect(result.databases.analytics.url).toBe('mysql://localhost/analytics');
    });

    it('should convert database name to lowercase', () => {
      process.env.DATALINK_MY_DATABASE_URL = 'postgresql://localhost/test';

      const result = loadConfig();

      expect(result.databases['my_database']).toBeDefined();
      expect(result.databases['MY_DATABASE']).toBeUndefined();
    });
  });

  describe('DATALINK_{NAME}_READONLY', () => {
    it('should set readonly=true when READONLY=true', () => {
      process.env.DATALINK_PROD_URL = 'postgresql://localhost/prod';
      process.env.DATALINK_PROD_READONLY = 'true';

      const result = loadConfig();

      expect(result.databases.prod.readonly).toBe(true);
    });

    it('should set readonly=true when READONLY=1', () => {
      process.env.DATALINK_PROD_URL = 'postgresql://localhost/prod';
      process.env.DATALINK_PROD_READONLY = '1';

      const result = loadConfig();

      expect(result.databases.prod.readonly).toBe(true);
    });

    it('should set readonly=false when READONLY not set', () => {
      process.env.DATALINK_DEV_URL = 'postgresql://localhost/dev';

      const result = loadConfig();

      expect(result.databases.dev.readonly).toBe(false);
    });

    it('should set readonly=false for other values', () => {
      process.env.DATALINK_DEV_URL = 'postgresql://localhost/dev';
      process.env.DATALINK_DEV_READONLY = 'false';

      const result = loadConfig();

      expect(result.databases.dev.readonly).toBe(false);
    });
  });

  describe('defaults', () => {
    it('should apply default values', () => {
      process.env.DATALINK_TEST_URL = 'postgresql://localhost/test';

      const result = loadConfig();

      expect(result.defaults).toEqual({
        maxRows: 100,
        maxCellLength: 500,
        maxTotalSize: 65536,
        maxColumns: 50,
        maxTables: 200,
        maxIndexes: 20,
        timeout: 30000,
      });
    });
  });

  describe('validation', () => {
    it('should throw CONFIG_NOT_FOUND if no databases configured', () => {
      expect(() => loadConfig()).toThrow(
        expect.objectContaining({
          code: ErrorCode.CONFIG_NOT_FOUND,
          message: expect.stringContaining('No databases configured'),
        })
      );
    });

    it('should throw CONFIG_NOT_FOUND with helpful message', () => {
      expect(() => loadConfig()).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('DATALINK_{NAME}_URL'),
        })
      );
    });
  });

  describe('environment variable substitution', () => {
    it('should expand ${VAR} in URL', () => {
      process.env.DATABASE_HOST = 'myhost.example.com';
      process.env.DATALINK_MAIN_URL = 'postgresql://user:pass@${DATABASE_HOST}:5432/db';

      const result = loadConfig();

      expect(result.databases.main.url).toBe('postgresql://user:pass@myhost.example.com:5432/db');
    });

    it('should expand multiple variables in URL', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '5432';
      process.env.DB_NAME = 'testdb';
      process.env.DATALINK_MAIN_URL = 'postgresql://user:pass@${DB_HOST}:${DB_PORT}/${DB_NAME}';

      const result = loadConfig();

      expect(result.databases.main.url).toBe('postgresql://user:pass@localhost:5432/testdb');
    });

    it('should expand full URL from variable', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
      process.env.DATALINK_MAIN_URL = '${DATABASE_URL}';

      const result = loadConfig();

      expect(result.databases.main.url).toBe('postgresql://user:pass@host:5432/db');
    });
  });
});

describe('expandEnvVariables', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return string unchanged if no variables', () => {
    expect(expandEnvVariables('plain string')).toBe('plain string');
  });

  it('should expand ${VAR} syntax', () => {
    process.env.MY_VAR = 'expanded_value';

    expect(expandEnvVariables('prefix_${MY_VAR}_suffix')).toBe('prefix_expanded_value_suffix');
  });

  it('should expand multiple variables', () => {
    process.env.VAR1 = 'one';
    process.env.VAR2 = 'two';

    expect(expandEnvVariables('${VAR1}-${VAR2}')).toBe('one-two');
  });

  it('should use default value when variable not set', () => {
    expect(expandEnvVariables('${UNSET_VAR:-default_value}')).toBe('default_value');
  });

  it('should prefer env value over default', () => {
    process.env.SET_VAR = 'actual_value';

    expect(expandEnvVariables('${SET_VAR:-default_value}')).toBe('actual_value');
  });

  it('should keep original syntax for unset var without default', () => {
    expect(expandEnvVariables('${UNSET_VAR}')).toBe('${UNSET_VAR}');
  });

  it('should handle empty default value', () => {
    expect(expandEnvVariables('${UNSET_VAR:-}')).toBe('');
  });

  it('should handle empty env value (not undefined)', () => {
    process.env.EMPTY_VAR = '';

    expect(expandEnvVariables('${EMPTY_VAR:-default}')).toBe('');
  });

  it('should handle variable names with underscores and numbers', () => {
    process.env.MY_VAR_123 = 'value';

    expect(expandEnvVariables('${MY_VAR_123}')).toBe('value');
  });

  it('should not expand $VAR syntax (only ${VAR})', () => {
    process.env.MY_VAR = 'value';

    expect(expandEnvVariables('$MY_VAR')).toBe('$MY_VAR');
  });

  it('should handle complex URL with multiple substitutions', () => {
    process.env.DB_USER = 'admin';
    process.env.DB_PASS = 'secret';
    process.env.DB_HOST = 'db.example.com';

    const input = 'postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/mydb';
    const expected = 'postgresql://admin:secret@db.example.com:5432/mydb';

    expect(expandEnvVariables(input)).toBe(expected);
  });
});
