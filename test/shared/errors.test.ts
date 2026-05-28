import { describe, it, expect } from 'vitest';
import { AppError, isAppError } from '../../src/shared/errors.js';

describe('AppError', () => {
  it('carries code, message, and http status', () => {
    const e = new AppError('not_found', 'project missing', 404);
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('project missing');
    expect(e.status).toBe(404);
    expect(isAppError(e)).toBe(true);
  });

  it('isAppError returns false for plain Error', () => {
    expect(isAppError(new Error('x'))).toBe(false);
  });
});
