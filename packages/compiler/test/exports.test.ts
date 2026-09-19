import { describe, expect, it } from 'vitest';
import * as compiler from '../src/index.js';

describe('package exports', () => {
  it('exposes the transform, the plugin and the id helper', () => {
    expect(typeof compiler.transform).toBe('function');
    expect(typeof compiler.firsthandPlugin).toBe('function');
    expect(typeof compiler.stableId).toBe('function');
  });
});
