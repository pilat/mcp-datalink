/**
 * Truncation utilities for limiting MCP response sizes
 */

export interface TruncationInfo {
  truncated: boolean;
  truncationReason?: 'maxRows' | 'maxCellLength' | 'maxTotalSize' | 'maxColumns';
  totalAvailable?: number;
  returned?: number;
  hint?: string;
}

/**
 * Truncate array of rows to maxRows limit
 */
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

/**
 * Truncate individual cell value to maxLength
 */
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
    stringValue = JSON.stringify(value);
  } else {
    stringValue = String(value);
  }

  if (stringValue.length <= maxLength) {
    return {
      value: stringValue,
      truncated: false,
    };
  }

  return {
    value: stringValue.slice(0, maxLength) + '...',
    truncated: true,
    originalLength: stringValue.length,
  };
}

/**
 * Truncate columns array to maxColumns limit
 */
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

/**
 * Check if total response size exceeds maxSize
 */
export function checkTotalSize(
  data: string,
  maxSize: number
): TruncationInfo {
  const byteLength = Buffer.byteLength(data, 'utf8');

  if (byteLength <= maxSize) {
    return { truncated: false };
  }

  return {
    truncated: true,
    truncationReason: 'maxTotalSize',
    hint: 'Use LIMIT/OFFSET or WHERE clause to paginate',
  };
}
