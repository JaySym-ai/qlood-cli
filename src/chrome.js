import puppeteer from 'puppeteer';

let browser = null;
let currentPage = null;

export async function createChrome({ headless = false, debug = false } = {}) {
  if (browser) return browser;
  browser = await puppeteer.launch({
    headless: headless ?? !debug,
    devtools: !!debug,
    // slowMo is useful in debug to watch steps
    ...(debug ? { slowMo: 100 } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  const pages = await browser.pages();
  currentPage = pages[0] || (await browser.newPage());
  return browser;
}

export async function getBrowser() {
  if (!browser) await createChrome({});
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
  if (!currentPage) currentPage = await b.newPage();
  return currentPage;
}

