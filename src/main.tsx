/// <reference types="vite/client" />
import 'maplibre-gl/dist/maplibre-gl.css';
import { render } from 'preact';
import { boot } from './app/boot.js';
import { Legend } from './components/Legend.js';
import { initLegacyBridge } from './legacyBridge.js';
import { initLegendBridge } from './app/legendBridge.js';
import { setFatal } from './stores/index.js';

// Every import has evaluated by now; tell the startup watchdog in index.html.
(window as unknown as { __motionStarted: boolean }).__motionStarted = true;
// Drop the watchdog's cache-busting params so they don't stick to shared links.
{
  const url = new URL(location.href);
  if (url.searchParams.has('fresh') || url.searchParams.has('try')) {
    url.searchParams.delete('fresh');
    url.searchParams.delete('try');
    history.replaceState(history.state, '', url);
  }
}

render(<Legend />, document.getElementById('legend-root')!);

// A legend setup error is logged, not shown as a boot failure: the map still works.
function startLegend() {
  try {
    initLegendBridge();
  } catch (error) {
    console.error('Legend setup failed:', error);
  }
}

// boot() starts the legacy bridge once the panel exists. If it fails first, the
// bridge still has to run so the error overlay can show.
boot().then(startLegend).catch((error: unknown) => {
  // Without this a failed startup fetch leaves "Loading New England…" up forever.
  console.error('Boot failed:', error);
  initLegacyBridge();
  setFatal(error instanceof Error ? error : new Error(String(error)));
});
