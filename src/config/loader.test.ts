import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorCode } from '../utils/errors.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock os - return value directly, not a function
vi.mock('os', () => ({
  homedir: () => '/home/testuser',
}));

import { readFile } from 'fs/promises';
import { loadConfig } from './loader.js';

const mockReadFile = vi.mocked(readFile);

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    // Clear any DB_MCP_ env vars
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('DB_MCP_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('config file loading', () => {
    it('should load from explicit CLI path', async () => {
      const config = {
        databases: {
          main: { url: 'postgresql://localhost/main' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig('/custom/path/config.json');

      expect(mockReadFile).toHaveBeenCalledWith('/custom/path/config.json', 'utf-8');
      expect(result.databases.main.url).toBe('postgresql://localhost/main');
    });

    it('should throw if explicit CLI path does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValueOnce(error);

      await expect(loadConfig('/missing/config.json')).rejects.toMatchObject({
        code: ErrorCode.CONFIG_NOT_FOUND,
        message: expect.stringContaining('/missing/config.json'),
      });
    });

    it('should load from DB_MCP_CONFIG env var', async () => {
      process.env.DB_MCP_CONFIG = '/env/path/config.json';
      const config = {
        databases: {
          envdb: { url: 'postgresql://localhost/envdb' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig();

      expect(mockReadFile).toHaveBeenCalledWith('/env/path/config.json', 'utf-8');
      expect(result.databases.envdb.url).toBe('postgresql://localhost/envdb');
    });

    it('should throw if DB_MCP_CONFIG path does not exist', async () => {
      process.env.DB_MCP_CONFIG = '/missing/env/config.json';
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValueOnce(error);

      await expect(loadConfig()).rejects.toMatchObject({
        code: ErrorCode.CONFIG_NOT_FOUND,
        message: expect.stringContaining('/missing/env/config.json'),
      });
    });

    it('should load from current directory (./databases.json)', async () => {
      const config = {
        databases: {
          local: { url: 'postgresql://localhost/local' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig();

      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('databases.json'),
        'utf-8'
      );
      expect(result.databases.local.url).toBe('postgresql://localhost/local');
    });

    it('should load from home directory if local not found', async () => {
      const localError = new Error('ENOENT') as NodeJS.ErrnoException;
      localError.code = 'ENOENT';
      mockReadFile.mockRejectedValueOnce(localError);

      const config = {
        databases: {
          homedb: { url: 'postgresql://localhost/homedb' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig();

      expect(mockReadFile).toHaveBeenCalledTimes(2);
      expect(mockReadFile).toHaveBeenLastCalledWith(
        '/home/testuser/.config/db-mcp/databases.json',
        'utf-8'
      );
      expect(result.databases.homedb.url).toBe('postgresql://localhost/homedb');
    });
  });

  describe('ENV variable resolution', () => {
    it('should resolve ${VAR} placeholders in URLs', async () => {
      process.env.DB_PASSWORD = 'secret123';
      process.env.DB_HOST = 'prod.example.com';

      const config = {
        databases: {
          prod: { url: 'postgresql://user:${DB_PASSWORD}@${DB_HOST}/mydb' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig('/config.json');

      expect(result.databases.prod.url).toBe(
        'postgresql://user:secret123@prod.example.com/mydb'
      );
    });

    it('should throw if referenced env var is not defined', async () => {
      const config = {
        databases: {
          prod: { url: 'postgresql://user:${UNDEFINED_VAR}@localhost/mydb' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      await expect(loadConfig('/config.json')).rejects.toMatchObject({
        code: ErrorCode.CONFIG_INVALID,
        message: expect.stringContaining('UNDEFINED_VAR'),
      });
    });
  });

  describe('DB_MCP_{NAME}_URL pattern', () => {
    it('should create databases from env vars', async () => {
      // No config file
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      process.env.DB_MCP_MAIN_URL = 'postgresql://localhost/main';
      process.env.DB_MCP_ANALYTICS_URL = 'postgresql://localhost/analytics';

      const result = await loadConfig();

      expect(result.databases.main).toEqual({
        url: 'postgresql://localhost/main',
        readonly: false,
      });
      expect(result.databases.analytics).toEqual({
        url: 'postgresql://localhost/analytics',
        readonly: false,
      });
    });

    it('should convert database name to lowercase', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      process.env.DB_MCP_MY_DATABASE_URL = 'postgresql://localhost/test';

      const result = await loadConfig();

      expect(result.databases['my_database']).toBeDefined();
      expect(result.databases['MY_DATABASE']).toBeUndefined();
    });

    it('should not override config file databases with env vars', async () => {
      const config = {
        databases: {
          main: { url: 'postgresql://config/main', readonly: true },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      process.env.DB_MCP_MAIN_URL = 'postgresql://env/main';

      const result = await loadConfig('/config.json');

      expect(result.databases.main.url).toBe('postgresql://config/main');
      expect(result.databases.main.readonly).toBe(true);
    });
  });

  describe('defaults', () => {
    it('should apply default values from SPEC', async () => {
      const config = {
        databases: {
          test: { url: 'postgresql://localhost/test' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig('/config.json');

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

    it('should merge custom defaults with SPEC defaults', async () => {
      const config = {
        databases: {
          test: { url: 'postgresql://localhost/test' },
        },
        defaults: {
          maxRows: 50,
          timeout: 60000,
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig('/config.json');

      expect(result.defaults.maxRows).toBe(50);
      expect(result.defaults.timeout).toBe(60000);
      expect(result.defaults.maxCellLength).toBe(500); // default preserved
    });

    it('should set readonly to false by default', async () => {
      const config = {
        databases: {
          test: { url: 'postgresql://localhost/test' },
        },
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(config));

      const result = await loadConfig('/config.json');

      expect(result.databases.test.readonly).toBe(false);
    });
  });

  describe('validation', () => {
    it('should throw CONFIG_NOT_FOUND if no databases configured', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      await expect(loadConfig()).rejects.toMatchObject({
        code: ErrorCode.CONFIG_NOT_FOUND,
        message: expect.stringContaining('No databases configured'),
      });
    });

    it('should throw CONFIG_INVALID for invalid JSON', async () => {
      mockReadFile.mockResolvedValueOnce('{ invalid json }');

      await expect(loadConfig('/config.json')).rejects.toMatchObject({
        code: ErrorCode.CONFIG_INVALID,
        message: expect.stringContaining('Failed to parse'),
      });
    });
  });
});
