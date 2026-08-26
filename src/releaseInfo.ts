export const RELEASE_VERSION = '1.0.0-rc.2' as const;
export const RELEASE_CHANNEL = 'release-candidate' as const;
export const RELEASE_DATE = '2026-08-26' as const;

export interface ReleaseInfo {
  version: typeof RELEASE_VERSION;
  channel: typeof RELEASE_CHANNEL;
  date: typeof RELEASE_DATE;
}

export const RELEASE_INFO: ReleaseInfo = {
  version: RELEASE_VERSION,
  channel: RELEASE_CHANNEL,
  date: RELEASE_DATE,
};