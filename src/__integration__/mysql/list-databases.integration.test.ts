/**
 * Integration tests for list_databases tool (MySQL)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { listDatabases } from '../../tools/list-databases.js';
import { createMySqlTestConfig, seedMySqlTestData } from '../helpers.js';

describe('list_databases integration (MySQL)', () => {
  beforeEach(async () => {
    await seedMySqlTestData();
  });

  it('returns configured MySQL databases', () => {
    const config = createMySqlTestConfig();
    const result = listDatabases(config);

    expect(result.databases).toHaveLength(2);
    expect(result.databases.map((d) => d.name)).toContain('mysqldb');
    expect(result.databases.map((d) => d.name)).toContain('mysqldb_readonly');
  });

  it('shows correct readonly flags', () => {
    const config = createMySqlTestConfig();
    const result = listDatabases(config);

    const mysqldb = result.databases.find((d) => d.name === 'mysqldb');
    const mysqldbReadonly = result.databases.find((d) => d.name === 'mysqldb_readonly');

    expect(mysqldb?.readonly).toBe(false);
    expect(mysqldbReadonly?.readonly).toBe(true);
  });

  it('handles empty databases config', () => {
    const config = createMySqlTestConfig({ databases: {} });
    const result = listDatabases(config);

    expect(result.databases).toHaveLength(0);
  });
});
