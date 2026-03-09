import { describe, it, expect } from 'vitest';
import {
  truncateRows,
  truncateColumns,
  checkTotalSize,
} from './truncate.js';

describe('truncateRows', () => {
  it('returns all rows when under limit', () => {
    const rows = [
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ];
    const result = truncateRows(rows, 5);

    expect(result.rows).toEqual(rows);
    expect(result.info.truncated).toBe(false);
    expect(result.info.truncationReason).toBeUndefined();
  });

  it('truncates when over limit', () => {
    const rows = [
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
      [4, 'd'],
      [5, 'e'],
    ];
    const result = truncateRows(rows, 3);

    expect(result.rows).toHaveLength(3);
    expect(result.rows).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('sets truncationReason and hint when truncated', () => {
    const rows = [[1], [2], [3], [4], [5]];
    const result = truncateRows(rows, 2);

    expect(result.info.truncated).toBe(true);
    expect(result.info.truncationReason).toBe('maxRows');
    expect(result.info.hint).toBe('Use LIMIT/OFFSET or WHERE clause to paginate');
  });

  it('tracks totalAvailable and returned', () => {
    const rows = [[1], [2], [3]];
    const result = truncateRows(rows, 2, 1000);

    expect(result.info.totalAvailable).toBe(1000);
    expect(result.info.returned).toBe(2);
  });

  it('uses rows.length as totalAvailable when not provided', () => {
    const rows = [[1], [2], [3], [4], [5]];
    const result = truncateRows(rows, 2);

    expect(result.info.totalAvailable).toBe(5);
    expect(result.info.returned).toBe(2);
  });

  it('handles empty rows array', () => {
    const result = truncateRows([], 10);

    expect(result.rows).toEqual([]);
    expect(result.info.truncated).toBe(false);
  });

  it('handles exactly at limit', () => {
    const rows = [[1], [2], [3]];
    const result = truncateRows(rows, 3);

    expect(result.rows).toEqual(rows);
    expect(result.info.truncated).toBe(false);
  });
});

describe('truncateColumns', () => {
  it('returns all columns when under limit', () => {
    const columns = ['id', 'name', 'email'];
    const result = truncateColumns(columns, 10);

    expect(result.columns).toEqual(columns);
    expect(result.truncated).toBe(false);
  });

  it('truncates when over limit', () => {
    const columns = ['a', 'b', 'c', 'd', 'e'];
    const result = truncateColumns(columns, 3);

    expect(result.columns).toEqual(['a', 'b', 'c']);
    expect(result.truncated).toBe(true);
  });

  it('handles empty columns array', () => {
    const result = truncateColumns([], 10);

    expect(result.columns).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('handles exactly at limit', () => {
    const columns = ['a', 'b', 'c'];
    const result = truncateColumns(columns, 3);

    expect(result.columns).toEqual(columns);
    expect(result.truncated).toBe(false);
  });
});

describe('checkTotalSize', () => {
  it('returns not truncated when under limit', () => {
    const data = 'small data';
    const result = checkTotalSize(data, 1024);

    expect(result.data).toBe(data);
    expect(result.info.truncated).toBe(false);
    expect(result.info.truncationReason).toBeUndefined();
  });

  it('returns truncated data when over limit', () => {
    const data = 'x'.repeat(1000);
    const result = checkTotalSize(data, 100);

    expect(result.info.truncated).toBe(true);
    expect(result.info.truncationReason).toBe('maxTotalSize');
    expect(result.info.hint).toBe('Use LIMIT/OFFSET or WHERE clause to paginate');
    expect(Buffer.byteLength(result.data, 'utf8')).toBeLessThanOrEqual(100);
    expect(result.data.length).toBe(100);
  });

  it('handles exactly at limit', () => {
    const data = 'x'.repeat(100);
    const result = checkTotalSize(data, 100);

    expect(result.data).toBe(data);
    expect(result.info.truncated).toBe(false);
  });

  it('handles empty string', () => {
    const result = checkTotalSize('', 100);

    expect(result.data).toBe('');
    expect(result.info.truncated).toBe(false);
  });

  it('correctly calculates UTF-8 byte length', () => {
    // UTF-8 characters can be multiple bytes
    // emoji is 4 bytes each, so 10 emojis = 40 bytes
    const unicodeData = '\u{1F600}'.repeat(10);

    const resultUnder = checkTotalSize(unicodeData, 50);
    expect(resultUnder.data).toBe(unicodeData);
    expect(resultUnder.info.truncated).toBe(false);

    const resultOver = checkTotalSize(unicodeData, 30);
    expect(resultOver.info.truncated).toBe(true);
    expect(Buffer.byteLength(resultOver.data, 'utf8')).toBeLessThanOrEqual(30);
  });

  it('truncates at character boundaries for multi-byte characters', () => {
    // emoji is 4 bytes each
    const unicodeData = '\u{1F600}'.repeat(10); // 40 bytes total
    const result = checkTotalSize(unicodeData, 20);

    expect(result.info.truncated).toBe(true);
    // Should fit exactly 5 emojis (20 bytes)
    expect(result.data).toBe('\u{1F600}'.repeat(5));
    expect(Buffer.byteLength(result.data, 'utf8')).toBe(20);
  });
});
