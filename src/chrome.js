import puppeteer from 'puppeteer';
import os from 'os';
import path from 'path';

let browser = null;
let currentPage = null;
let launchOptions = null;

// Options:
// - headless: boolean
// - debug: boolean (enables slowMo for visibility; does NOT auto-open devtools)
// - devtools: boolean (explicitly open Chrome DevTools)
// - maximize: boolean (start window maximized)
// - windowSize: { width: number, height: number }
export async function createChrome({ headless = false, debug = false, devtools = false, maximize = true, windowSize } = {}) {
  if (browser) return browser;
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
  if (launchOptions.windowSize && !launchOptions.maximize) {
    const { width, height } = launchOptions.windowSize;
    if (width && height) args.push(`--window-size=${width},${height}`);
  }

  browser = await puppeteer.launch({
    headless: launchOptions.headless ?? !launchOptions.debug,
    devtools: !!launchOptions.devtools,
    defaultViewport: null, // let viewport match the browser window size
    // slowMo is useful in debug to watch steps
    ...(launchOptions.debug ? { slowMo: 100 } : {}),
    userDataDir,
    args,
  });
  const pages = await browser.pages();
  currentPage = pages[0] || (await browser.newPage());
  try { await currentPage.bringToFront(); } catch {}
  // Best-effort cleanup on exit
  process.on('exit', async () => {
    try { await browser?.close?.(); } catch {}
  });
  return browser;
}

export async function getBrowser() {
  if (!browser) throw new Error('Browser not started');
  return browser;
}

export async function withPage(fn) {
  const b = await getBrowser();
  if (!currentPage) currentPage = await b.newPage();
  return fn(currentPage);
}

export async function setCurrentPage(page) {
  currentPage = page;
}

export async function listPages() {
  const b = await getBrowser();
  return b.pages();
}

export async function newTab() {
  const b = await getBrowser();
  const page = await b.newPage();
  await setCurrentPage(page);
  return page;
}

export async function switchToTab(index) {
  const b = await getBrowser();
  const pages = await b.pages();
  if (index < 0 || index >= pages.length) throw new Error(`Invalid tab index ${index}`);
  await setCurrentPage(pages[index]);
}

export async function screenshot(page, path) {
  await page.screenshot({ path, fullPage: true });
}

export async function ensurePage() {
  const b = await getBrowser();
  
  // Check if current page is detached or closed
  if (currentPage) {
    try {
      await currentPage.evaluate(() => document.title);
    } catch (error) {
      // Page is detached/closed, create a new one
      console.log('Page detached, creating new page...');
      currentPage = null;
    }
  }
  
  if (!currentPage) {
    currentPage = await b.newPage();
  }
  
  return currentPage;
}

export async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch {}
  }
  browser = null;
  currentPage = null;
}

// Cancels current in-flight browser action by closing the browser.
// Next command will lazily relaunch with the saved launchOptions.
export async function cancelCurrentAction() {
  await closeBrowser();
}
