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

describe('edge case data types', () => {
  describe('BigInt handling', () => {
    it('converts BigInt to string', () => {
      const bigInt = BigInt('9007199254740993');
      expect(formatValue(bigInt)).toBe('9007199254740993');
    });

    it('handles BigInt larger than MAX_SAFE_INTEGER', () => {
      const veryLargeBigInt = BigInt('9999999999999999999999999999');
      expect(formatValue(veryLargeBigInt)).toBe('9999999999999999999999999999');
    });

    it('handles negative BigInt', () => {
      const negativeBigInt = BigInt('-9007199254740993');
      expect(formatValue(negativeBigInt)).toBe('-9007199254740993');
    });

    it('handles BigInt zero', () => {
      expect(formatValue(BigInt(0))).toBe('0');
    });
  });

  describe('Buffer/BLOB handling', () => {
    it('converts Buffer to readable format', () => {
      const buffer = Buffer.from('hello');
      const result = formatValue(buffer);
      // Buffer should not produce [object Object]
      expect(result).not.toBe('[object Object]');
      // Should be some kind of string representation (JSON or hex/base64)
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles empty Buffer', () => {
      const buffer = Buffer.from('');
      const result = formatValue(buffer);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('[object Object]');
    });

    it('handles Buffer with binary data', () => {
      const buffer = Buffer.from([0x00, 0xff, 0x7f, 0x80]);
      const result = formatValue(buffer);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('[object Object]');
    });

    it('handles Uint8Array', () => {
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      const result = formatValue(arr);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('[object Object]');
    });
  });

  describe('Infinity/NaN/-0 handling', () => {
    it('converts Infinity to string', () => {
      expect(formatValue(Infinity)).toBe('Infinity');
    });

    it('converts negative Infinity to string', () => {
      expect(formatValue(-Infinity)).toBe('-Infinity');
    });

    it('converts NaN to string', () => {
      expect(formatValue(NaN)).toBe('NaN');
    });

    it('handles negative zero', () => {
      const result = formatValue(-0);
      // -0 should become "0" or "-0" - both are acceptable
      expect(result === '0' || result === '-0').toBe(true);
    });

    it('distinguishes between 0 and -0 or normalizes consistently', () => {
      const positiveZero = formatValue(0);
      const negativeZero = formatValue(-0);
      // Both should be string representations
      expect(typeof positiveZero).toBe('string');
      expect(typeof negativeZero).toBe('string');
    });
  });

  describe('numbers beyond MAX_SAFE_INTEGER', () => {
    it('handles Number.MAX_SAFE_INTEGER', () => {
      expect(formatValue(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    });

    it('handles Number.MIN_SAFE_INTEGER', () => {
      expect(formatValue(Number.MIN_SAFE_INTEGER)).toBe('-9007199254740991');
    });

    it('handles number beyond MAX_SAFE_INTEGER (precision may be lost)', () => {
      // Note: This test documents current behavior
      // Numbers beyond MAX_SAFE_INTEGER lose precision in JavaScript
      // eslint-disable-next-line no-loss-of-precision
      const unsafeNumber = 9007199254740993;
      const result = formatValue(unsafeNumber);
      expect(typeof result).toBe('string');
      // The actual value may differ due to precision loss
    });

    it('handles Number.MAX_VALUE', () => {
      const result = formatValue(Number.MAX_VALUE);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles Number.MIN_VALUE (smallest positive)', () => {
      const result = formatValue(Number.MIN_VALUE);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles very small negative numbers', () => {
      const result = formatValue(-Number.MAX_VALUE);
      expect(typeof result).toBe('string');
      expect(result.startsWith('-')).toBe(true);
    });
  });

  describe('array and nested object handling', () => {
    it('handles empty array', () => {
      expect(formatValue([])).toBe('[]');
    });

    it('handles array with mixed types', () => {
      const result = formatValue([1, 'two', true, null]);
      expect(result).toBe('[1,"two",true,null]');
    });

    it('handles nested arrays', () => {
      const result = formatValue([[1, 2], [3, 4]]);
      expect(result).toBe('[[1,2],[3,4]]');
    });

    it('handles empty object', () => {
      expect(formatValue({})).toBe('{}');
    });

    it('handles deeply nested objects', () => {
      const nested = { a: { b: { c: { d: 'deep' } } } };
      expect(formatValue(nested)).toBe('{"a":{"b":{"c":{"d":"deep"}}}}');
    });

    it('handles object with array values', () => {
      const obj = { items: [1, 2, 3], name: 'test' };
      const result = formatValue(obj);
      expect(result).toContain('"items":[1,2,3]');
      expect(result).toContain('"name":"test"');
    });

    it('handles array of objects', () => {
      const arr = [{ id: 1 }, { id: 2 }];
      expect(formatValue(arr)).toBe('[{"id":1},{"id":2}]');
    });

    it('handles object with null values', () => {
      const obj = { a: null, b: 'value' };
      expect(formatValue(obj)).toBe('{"a":null,"b":"value"}');
    });

    it('handles object with undefined values (excluded from JSON)', () => {
      const obj = { a: undefined, b: 'value' };
      // JSON.stringify excludes undefined values
      expect(formatValue(obj)).toBe('{"b":"value"}');
    });
  });

  describe('special object types', () => {
    it('handles Date objects', () => {
      const date = new Date('2024-06-15T12:00:00.000Z');
      expect(formatValue(date)).toBe('2024-06-15T12:00:00.000Z');
    });

    it('throws on invalid Date', () => {
      const invalidDate = new Date('invalid');
      // Invalid dates throw RangeError when toISOString() is called
      expect(() => formatValue(invalidDate)).toThrow(RangeError);
    });

    it('handles RegExp objects', () => {
      const regex = /test/gi;
      const result = formatValue(regex);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('[object RegExp]');
    });

    it('handles Map objects', () => {
      const map = new Map([['key', 'value']]);
      const result = formatValue(map);
      expect(typeof result).toBe('string');
      // Map serializes to {} with JSON.stringify
    });

    it('handles Set objects', () => {
      const set = new Set([1, 2, 3]);
      const result = formatValue(set);
      expect(typeof result).toBe('string');
      // Set serializes to {} with JSON.stringify
    });

    it('handles Symbol (via String fallback)', () => {
      const sym = Symbol('test');
      const result = formatValue(sym);
      expect(typeof result).toBe('string');
      expect(result).toContain('test');
    });

    it('handles function (via String fallback)', () => {
      const fn = function testFunc() { return 1; };
      const result = formatValue(fn);
      expect(typeof result).toBe('string');
    });
  });

  describe('edge cases in formatAsMarkdownTable', () => {
    it('handles row with BigInt values after formatting', () => {
      const columns = ['id', 'big_number'];
      const rows = [
        ['1', formatValue(BigInt('9007199254740993'))],
      ];
      const result = formatAsMarkdownTable(columns, rows);
      expect(result).toContain('9007199254740993');
    });

    it('handles row with Infinity after formatting', () => {
      const columns = ['id', 'value'];
      const rows = [
        ['1', formatValue(Infinity)],
      ];
      const result = formatAsMarkdownTable(columns, rows);
      expect(result).toContain('Infinity');
    });

    it('handles row with NaN after formatting', () => {
      const columns = ['id', 'value'];
      const rows = [
        ['1', formatValue(NaN)],
      ];
      const result = formatAsMarkdownTable(columns, rows);
      expect(result).toContain('NaN');
    });

    it('handles row with nested JSON after formatting', () => {
      const columns = ['id', 'data'];
      const rows = [
        ['1', formatValue({ nested: { value: [1, 2, 3] } })],
      ];
      const result = formatAsMarkdownTable(columns, rows);
      expect(result).toContain('nested');
      expect(result).toContain('[1,2,3]');
    });

    it('handles very long formatted values', () => {
      const columns = ['id', 'data'];
      const longArray = Array(100).fill('x');
      const rows = [
        ['1', formatValue(longArray)],
      ];
      const result = formatAsMarkdownTable(columns, rows);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
