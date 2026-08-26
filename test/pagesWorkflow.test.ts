import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');

describe('GitHub Pages production workflow', () => {
  it('installs the same IndexedDB harness as Quality Gate before tests', () => {
    const install = workflow.indexOf('Install IndexedDB test harness');
    const test = workflow.indexOf('- name: Test');
    expect(install).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(install);
    expect(workflow).toContain('fake-indexeddb@6.2.5');
    expect(workflow).toContain('--no-save --package-lock=false --ignore-scripts');
  });

  it('builds Pages with the repository base path', () => {
    expect(workflow).toContain('VITE_BASE_PATH: /so-nho-accounting/');
    expect(workflow).toContain('run: npm run build');
  });
});
