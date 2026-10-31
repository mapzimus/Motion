// usage: node endcard.cjs bgFrame.png out.png "line1" "line2"
const { chromium } = require('playwright-core');
const fs = require('fs');
const [bg, out, l1, l2, l3] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  const img = fs.readFileSync(bg).toString('base64'); const fnt = fs.readFileSync(require('path').join(__dirname, 'fonts/IBMPlexMono-Medium.ttf')).toString('base64');
  await p.setContent(`<html><head><style>@font-face{font-family:PM;src:url(data:font/ttf;base64,${fnt})}</style></head><body style="margin:0;width:540px;height:960px;overflow:hidden;background:#0b0d12;font-family:PM,monospace;color:#f3efe6">
    <div style="position:absolute;inset:-30px;background:url(data:image/jpeg;base64,${img}) center/cover;filter:blur(14px) brightness(.38)"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 78px;gap:22px">
      <div style="font-size:14px;letter-spacing:.38em;font-weight:700;color:#9ad1ff">${l1}</div>
      <div style="font-size:46px;font-weight:600;letter-spacing:.04em;line-height:1.1;text-shadow:0 2px 16px #000">${l3 || "MOTION Boston"}</div>
      <div style="font-size:19px;font-weight:500;opacity:.7">${l2}</div>
    </div></body></html>`);
  await p.waitForTimeout(500);
  await p.screenshot({ path: out });
  await b.close();
})();
