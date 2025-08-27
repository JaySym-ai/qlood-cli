import { ensureProjectInit, loadProjectConfig, ensureProjectDirs, getProjectDir } from './project.js';
import { createChrome, ensurePage } from './chrome.js';
import { gotoCmd } from './commands.js';
import { executeCustomPrompt, checkAuthentication } from './auggie-integration.js';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { runAudits } from './audits.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHttp(url, { timeoutMs = 30000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return true;
    } catch (e) { lastError = e; }
    await sleep(intervalMs);
  }
  if (lastError) throw lastError;
  return false;
}

export async function runProjectTest(goal, { headless, debug, onLog, artifactsDir } = {}) {
  const cwd = process.cwd();
  // Don't skip context here - let it run normally for test command
  await ensureProjectInit({ cwd });
  const cfg = loadProjectConfig(cwd);
  if (!cfg) throw new Error('Project not initialized. Launch `qlood` and accept the init prompt.');

  const projectDir = ensureProjectDirs(cwd);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = artifactsDir || path.join(projectDir, 'results', runId);
  fs.mkdirSync(runDir, { recursive: true });

  const runLabel = path.basename(runDir);

  const log = (m) => { if (onLog) onLog(m); else console.log(m); };

  // Try to ensure dev server is reachable
  const baseUrl = (cfg.devServer?.url || '').trim();
  const readyPath = (cfg.devServer?.healthcheckPath || cfg.devServer?.readyPath || '/');
  const waitTimeoutMs = Number(cfg.devServer?.waitTimeoutMs ?? 60000);
  const waitIntervalMs = Number(cfg.devServer?.waitIntervalMs ?? 1000);

  if (!baseUrl) {
    log('No devServer.url configured; this project may not be a web app. Configure ./.qlood/qlood.json to point to your app URL.');
    throw new Error('No devServer.url configured in ./.qlood/qlood.json');
  }

  log(`Checking dev server at ${baseUrl}${readyPath} ...`);
  let serverStarted = false;
  try {
    await waitForHttp(new URL(readyPath, baseUrl).toString(), { timeoutMs: 2000, intervalMs: 500 });
  } catch {
    // Not ready; try to start if start command exists
    const startCmd = (cfg.devServer?.start || '').trim();
    if (startCmd) {
      const [cmd, ...args] = startCmd.split(' ');
      log(`Starting dev server: ${startCmd}`);
      const child = spawn(cmd, args, { cwd, stdio: ['ignore','pipe','pipe'], detached: true });
      serverStarted = true;
      // Pipe output to artifact log to avoid hijacking the UI
      try {
        child.stdout?.on('data', (d) => { try { fs.appendFileSync(path.join(runDir, 'devserver.log'), d); } catch {} });
        child.stderr?.on('data', (d) => { try { fs.appendFileSync(path.join(runDir, 'devserver.log'), d); } catch {} });
      } catch {}
      try { child.unref?.(); } catch {}
      // Give it time to warm up
      try {
        await waitForHttp(new URL(readyPath, baseUrl).toString(), { timeoutMs: waitTimeoutMs, intervalMs: waitIntervalMs });
      } catch (e) {
        log(`Warning: server not reachable yet: ${e?.message || e}`);
      }
      // Note: we do not kill the server; assume dev workflow
    } else {
      log('No devServer.start configured; proceeding anyway.');
    }
  }

  // Launch browser and navigate to app
  await createChrome({ headless: headless ?? cfg.browser?.headless ?? false, debug: !!debug });
  const page = await ensurePage();
  // Attach logging for console/network/errors to runDir
  // Additional listeners for timing and headers (for audits)
  const detailsPath = path.join(runDir, 'network.details.jsonl');
  const secHeadersPath = path.join(runDir, 'sec-headers.jsonl');
  const reqStart = new Map();
  page.on('request', req => {
    try { reqStart.set(req.url(), Date.now()); } catch {}
  });
  page.on('response', async res => {
    try {
      const url = res.url();
      const started = reqStart.get(url) || Date.now();
      const finished = Date.now();
      const durationMs = finished - started;
      const info = { url, status: res.status(), method: res.request().method(), durationMs };
      fs.appendFileSync(detailsPath, JSON.stringify(info) + '\n');

      // Capture selected security headers
      const headers = res.headers();
      const pick = (k) => headers[k] || headers[k.toLowerCase()] || undefined;
      const selected = {
        'content-security-policy': pick('content-security-policy'),
        'x-frame-options': pick('x-frame-options'),
        'x-content-type-options': pick('x-content-type-options'),
        'referrer-policy': pick('referrer-policy'),
        'strict-transport-security': pick('strict-transport-security'),
        'permissions-policy': pick('permissions-policy'),
      };
      const secLine = { url, status: res.status(), headers: selected };
      fs.appendFileSync(secHeadersPath, JSON.stringify(secLine) + '\n');
    } catch {}
  });

  const logPath = path.join(runDir, 'browser.log');
  const netPath = path.join(runDir, 'network.log');
  const append = (p, line) => { try { fs.appendFileSync(p, line + '\n'); } catch {} };
  page.on('console', msg => append(logPath, `[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => append(logPath, `[pageerror] ${err?.message || err}`));
  page.on('requestfailed', req => append(netPath, `[failed] ${req.failure()?.errorText || 'error'} ${req.method()} ${req.url()}`));
  page.on('response', res => append(netPath, `[response] ${res.status()} ${res.request().method()} ${res.url()}`));
  await gotoCmd(page, baseUrl, { silent: true });
  try { await page.waitForTimeout(500); } catch {}

  // Save initial screenshot into run directory
  const initialShot = path.join(runDir, 'initial.png');
  try { await page.screenshot({ path: initialShot, fullPage: true }); } catch {}

  // Run the AI-driven test scenario via Auggie (non-interactive)
  log(`Running test: ${goal}`);
  try {
    const auth = await checkAuthentication();
    if (!auth.success || !auth.authenticated) {
      throw new Error('Auggie authentication required. Run `auggie --login`.');
    }
    const res = await executeCustomPrompt(`Execute the following end-to-end test scenario using Playwright. Use headless mode.\n\nScenario:\n${goal}`, { usePrintFormat: true });
    const line = `[agent] ${res.success ? 'Completed' : 'Failed'}: ${res.stdout || res.stderr || ''}`.trim();
    if (onLog) onLog(line); else console.log(line);
    try { fs.appendFileSync(path.join(runDir, 'agent.log'), line + '\n'); } catch {}
  } finally {
    // Save final screenshot into run directory
    try {
      const finalShot = path.join(runDir, 'final.png');
      await page.screenshot({ path: finalShot, fullPage: true });
    } catch {}
  }

  // Emit simple HTML report
  const report = `<!doctype html>
<meta charset="utf-8" />
<title>qlood test report</title>
<style>body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:20px}code,pre{background:#f6f8fa;padding:8px;border-radius:6px}h1{font-size:20px} .muted{color:#666}</style>
<h1>qlood test report</h1>
<p class="muted">Run: ${runId}</p>
<ul>
  <li><b>Scenario:</b> ${goal}</li>
  <li><b>Base URL:</b> ${baseUrl}</li>
  <li><b>Healthcheck:</b> ${readyPath}</li>
  <li><b>Headless:</b> ${String(headless ?? cfg.browser?.headless ?? false)}</li>
  <li><b>Artifacts dir:</b> ${runDir}</li>
  <li><b>Initial screenshot:</b> ${path.join('.qlood','results',runLabel,'initial.png')}</li>
  <li><b>Final screenshot:</b> ${path.join('.qlood','results',runLabel,'final.png')}</li>
  <li><b>Agent log:</b> ${path.join('.qlood','results',runLabel,'agent.log')}</li>
  <li><b>Browser log:</b> ${path.join('.qlood','results',runLabel,'browser.log')}</li>
  <li><b>Network log:</b> ${path.join('.qlood','results',runLabel,'network.log')}</li>
  </ul>
<p>Open the artifacts locally to inspect details.</p>
`;
  try { fs.writeFileSync(path.join(runDir, 'report.html'), report); } catch {}

  log(`Test artifacts: ${runDir}`);
  if (serverStarted) {
    log('Dev server was started by qlood; leave it running for convenience.');
  }
}
