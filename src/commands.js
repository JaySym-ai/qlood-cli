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
  try {
    // Try the main selector first
    await page.waitForSelector(selector, { timeout: 5000 });
    await page.click(selector);
    if (!silent) console.log(`Clicked: ${selector}`);
    return;
  } catch (error) {
    if (!silent) console.log(`Primary selector failed: ${selector}, trying fallbacks...`);
    
    // If it's a complex selector, try each part individually
    if (selector.includes(',')) {
      const parts = selector.split(',').map(s => s.trim());
      for (const part of parts) {
        try {
          await page.waitForSelector(part, { timeout: 2000 });
          await page.click(part);
          if (!silent) console.log(`Clicked fallback: ${part}`);
          return;
        } catch (e) {
          // Continue to next part
        }
      }
    }
    
    // Last resort: try common search button selectors
    const fallbackSelectors = [
      '[aria-label*="Search" i]',
      'button[type="submit"]',
      'input[type="submit"]',
      '[role="button"][aria-label*="search" i]',
      '.search-button',
      '#search-button'
    ];
    
    for (const fallback of fallbackSelectors) {
      try {
        await page.waitForSelector(fallback, { timeout: 1000 });
        await page.click(fallback);
        if (!silent) console.log(`Clicked fallback: ${fallback}`);
        return;
      } catch (e) {
        // Continue to next fallback
      }
    }
    
    throw new Error(`All click attempts failed for selector: ${selector}`);
  }
}

export async function typeCmd(page, selector, text, { silent = false } = {}) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.type(selector, text);
  if (!silent) console.log(`Typed into ${selector}: ${text}`);
}
