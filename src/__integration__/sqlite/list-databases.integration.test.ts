/**
 * Integration tests for list_databases tool with SQLite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { listDatabases } from '../../tools/list-databases.js';
import { createSqliteTestConfig, seedSqliteTestData } from '../helpers.js';

describe('list_databases SQLite integration', () => {
  beforeEach(async () => {
    await seedSqliteTestData();
  });

  it('returns configured SQLite databases', () => {
    const config = createSqliteTestConfig();
    const result = listDatabases(config);

    expect(result.databases).toContainEqual({
      name: 'sqlitedb',
      readonly: false,
    });
  });

  it('returns multiple databases', () => {
    const config = createSqliteTestConfig();
    const result = listDatabases(config);

    expect(result.databases).toHaveLength(2);
    expect(result.databases.map((d) => d.name)).toContain('sqlitedb');
    expect(result.databases.map((d) => d.name)).toContain('sqlitedb_readonly');
  });

  it('shows correct readonly flags', () => {
    const config = createSqliteTestConfig();
    const result = listDatabases(config);

    const sqlitedb = result.databases.find((d) => d.name === 'sqlitedb');
    const sqlitedbReadonly = result.databases.find((d) => d.name === 'sqlitedb_readonly');

    expect(sqlitedb?.readonly).toBe(false);
    expect(sqlitedbReadonly?.readonly).toBe(true);
  });

  it('handles empty databases config', () => {
    const config = createSqliteTestConfig({ databases: {} });
    const result = listDatabases(config);

    expect(result.databases).toHaveLength(0);
  });
});
