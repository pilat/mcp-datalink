/**
 * Truncation utilities for limiting MCP response sizes
 */

import { safeJsonStringify } from './formatter.js';

export interface TruncationInfo {
  truncated: boolean;
  truncationReason?: 'maxRows' | 'maxCellLength' | 'maxTotalSize' | 'maxColumns';
  totalAvailable?: number;
  returned?: number;
  hint?: string;
}

export function truncateRows(
  rows: unknown[][],
  maxRows: number,
  totalAvailable?: number
): { rows: unknown[][]; info: TruncationInfo } {
  const available = totalAvailable ?? rows.length;

  if (rows.length <= maxRows) {
    return {
      rows,
      info: { truncated: false },
    };
  }

  return {
    rows: rows.slice(0, maxRows),
    info: {
      truncated: true,
      truncationReason: 'maxRows',
      totalAvailable: available,
      returned: maxRows,
      hint: 'Use LIMIT/OFFSET or WHERE clause to paginate',
    },
  };
}

export function truncateCell(
  value: unknown,
  maxLength: number
): { value: string; truncated: boolean; originalLength?: number } {
  // Convert value to string
  let stringValue: string;

  if (value === null || value === undefined) {
    stringValue = 'NULL';
  } else if (typeof value === 'string') {
    stringValue = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    stringValue = String(value);
  } else if (value instanceof Date) {
    stringValue = value.toISOString();
  } else if (typeof value === 'object') {
    stringValue = safeJsonStringify(value);
  } else {
    stringValue = String(value);
  }

  if (stringValue.length <= maxLength) {
    return {
      value: stringValue,
      truncated: false,
    };
  }

  // Account for ellipsis length (3 chars) when truncating
  const ellipsis = '...';

  // Edge case: if maxLength is too small for ellipsis, just truncate without it
  if (maxLength < ellipsis.length) {
    return {
      value: stringValue.slice(0, maxLength),
      truncated: true,
      originalLength: stringValue.length,
    };
  }

  const truncateAt = maxLength - ellipsis.length;

  return {
    value: stringValue.slice(0, truncateAt) + ellipsis,
    truncated: true,
    originalLength: stringValue.length,
  };
}

export function truncateColumns(
  columns: string[],
  maxColumns: number
): { columns: string[]; truncated: boolean } {
  if (columns.length <= maxColumns) {
    return {
      columns,
      truncated: false,
    };
  }

  return {
    columns: columns.slice(0, maxColumns),
    truncated: true,
  };
}

export function checkTotalSize(
  data: string,
  maxSize: number
): { data: string; info: TruncationInfo } {
  const byteLength = Buffer.byteLength(data, 'utf8');

  if (byteLength <= maxSize) {
    return { data, info: { truncated: false } };
  }

  // Truncate to fit within maxSize bytes
  // We need to be careful with multi-byte UTF-8 characters
  // Binary search for the right character position
  let low = 0;
  let high = data.length;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const slice = data.slice(0, mid);
    const sliceBytes = Buffer.byteLength(slice, 'utf8');

    if (sliceBytes <= maxSize) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const truncatedData = data.slice(0, low);

  return {
    data: truncatedData,
    info: {
      truncated: true,
      truncationReason: 'maxTotalSize',
      hint: 'Use LIMIT/OFFSET or WHERE clause to paginate',
    },
  };
}
