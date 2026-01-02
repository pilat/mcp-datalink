import { describe, it, expect } from 'vitest';
import { DbMcpError, ErrorCode } from './errors';

describe('DbMcpError', () => {
  it('has correct code and message', () => {
    const error = new DbMcpError(
      ErrorCode.DATABASE_NOT_FOUND,
      'Database not found'
    );

    expect(error.code).toBe(ErrorCode.DATABASE_NOT_FOUND);
    expect(error.message).toBe('Database not found');
    expect(error.name).toBe('DbMcpError');
  });

  it('toJSON() works correctly', () => {
    const error = new DbMcpError(
      ErrorCode.QUERY_BLOCKED,
      'Query blocked',
      { reason: 'Use a safer query' }
    );

    const json = error.toJSON();

    expect(json).toEqual({
      name: 'DbMcpError',
      code: ErrorCode.QUERY_BLOCKED,
      message: 'Query blocked',
      details: { reason: 'Use a safer query' },
    });
  });

  it('details is optional', () => {
    const errorWithDetails = new DbMcpError(
      ErrorCode.QUERY_TIMEOUT,
      'Query timed out',
      { hint: 'Reduce query complexity' }
    );
    const errorWithoutDetails = new DbMcpError(
      ErrorCode.QUERY_TIMEOUT,
      'Query timed out'
    );

    expect(errorWithDetails.details).toEqual({ hint: 'Reduce query complexity' });
    expect(errorWithoutDetails.details).toBeUndefined();

    const jsonWithDetails = errorWithDetails.toJSON();
    const jsonWithoutDetails = errorWithoutDetails.toJSON();

    expect(jsonWithDetails.details).toEqual({ hint: 'Reduce query complexity' });
    expect(jsonWithoutDetails.details).toBeUndefined();
  });
});
