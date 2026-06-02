import { chromium } from 'playwright';

const PORT = process.argv[2] || '8099';
const exts = process.argv[3] ? process.argv[3].split(',') : ['pdf', 'docx', 'pptx', 'hwp', 'hwpx'];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 840, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).split('\n')[0]));

for (const ext of exts) {
  const url = `http://localhost:${PORT}/rendertest.html?ext=${ext}&file=_testfiles/t.${ext}`;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    try { await page.waitForFunction(() => window.__done === true, { timeout: 40000 }); }
    catch (e) { console.log('  (timeout waiting render)'); }
    const err = await page.evaluate(() => window.__err || null);
    await page.screenshot({ path: `/tmp/shot_${ext}.png` });
    console.log(`${ext}: ${err ? 'ERR: ' + err : 'rendered'} -> /tmp/shot_${ext}.png`);
  } catch (e) {
    console.log(`${ext}: NAV FAIL ${String(e.message || e).split('\n')[0]}`);
  }
}
await browser.close();
