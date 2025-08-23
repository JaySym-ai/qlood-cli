import { ensureProjectInit, loadProjectConfig, ensureProjectDirs, getProjectDir } from './project.js';
import { createChrome, ensurePage } from './chrome.js';
import { gotoCmd } from './commands.js';
import { runAgent } from './agent.js';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

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

export async function runProjectTest(goal, { headless, debug, onLog } = {}) {
  const cwd = process.cwd();
  ensureProjectInit({ cwd });
  const cfg = loadProjectConfig(cwd);
  if (!cfg) throw new Error('Project not initialized. Launch `qlood` and accept the init prompt.');

  const projectDir = ensureProjectDirs(cwd);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(projectDir, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });

  const log = (m) => { if (onLog) onLog(m); else console.log(m); };

  // Try to ensure dev server is reachable
  const baseUrl = cfg.devServer?.url || 'http://localhost:3000';
  const readyPath = (cfg.devServer?.healthcheckPath || cfg.devServer?.readyPath || '/');
  const waitTimeoutMs = Number(cfg.devServer?.waitTimeoutMs ?? 60000);
  const waitIntervalMs = Number(cfg.devServer?.waitIntervalMs ?? 1000);
  log(`Checking dev server at ${baseUrl}${readyPath} ...`);
  let serverStarted = false;
  try {
    await waitForHttp(new URL(readyPath, baseUrl).toString(), { timeoutMs: 2000, intervalMs: 500 });
  } catch {
    // Not ready; try to start if start command exists
    const startCmd = cfg.devServer?.start;
    if (startCmd) {
      const [cmd, ...args] = startCmd.split(' ');
      log(`Starting dev server: ${startCmd}`);
      const child = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit' });
      serverStarted = true;
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
  const logPath = path.join(runDir, 'browser.log');
  const netPath = path.join(runDir, 'network.log');
  const append = (p, line) => { try { fs.appendFileSync(p, line + '\n'); } catch {} };
  page.on('console', msg => append(logPath, `[console:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => append(logPath, `[pageerror] ${err?.message || err}`));
  page.on('requestfailed', req => append(netPath, `[failed] ${req.failure()?.errorText || 'error'} ${req.method()} ${req.url()}`));
  page.on('response', res => append(netPath, `[response] ${res.status()} ${res.request().method()} ${res.url()}`));
  await gotoCmd(page, baseUrl, { silent: true });
  try { await page.waitForTimeout(500); } catch {}

  // Save initial screenshot
  const initialShot = path.join(projectDir, 'screenshots', `${runId}-initial.png`);
  try { await page.screenshot({ path: initialShot, fullPage: true }); } catch {}

  // Run the AI-driven test scenario
  log(`Running test: ${goal}`);
  try {
    await runAgent(goal, { debug: !!debug, headless: headless ?? cfg.browser?.headless ?? false, promptForApiKey: true, onLog: (m) => {
      const line = `[agent] ${m}`;
      if (onLog) onLog(line); else console.log(line);
      try { fs.appendFileSync(path.join(runDir, 'agent.log'), line + '\n'); } catch {}
    }});
  } finally {
    // Save final screenshot
    try {
      const finalShot = path.join(projectDir, 'screenshots', `${runId}-final.png`);
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
  <li><b>Initial screenshot:</b> .qlood/screenshots/${path.basename(initialShot)}</li>
  <li><b>Final screenshot:</b> .qlood/screenshots/${runId}-final.png</li>
  <li><b>Agent log:</b> ${path.join('.qlood','runs',runId,'agent.log')}</li>
  <li><b>Browser log:</b> ${path.join('.qlood','runs',runId,'browser.log')}</li>
  <li><b>Network log:</b> ${path.join('.qlood','runs',runId,'network.log')}</li>
  </ul>
<p>Open the artifacts locally to inspect details.</p>
`;
  try { fs.writeFileSync(path.join(runDir, 'report.html'), report); } catch {}

  log(`Test artifacts: ${runDir}`);
  if (serverStarted) {
    log('Dev server was started by qlood; leave it running for convenience.');
  }
}
