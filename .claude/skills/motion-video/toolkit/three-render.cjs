// three.js renderer. usage: node three-render.cjs job.json data.json bg.png proj.json outDir parallel
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const [jobPath, dataPath, bgPath, projPath, outDir, par] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
const ROOT = __dirname, TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' };
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8')), proj = JSON.parse(fs.readFileSync(projPath, 'utf8'));
const extra = Object.fromEntries(Object.entries(job.extraJson || {}).map(([k, f]) => [k, JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'))]));
// one browser + page per worker, reused for every slice it renders (setup is the slow part)
async function open() {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: job.look.W || 1080, height: job.look.H || 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await p.route('http://local/**', (r) => {
    const u = new URL(r.request().url()).pathname;
    const f = u === '/' ? path.join(ROOT, 'three', job.page || 'index.html') : u === '/bg.png' ? path.resolve(bgPath) : (job.assets || {})[u] ? path.resolve(ROOT, job.assets[u]) : Object.keys(job.assets || {}).find((k) => k.endsWith('/') && u.startsWith(k)) ? (() => { const k = Object.keys(job.assets).find((k) => k.endsWith('/') && u.startsWith(k)); return path.resolve(ROOT, job.assets[k], u.slice(k.length)); })() : u.startsWith('/three/') ? path.join(ROOT, 'node_modules', u) : u.startsWith('/nm/') ? path.join(ROOT, 'node_modules', u.slice(4)) : null;
    if (!f || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://local/', { waitUntil: 'load', timeout: 180000 });
  await p.waitForFunction(() => typeof window.__setup === 'function', null, { timeout: 180000 });
  await p.evaluate((cfg) => window.__setup(cfg), { ...job.look, ...extra, bg: '/bg.png', proj, data });
  const [w0, w1] = await p.evaluate(() => window.__win);
  console.log('PEAK', JSON.stringify(await p.evaluate(() => window.__peakInfo)));
  const tm = await p.evaluate((n) => window.__tmap ? window.__tmap(n) : null, job.total);
  const Tof = (k) => !tm ? w0 + (w1 - w0) * k / (job.total - 1) : k < 0 ? tm[0] + k * (tm[1] - tm[0]) : tm[k];
  return { b, p, Tof };
}
async function slice({ p, Tof }, s, i) {
  const dir = `${outDir}/s${i}`; fs.mkdirSync(dir, { recursive: true });
  for (let k = s.f0 - (job.warm ?? 48); k < s.f0; k++) await p.evaluate(([T, d]) => window.__frame(T, d), [Tof(k), k === s.f0 - 1]); // warm-up trails (also before clip start); last one drawn to prime the bloom pass
  for (let f = s.f0; f < s.f1; f++) {
    await p.evaluate(([T, k]) => window.__frame(T, true, k), [Tof(f), f]);
    await p.screenshot({ type: 'jpeg', quality: 93, path: `${dir}/f${String(f).padStart(4, '0')}.jpg` });
    if ((f - s.f0) % 60 === 0) console.log(`s${i} ${f - s.f0}/${s.f1 - s.f0} ${new Date().toISOString()}`);
  }
}
(async () => {
  const q = job.slices.map((s, i) => [s, i]); let next = 0;
  await Promise.all(Array.from({ length: +par }, async () => {
    let w = null;
    while (next < q.length) { const [s, i] = q[next++];
      if (fs.existsSync(`${outDir}/s${i}`) && fs.readdirSync(`${outDir}/s${i}`).length >= s.f1 - s.f0) continue; // already rendered (resume after a restart)
      try { if (!w) w = await open(); await slice(w, s, i); } catch (e) { console.log('ERR', i, e.message); if (w) await w.b.close().catch(() => {}); w = null; } }
    if (w) await w.b.close();
  }));
})();
