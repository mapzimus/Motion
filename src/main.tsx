import { render } from 'preact';
import { boot } from './app/boot.js';
import { Legend } from './components/Legend.js';
import { initLegacyBridge } from './legacyBridge.js';
import { initLegendBridge } from './app/legendBridge.js';
import { setFatal } from './stores/index.js';

render(<Legend />, document.getElementById('legend-root')!);

// boot() starts the legacy bridge once the panel exists. If it fails first, the
// bridge still has to run so the error overlay can show.
boot().then(initLegendBridge).catch((error: unknown) => {
  // Without this a failed startup fetch leaves "Loading New England…" up forever.
  console.error('Boot failed:', error);
  initLegacyBridge();
  setFatal(error instanceof Error ? error : new Error(String(error)));
});
