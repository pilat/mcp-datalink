import { describe, it, expect } from 'vitest';
import { listDatabases } from './list-databases.js';
import type { Config } from '../types.js';

function createConfig(
  databases: Record<string, { url: string; readonly: boolean; maxRows?: number }>
): Config {
  return {
    databases: Object.fromEntries(
      Object.entries(databases).map(([name, config]) => [
        name,
        { url: config.url, readonly: config.readonly, maxRows: config.maxRows },
      ])
    ),
    defaults: {
      maxRows: 100,
      maxCellLength: 500,
      maxTotalSize: 65536,
      maxColumns: 50,
      maxTables: 200,
      maxIndexes: 20,
      timeout: 30000,
    },
  };
}

describe('listDatabases', () => {
  it('returns all configured databases', () => {
    const config = createConfig({
      main: { url: 'postgresql://localhost/main', readonly: false },
      analytics: { url: 'postgresql://localhost/analytics', readonly: true },
    });

    const result = listDatabases(config);

    expect(result.databases).toHaveLength(2);
    expect(result.databases).toContainEqual({ name: 'main', readonly: false });
    expect(result.databases).toContainEqual({ name: 'analytics', readonly: true });
  });

  it('returns correct readonly flags', () => {
    const config = createConfig({
      writable: { url: 'postgresql://localhost/writable', readonly: false },
      readonly: { url: 'postgresql://localhost/readonly', readonly: true },
    });

    const result = listDatabases(config);

    const writable = result.databases.find((db) => db.name === 'writable');
    const readonly = result.databases.find((db) => db.name === 'readonly');

    expect(writable?.readonly).toBe(false);
    expect(readonly?.readonly).toBe(true);
  });

  it('works with empty config (returns empty array)', () => {
    const config = createConfig({});

    const result = listDatabases(config);

    expect(result.databases).toEqual([]);
  });

  it('works with multiple databases', () => {
    const config = createConfig({
      db1: { url: 'postgresql://localhost/db1', readonly: false },
      db2: { url: 'postgresql://localhost/db2', readonly: true },
      db3: { url: 'postgresql://localhost/db3', readonly: false },
      db4: { url: 'postgresql://localhost/db4', readonly: true },
      db5: { url: 'postgresql://localhost/db5', readonly: false },
    });

    const result = listDatabases(config);

    expect(result.databases).toHaveLength(5);
  });

  it('returns databases with correct structure', () => {
    const config = createConfig({
      test: { url: 'postgresql://localhost/test', readonly: true },
    });

    const result = listDatabases(config);

    expect(result).toHaveProperty('databases');
    expect(Array.isArray(result.databases)).toBe(true);
    expect(result.databases[0]).toHaveProperty('name');
    expect(result.databases[0]).toHaveProperty('readonly');
    expect(typeof result.databases[0].name).toBe('string');
    expect(typeof result.databases[0].readonly).toBe('boolean');
  });
});
