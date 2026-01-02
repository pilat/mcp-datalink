/**
 * Integration tests for list_databases tool
 */

import { describe, it, expect } from 'vitest';
import { listDatabases } from '../tools/list-databases.js';
import { createTestConfig } from './helpers.js';

describe('list_databases integration', () => {
  it('returns configured database', () => {
    const config = createTestConfig();
    const result = listDatabases(config);

    expect(result.databases).toContainEqual({
      name: 'testdb',
      readonly: false,
    });
  });

  it('returns multiple databases', () => {
    const config = createTestConfig();
    const result = listDatabases(config);

    expect(result.databases).toHaveLength(2);
    expect(result.databases.map((d) => d.name)).toContain('testdb');
    expect(result.databases.map((d) => d.name)).toContain('readonlydb');
  });

  it('shows correct readonly flags', () => {
    const config = createTestConfig();
    const result = listDatabases(config);

    const testdb = result.databases.find((d) => d.name === 'testdb');
    const readonlydb = result.databases.find((d) => d.name === 'readonlydb');

    expect(testdb?.readonly).toBe(false);
    expect(readonlydb?.readonly).toBe(true);
  });

  it('handles empty databases config', () => {
    const config = createTestConfig({ databases: {} });
    const result = listDatabases(config);

    expect(result.databases).toHaveLength(0);
  });
});
