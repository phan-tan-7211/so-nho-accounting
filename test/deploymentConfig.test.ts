import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

interface VercelConfig {
  framework: string;
  buildCommand: string;
  outputDirectory: string;
  headers: HeaderRule[];
}

function loadConfig(): VercelConfig {
  const json = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  return JSON.parse(json) as VercelConfig;
}

function cacheControl(config: VercelConfig, source: string): string | undefined {
  return config.headers
    .find((rule) => rule.source === source)
    ?.headers.find((header) => header.key.toLowerCase() === 'cache-control')
    ?.value;
}

describe('production deployment config', () => {
  it('builds the Vite app into dist', () => {
    const config = loadConfig();
    expect(config.framework).toBe('vite');
    expect(config.buildCommand).toBe('npm run build');
    expect(config.outputDirectory).toBe('dist');
  });

  it('forces service-worker and manifest revalidation', () => {
    const config = loadConfig();
    expect(cacheControl(config, '/sw.js')).toContain('max-age=0');
    expect(cacheControl(config, '/sw.js')).toContain('must-revalidate');
    expect(cacheControl(config, '/manifest.webmanifest')).toContain('max-age=0');
    expect(cacheControl(config, '/manifest.webmanifest')).toContain('must-revalidate');
  });

  it('keeps hashed asset caching immutable', () => {
    const config = loadConfig();
    expect(cacheControl(config, '/assets/(.*)')).toBe('public, max-age=31536000, immutable');
  });
});
