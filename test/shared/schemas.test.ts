import { describe, it, expect } from 'vitest';
import { CreateProjectInput, CreateTaskInput, AddContextInput } from '../../src/shared/schemas.js';

describe('schemas', () => {
  it('CreateProjectInput rejects empty slug', () => {
    expect(CreateProjectInput.safeParse({ slug: '', name: 'x' }).success).toBe(false);
  });
  it('CreateProjectInput rejects bad slug chars', () => {
    expect(CreateProjectInput.safeParse({ slug: 'has space', name: 'x' }).success).toBe(false);
  });
  it('CreateProjectInput accepts valid input', () => {
    expect(CreateProjectInput.safeParse({ slug: 'acme-web', name: 'Acme' }).success).toBe(true);
  });
  it('CreateTaskInput requires title', () => {
    expect(CreateTaskInput.safeParse({ title: '' }).success).toBe(false);
  });
  it('AddContextInput validates target_type enum', () => {
    expect(AddContextInput.safeParse({
      target_type: 'bogus', target_id: '11111111-1111-1111-1111-111111111111', note: 'x',
    }).success).toBe(false);
  });
});
