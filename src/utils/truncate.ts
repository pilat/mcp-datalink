/**
 * Truncation utilities for limiting MCP response sizes
 */

export interface TruncationInfo {
  truncated: boolean;
  truncationReason?: 'maxRows' | 'maxTotalSize' | 'maxColumns';
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
