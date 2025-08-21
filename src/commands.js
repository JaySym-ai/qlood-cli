import { createChrome, ensurePage } from './chrome.js';

export async function openCmd(url, opts = {}) {
  const { headless = false, debug = false } = opts;
  await createChrome({ headless, debug });
  const page = await ensurePage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  console.log(`Opened: ${url}`);
}

export async function gotoCmd(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  console.log(`Navigated to: ${url}`);
}

export async function clickCmd(page, selector) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector);
  console.log(`Clicked: ${selector}`);
}

export async function typeCmd(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.type(selector, text);
  console.log(`Typed into ${selector}: ${text}`);
}

