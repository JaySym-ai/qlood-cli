import { createChrome, ensurePage } from './chrome.js';
import { getHeadlessMode } from './config.js';


// Heuristic detection of sensitive fields to avoid logging secrets
async function isSensitiveField(page, selector) {
  try {
    return await page.$eval(selector, (el) => {
      const attr = (name) => (el.getAttribute ? (el.getAttribute(name) || '') : '');
      const type = String(attr('type') || '').toLowerCase();
      const name = String(attr('name') || '').toLowerCase();
      const id = String((el.id || '')).toLowerCase();
      const aria = String(attr('aria-label') || '').toLowerCase();
      const placeholder = String(attr('placeholder') || '').toLowerCase();
      if (type === 'password') return true;
      const blob = `${type} ${name} ${id} ${aria} ${placeholder}`;
      const keywords = ['password','pass','pwd','secret','token','apikey','api_key','authorization','auth','otp'];
      return keywords.some(k => blob.includes(k));
    });
  } catch (_) {
    try { return /password|pass|pwd|secret|token|apikey|api_key|authorization|auth|otp/i.test(String(selector)); } catch { return false; }
  }
}

function maskedLabel(text) {
  const len = (text?.length ?? 0);
  return `[masked ${len} chars]`;
}

// Best-effort: dismiss common consent/cookie overlays (Google/YouTube and similar)
export async function dismissConsentIfPresent(page) {
  const selectors = [
    // Google/YouTube variants
    'button[aria-label*="Accept" i]',
    'button[aria-label*="Agree" i]',
    '#introAgreeButton',
    'button[aria-label="Accept all"]',
    'button[aria-label="I agree"]',
    'form[action*="consent"] button[type="submit"]',
  ];

  async function tryClickInContext(ctx) {
    for (const sel of selectors) {
      try {
        await ctx.waitForSelector(sel, { timeout: 800, visible: true });
        await ctx.click(sel);
        await ctx.waitForTimeout(300);
        return true;
      } catch (_) {
        // continue
      }
    }
    return false;
  }

  try {
    // Try in main frame first
    if (await tryClickInContext(page)) return true;
    // Try in iframes (e.g., consent.google.com)
    const frames = page.frames();
    for (const f of frames) {
      try {
        // Heuristic: only try in consent-related frames or all as fallback
        const url = f.url() || '';
        if (url.includes('consent') || url.includes('privacy')) {
          if (await tryClickInContext(f)) return true;
        }
      } catch (_) {}
    }
    // Last pass: try in all frames briefly
    for (const f of frames) { if (await tryClickInContext(f)) return true; }
  } catch (_) {}
  return false;
}

export async function openCmd(url, opts = {}) {
  const { headless = getHeadlessMode(), debug = false, silent = false } = opts;
  await createChrome({ headless, debug });
  const page = await ensurePage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!silent) console.log(`Opened: ${url}`);
}

export async function gotoCmd(page, url, { silent = false } = {}) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Best-effort: dismiss consent dialogs that may block interactions
    try { await dismissConsentIfPresent(page); } catch {}
    if (!silent) console.log(`Navigated to: ${url}`);
  } catch (error) {
    if (error.message.includes('detached')) {
      throw new Error(`Navigation failed - page detached: ${url}`);
    }
    throw error;
  }
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
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.type(selector, text);
    if (!silent) {
      console.log(`Typed into ${selector}: ${maskedLabel(text)}`);
    }
  } catch (error) {
    if (error.message.includes('detached')) {
      throw new Error(`Typing failed - page detached: ${selector}`);
    }
    throw error;
  }
}
