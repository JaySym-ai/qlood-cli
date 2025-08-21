import { createChrome, ensurePage } from './chrome.js';

export async function openCmd(url, opts = {}) {
  const { headless = false, debug = false, silent = false } = opts;
  await createChrome({ headless, debug });
  const page = await ensurePage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!silent) console.log(`Opened: ${url}`);
}

export async function gotoCmd(page, url, { silent = false } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!silent) console.log(`Navigated to: ${url}`);
}

export async function clickCmd(page, selector, { silent = false } = {}) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector);
  if (!silent) console.log(`Clicked: ${selector}`);
}

export async function typeCmd(page, selector, text, { silent = false } = {}) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.type(selector, text);
  if (!silent) console.log(`Typed into ${selector}: ${text}`);
}
