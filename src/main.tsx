import { boot } from './app/boot.js';
import { initLegacyBridge } from './legacyBridge.js';

boot().then(() => {
  initLegacyBridge();
});
