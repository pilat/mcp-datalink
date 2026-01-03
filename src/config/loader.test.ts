import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorCode } from '../utils/errors.js';
import { loadConfig } from './loader.js';

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
});
