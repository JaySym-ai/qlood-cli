import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import { getHeadlessMode } from './config.js';

let context = null;
let currentPage = null;
let launchOptions = null;

// Options:
// - headless: boolean
// - debug: boolean (enables slowMo for visibility; does NOT auto-open devtools)
// - devtools: boolean (explicitly open Chrome DevTools)
// - maximize: boolean (start window maximized)
// - windowSize: { width: number, height: number }
export async function createChrome({ headless = getHeadlessMode(), debug = false, devtools = false, maximize = true, windowSize } = {}) {
  if (context) return context;
  // Save the first launch options and reuse conceptually for the session
  if (!launchOptions) launchOptions = { headless, debug, devtools, maximize, windowSize };
  // Use a persistent profile in the user home to look like a stable browser
  const userDataDir = path.join(os.homedir(), '.qlood-profile');
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-crash-reporter',
    '--no-default-browser-check',
  ];
  if (launchOptions.maximize) args.push('--start-maximized');
  
  const launchParams = {
    headless: launchOptions.headless,
    devtools: !!launchOptions.devtools,
    args,
    // slowMo is useful in debug to watch steps, but only when not in headless mode
    ...(launchOptions.debug && !launchOptions.headless ? { slowMo: 100 } : {}),
  };

  if (launchOptions.windowSize && !launchOptions.maximize) {
    const { width, height } = launchOptions.windowSize;
    if (width && height) launchParams.viewport = { width, height };
  }

  context = await chromium.launchPersistentContext(userDataDir, launchParams);

  const pages = context.pages();
  currentPage = pages[0] || (await context.newPage());
  // Only bring to front when not in headless mode
  if (!launchOptions.headless) {
    try { await currentPage.bringToFront(); } catch {}
  }
  // Best-effort cleanup on exit
  process.on('exit', async () => {
    try { await context?.close?.(); } catch {}
  });
  return context;
}

export async function getBrowserContext() {
  if (!context) throw new Error('Browser not started');
  return context;
}

export async function withPage(fn) {
  const ctx = await getBrowserContext();
  if (!currentPage) currentPage = await ctx.newPage();
  return fn(currentPage);
}

export async function setCurrentPage(page) {
  currentPage = page;
}

export async function listPages() {
  const ctx = await getBrowserContext();
  return ctx.pages();
}

export async function newTab() {
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  await setCurrentPage(page);
  return page;
}

export async function switchToTab(index) {
  const ctx = await getBrowserContext();
  const pages = ctx.pages();
  if (index < 0 || index >= pages.length) throw new Error(`Invalid tab index ${index}`);
  const page = pages[index];
  await page.bringToFront();
  await setCurrentPage(page);
}

export async function screenshot(page, path) {
  await page.screenshot({ path, fullPage: true });
}

export async function ensurePage() {
  const ctx = await getBrowserContext();
  
  // Check if current page is detached or closed
  if (currentPage && currentPage.isClosed()) {
    console.log('Page detached, creating new page...');
    currentPage = null;
  }
  
  if (!currentPage) {
    currentPage = await ctx.newPage();
  }
  
  return currentPage;
}

export async function closeBrowser() {
  if (context) {
    try { await context.close(); } catch {}
  }
  context = null;
  currentPage = null;
}

// Cancels current in-flight browser action by closing the browser.
// Next command will lazily relaunch with the saved launchOptions.
export async function cancelCurrentAction() {
  await closeBrowser();
}