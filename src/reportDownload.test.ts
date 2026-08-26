import { describe, expect, it } from 'vitest';
import { downloadTextFile } from './reportDownload';

describe('report download helper', () => {
  it('exports a browser download function without side effects on import', () => {
    expect(typeof downloadTextFile).toBe('function');
  });
});
