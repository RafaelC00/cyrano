import { createPlatformApp } from './app.ts';
import { generateProfiles } from './seed.ts';
import type { SeedOptions } from './seed.ts';
import { PlatformStore } from './store.ts';

export function createPlatform(seedOpts: SeedOptions = {}) {
  const store = new PlatformStore(generateProfiles(seedOpts));
  return { store, app: createPlatformApp(store) };
}
