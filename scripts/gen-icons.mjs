// Renders resources/icon.svg to PNG icons (needs Playwright with Chromium).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = readFileSync(new URL('../resources/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const [size, path] of [[192, 'public/icons/icon-192.png'], [512, 'public/icons/icon-512.png'], [512, 'resources/icon.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
