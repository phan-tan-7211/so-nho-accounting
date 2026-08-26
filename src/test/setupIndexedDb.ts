if (process.env.CI === 'true' && typeof globalThis.indexedDB === 'undefined') {
  const indexedDbHarness = 'fake-indexeddb/auto';
  await import(/* @vite-ignore */ indexedDbHarness);
}
