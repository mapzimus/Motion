import { boot } from './app/boot.js';
import { initLegacyBridge } from './legacyBridge.js';
import { setFatal } from './stores/index.js';

boot()
  .then(() => {
    initLegacyBridge();
  })
  .catch((error: unknown) => {
    // Without this a failed startup fetch leaves "Loading New England…" up forever.
    console.error('Boot failed:', error);
    initLegacyBridge();
    setFatal(error instanceof Error ? error : new Error(String(error)));
  });
