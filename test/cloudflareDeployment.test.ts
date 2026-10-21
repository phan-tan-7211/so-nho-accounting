import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
const docs = readFileSync(new URL('../docs/CLOUDFLARE_DEPLOY.md', import.meta.url), 'utf8')

function rule(path: string): string {
  const block = headers.split(/\r?\n\s*\r?\n/).find((part) => part.startsWith(`${path}\n`))
  return block ?? ''
}

describe('Cloudflare Pages deployment config', () => {
  it('revalidates service worker and manifest', () => {
    expect(rule('/sw.js')).toContain('max-age=0, must-revalidate')
    expect(rule('/manifest.webmanifest')).toContain('max-age=0, must-revalidate')
  })

  it('caches fingerprinted assets immutably', () => {
    expect(rule('/assets/*')).toContain('max-age=31536000, immutable')
  })

  it('documents safe IndexedDB migration', () => {
    expect(docs).toContain('IndexedDB is origin-specific')
    expect(docs).toContain('VITE_BASE_PATH')
  })
})
