import { describe, expect, it } from 'vitest';
import { RELEASE_CHANNEL, RELEASE_DATE, RELEASE_INFO, RELEASE_VERSION } from './releaseInfo';

describe('release metadata', () => {
  it('publishes one explicit RC identity for UI and deployment checks', () => {
    expect(RELEASE_VERSION).toBe('1.0.0-rc.2');
    expect(RELEASE_CHANNEL).toBe('release-candidate');
    expect(RELEASE_DATE).toBe('2026-08-26');
    expect(RELEASE_INFO).toEqual({
      version: '1.0.0-rc.2',
      channel: 'release-candidate',
      date: '2026-08-26',
    });
  });
});