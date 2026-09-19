import { describe, it, expect } from 'vitest';
import { stableStringify, fingerprint } from '@/utils/draftFingerprint';

describe('stableStringify', () => {
  it('reads the same however the keys are ordered, at every depth', () => {
    const a = { name: 'Push', exercises: [{ sets: 3, exerciseId: 'bench', targetReps: 10 }] };
    const b = { exercises: [{ targetReps: 10, exerciseId: 'bench', sets: 3 }], name: 'Push' };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"exercises":[{"exerciseId":"bench","sets":3,"targetReps":10}],"name":"Push"}');
  });

  it('drops a key whose value is undefined, so an absent optional field reads as an undefined one', () => {
    expect(stableStringify({ a: 1, targetWeight: undefined })).toBe(stableStringify({ a: 1 }));
    // Inside an array a hole is still a position, as JSON reads it.
    expect(stableStringify([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('keeps arrays in order', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('tells null from undefined at the top level only by absence, and handles primitives', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify(true)).toBe('true');
  });
});

describe('fingerprint', () => {
  it('is eight hex digits and stable across key order', () => {
    const a = fingerprint({ name: 'Push', exercises: [{ sets: 3, exerciseId: 'bench' }] });
    const b = fingerprint({ exercises: [{ exerciseId: 'bench', sets: 3 }], name: 'Push' });
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).toBe(b);
  });

  it('changes when a nested value changes', () => {
    const before = fingerprint({ name: 'Push', exercises: [{ exerciseId: 'bench', sets: 3, targetReps: 10 }] });
    const after = fingerprint({ name: 'Push', exercises: [{ exerciseId: 'bench', sets: 3, targetReps: 8 }] });
    expect(before).not.toBe(after);
  });

  it('ignores an undefined-valued key, as the stringify does', () => {
    expect(fingerprint({ name: 'Push', updatedAt: undefined })).toBe(fingerprint({ name: 'Push' }));
  });
});
