import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('.demo-ci-runtime/package.json'));
const { chromium } = require('playwright');
assert.equal(Boolean(process.env.DEMO_SMOKE_EMAIL), Boolean(process.env.DEMO_SMOKE_PASSWORD), 'Configure both smoke email and password');
const baseUrl = new URL(process.env.DEMO_URL);
assert.equal(baseUrl.protocol, 'https:', 'Public demo must use HTTPS');
const health = await fetch(new URL('/healthz', baseUrl), { signal: AbortSignal.timeout(30_000) });
assert.equal(health.status, 200, 'Backend health endpoint must return 200');
const healthBody = await health.json();
assert.equal(healthBody.status, 'ok', 'Backend health must be OK');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const scriptFailures = [];
  page.on('pageerror', (error) => scriptFailures.push(error.message));
  const response = await page.goto(baseUrl.href, { waitUntil: 'networkidle', timeout: 60_000 });
  assert.equal(response.status(), 200);
  await page.getByRole('button', { name: /continue with email|sign in/i }).first().waitFor({ state: 'visible', timeout: 60_000 });
  if (process.env.DEMO_SMOKE_EMAIL && process.env.DEMO_SMOKE_PASSWORD) {
    if (!(await page.getByPlaceholder('Email', { exact: true }).isVisible())) {
      await page.getByRole('button', { name: /continue with email/i }).first().click();
    }
    await page.getByPlaceholder('Email', { exact: true }).fill(process.env.DEMO_SMOKE_EMAIL);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input[type="password"]').fill(process.env.DEMO_SMOKE_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await page.getByText('Companies', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByText('People', { exact: true }).first().waitFor({ state: 'visible' });
  }
  assert.equal(scriptFailures.length, 0, 'App raised a browser exception');
  await mkdir('demo-smoke-artifacts', { recursive: true });
  await page.screenshot({ path: 'demo-smoke-artifacts/application.png', fullPage: true });
  console.log(process.env.DEMO_SMOKE_EMAIL ? 'Authenticated CRM smoke passed.' : 'Backend and browser sign-in smoke passed.');
} finally {
  await browser.close();
}
