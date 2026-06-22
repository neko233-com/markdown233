import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const port = Number(process.env.MARKDOWN233_E2E_PORT || 4179);
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = 'e2e-artifacts';
const locales = (process.env.MARKDOWN233_E2E_LOCALES || 'zh-CN,en,zh-TW,ja,ko,es,fr,de,pt-BR,ru,ar,hi')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await wait(250);
  }
  throw new Error(`Vite server did not start at ${baseUrl}`);
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });

  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('#editor').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${outputDir}/desktop.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${outputDir}/mobile.png`, fullPage: true });

    await page.setViewportSize({ width: 1440, height: 920 });
    for (const locale of locales) {
      await page.evaluate((value) => localStorage.setItem('appLanguage', value), locale);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#editor').waitFor({ state: 'visible' });
      await page.screenshot({ path: `${outputDir}/desktop-${locale}.png`, fullPage: true });
    }

    const uiOk = await page.evaluate(() => {
      const editor = document.querySelector('#editor');
      const status = document.querySelector('.statusbar');
      return Boolean(editor && status && editor.getBoundingClientRect().width > 240);
    });
    if (!uiOk) throw new Error('Primary UI did not render with expected dimensions.');

    await browser.close();
    console.log(`Screenshots written to ${outputDir}/desktop.png, mobile.png, and ${locales.length} locale captures`);
  } finally {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      server.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
