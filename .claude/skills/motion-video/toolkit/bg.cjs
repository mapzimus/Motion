// Renders the static background (map + quiet rail lines, no vehicles) and the projection used by three.js.
// usage: node bg.cjs view.json out.png out-proj.json
const { chromium } = require('playwright-core');
const fs = require('fs');
const [viewPath, outPng, outProj] = process.argv.slice(2);
const v = JSON.parse(fs.readFileSync(viewPath, 'utf8'));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: v.w || 540, height: v.h || 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const T0 = Date.now(); p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log('NAV', ((Date.now() - T0) / 1000).toFixed(1), f.url().slice(0, 140)); }); p.on('console', (m) => { if (/reload|fail|error/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 160)); });
  const h = `r=${v.region}&c=${v.center.join(',')}&z=${v.zoom}&on=${v.on.join(',')}&off=bus,local,taxi,ferry,plane,vessel,bike,bikeshare`;
  await p.goto(`https://mapzimus.github.io/Motion/#${h}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForFunction(() => window.__map && window.__map.getSource('route-shapes'), null, { timeout: 90000 });
  await p.waitForTimeout(15000);
  await p.waitForFunction(() => { try { return window.__map.querySourceFeatures('route-shapes').length > 50; } catch { return false; } }, null, { timeout: 120000, polling: 1000 });
  await p.addStyleTag({ content: `#panel, .maplibregl-ctrl, .maplibregl-popup { opacity: 0 !important; } .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left { display: none !important; }` });
  const style = (v) => {
    const m = window.__map, st = m.getStyle();
    for (const l of st.layers) {
      const t = l.source && st.sources[l.source] ? st.sources[l.source].type : null;
      if (t === 'geojson' && (l.type === 'symbol' || l.type === 'circle')) m.setLayoutProperty(l.id, 'visibility', 'none');
      if (t === 'vector' && l.type === 'symbol' && v.nolabels) { m.setLayoutProperty(l.id, 'visibility', 'none'); continue; }
      if (t === 'vector' && l.type === 'symbol') { try { m.setPaintProperty(l.id, 'text-opacity', 0.35); m.setPaintProperty(l.id, 'icon-opacity', 0.35); } catch {} }
    }
    if (v.noBoundaries) for (const l of m.getStyle().layers) if (/bound|admin|border/i.test(l.id)) m.setLayoutProperty(l.id, 'visibility', 'none'); // state lines blow up into white bars in close-ups
    if (v.routeOpacity === 0) for (const id of ['route-lines', 'route-halo']) m.setLayoutProperty(id, 'visibility', 'none');
    // where lines share a corridor (Orange / Amtrak / Providence line), draw the subway on top
    const sortKey = ['match', ['get', 'group'], 'orange', 100, 'red', 90, 'mattapan', 90, 'green', 90, 'blue', 90, 'silver', 80, 'commuter', 10, 0];
    for (const id of ['route-lines', 'route-halo']) { try { m.setLayoutProperty(id, 'line-sort-key', sortKey); } catch {} }
    // MBTA navy disappears on a dark map: swap in a lighter blue for the Blue Line
    if (v.blueColor) m.setPaintProperty('route-lines', 'line-color', ['case', ['==', ['get', 'group'], 'blue'], v.blueColor, ['coalesce', ['get', 'mapOpColor'], ['get', 'mapColor'], ['get', 'opColor'], ['get', 'color']]]); // (zoom-interpolated color can't nest in a case; our zooms are all <= 12.6, the first stop)
    m.setPaintProperty('route-lines', 'line-opacity', v.routeOpacity ?? 0.38); m.setPaintProperty('route-halo', 'line-opacity', v.routeOpacity === undefined ? 0.06 : 0);
    if (v.lineWidth) m.setPaintProperty('route-lines', 'line-width', ['match', ['get', 'group'], 'bus', 0.7 * v.lineWidth / 3.2, v.lineWidth]); // close-up patches: keep lines as heavy as the wide map
    m.jumpTo({ center: v.center, zoom: v.zoom }); return true;
  };
  let proj = null;
  for (let attempt = 0; attempt < 4 && !proj; attempt++) {
    try {
      await p.waitForFunction(() => window.__map && window.__map.getLayer('route-lines') && window.__map.querySourceFeatures('route-shapes').length > 50, null, { timeout: 60000, polling: 1000 });
      await p.evaluate(style, v);
      for (let k = 0; k < 60; k++) { if (await p.evaluate(() => window.__map.areTilesLoaded())) break; await p.waitForTimeout(250); }
      await p.waitForTimeout(2500);
      await p.evaluate(style, v);
      proj = await p.evaluate(() => { const m = window.__map; return { center: [m.getCenter().lng, m.getCenter().lat], zoom: m.getZoom(), w: window.innerWidth, h: window.innerHeight, dpr: 2,
        check: [[-71.0589, 42.3601], [-71.0, 42.5], [-71.3, 42.2]].map((ll) => [ll, (({ x, y }) => [x, y])(m.project(ll))]) }; });
      await p.waitForTimeout(1500);
      await p.screenshot({ path: outPng });
    } catch (e) { console.log('retry', attempt, e.message.split('\n')[0]); proj = null; await p.waitForTimeout(5000); }
  }
  fs.writeFileSync(outProj, JSON.stringify(proj));
  console.log(JSON.stringify(proj));
  await b.close();
})();
