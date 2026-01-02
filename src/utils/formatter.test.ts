import { describe, it, expect } from 'vitest';
import { formatAsMarkdownTable, formatValue } from './formatter.js';

describe('formatValue', () => {
  it('passes through strings', () => {
    expect(formatValue('hello')).toBe('hello');
    expect(formatValue('')).toBe('');
  });

  it('converts numbers to string', () => {
    expect(formatValue(42)).toBe('42');
    expect(formatValue(3.14)).toBe('3.14');
    expect(formatValue(0)).toBe('0');
    expect(formatValue(-100)).toBe('-100');
  });

  it('converts null to "NULL"', () => {
    expect(formatValue(null)).toBe('NULL');
  });

  it('converts undefined to "NULL"', () => {
    expect(formatValue(undefined)).toBe('NULL');
  });

  it('converts booleans to string', () => {
    expect(formatValue(true)).toBe('true');
    expect(formatValue(false)).toBe('false');
  });

  it('formats Date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    expect(formatValue(date)).toBe('2024-01-15T10:30:00.000Z');
  });

  it('converts objects to JSON string', () => {
    expect(formatValue({ foo: 'bar' })).toBe('{"foo":"bar"}');
    expect(formatValue({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it('converts arrays to JSON string', () => {
    expect(formatValue([1, 2, 3])).toBe('[1,2,3]');
    expect(formatValue(['a', 'b'])).toBe('["a","b"]');
  });
});

describe('formatAsMarkdownTable', () => {
  it('formats basic table', () => {
    const columns = ['id', 'name', 'email'];
    const rows = [
      ['1', 'John', 'john@example.com'],
      ['2', 'Jane', 'jane@example.com'],
    ];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toBe(
      '| id | name | email |\n' +
      '| --- | --- | --- |\n' +
      '| 1 | John | john@example.com |\n' +
      '| 2 | Jane | jane@example.com |'
    );
  });

  it('escapes pipe characters in data', () => {
    const columns = ['id', 'data'];
    const rows = [['1', 'value|with|pipes']];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toContain('value\\|with\\|pipes');
  });

  it('escapes pipe characters in headers', () => {
    const columns = ['id', 'col|with|pipe'];
    const rows = [['1', 'value']];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toContain('col\\|with\\|pipe');
  });

  it('handles NULL values', () => {
    const columns = ['id', 'name'];
    const rows = [
      ['1', null],
      ['2', 'Jane'],
    ];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toContain('| 1 | NULL |');
    expect(result).toContain('| 2 | Jane |');
  });

  it('handles empty result set (headers only)', () => {
    const columns = ['id', 'name', 'email'];
    const rows: (string | null)[][] = [];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toBe(
      '| id | name | email |\n' +
      '| --- | --- | --- |'
    );
  });

  it('handles single column', () => {
    const columns = ['count'];
    const rows = [['42']];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toBe(
      '| count |\n' +
      '| --- |\n' +
      '| 42 |'
    );
  });

  it('handles single row', () => {
    const columns = ['id', 'name'];
    const rows = [['1', 'John']];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toBe(
      '| id | name |\n' +
      '| --- | --- |\n' +
      '| 1 | John |'
    );
  });

  it('returns empty string for empty columns', () => {
    const result = formatAsMarkdownTable([], []);

    expect(result).toBe('');
  });

  it('handles empty string values', () => {
    const columns = ['id', 'name'];
    const rows = [['1', '']];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toContain('| 1 |  |');
  });

  it('handles special characters in values', () => {
    const columns = ['id', 'text'];
    const rows = [['1', 'line1\nline2']];

    const result = formatAsMarkdownTable(columns, rows);

    expect(result).toContain('line1\nline2');
  });
});
