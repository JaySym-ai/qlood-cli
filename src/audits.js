import fs from 'fs';
import path from 'path';

function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function safeReadLines(p) { const t = safeRead(p); return t ? t.split('\n').filter(Boolean) : []; }
function writeJson(p, obj) { try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch {} }
function writeText(p, txt) { try { fs.writeFileSync(p, txt); } catch {} }

function summarize(severityList) {
  if (severityList.includes('error')) return 'error';
  if (severityList.includes('warning')) return 'warning';
  return 'success';
}

function maskSecret(s) {
  if (!s) return s;
  if (s.length <= 6) return '*'.repeat(s.length);
  return s.slice(0, 3) + '***' + s.slice(-3);
}

function auditConsoleLogs(runDir) {
  const lines = safeReadLines(path.join(runDir, 'browser.log'));
  const pageErrors = lines.filter(l => l.includes('[pageerror]')).length;
  const consoleErrors = lines.filter(l => l.includes('[console:error]')).length;
  const consoleWarnings = lines.filter(l => l.includes('[console:warning]')).length;
  const severity = pageErrors > 0 ? 'error' : (consoleErrors > 0 || consoleWarnings > 3) ? 'warning' : 'success';
  return {
    name: 'console', severity,
    metrics: { pageErrors, consoleErrors, consoleWarnings },
    samples: {
      pageerror: lines.find(l => l.includes('[pageerror]')) || null,
      error: lines.find(l => l.includes('[console:error]')) || null,
      warning: lines.find(l => l.includes('[console:warning]')) || null,
    }
  };
}

function parseNetworkResponseLine(line) {
  // Example: [response] 200 GET https://...
  const m = line.match(/^\[response\]\s+(\d{3})\s+([A-Z]+)\s+(.*)$/);
  if (!m) return null;
  return { status: Number(m[1]), method: m[2], url: m[3] };
}

function auditNetwork(runDir) {
  const baseLines = safeReadLines(path.join(runDir, 'network.log'));
  const detailsLines = safeReadLines(path.join(runDir, 'network.details.jsonl'));

  let failed = baseLines.filter(l => l.startsWith('[failed]')).length;
  const responses = baseLines.map(parseNetworkResponseLine).filter(Boolean);
  const statuses = responses.map(r => r.status);
  const s5xx = statuses.filter(s => s >= 500 && s <= 599).length;
  const s4xx = statuses.filter(s => s >= 400 && s <= 499).length;
  const redirects = statuses.filter(s => s >= 300 && s <= 399).length;

  let slow2s = 0, slow5s = 0;
  for (const line of detailsLines) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj.durationMs === 'number') {
        if (obj.durationMs >= 5000) slow5s++;
        else if (obj.durationMs >= 2000) slow2s++;
      }
    } catch {}
  }

  const severity = (failed > 0 || s5xx > 0 || slow5s > 0) ? 'error'
                  : (s4xx > 0 || slow2s > 0 || redirects > 10) ? 'warning'
                  : 'success';

  return {
    name: 'network', severity,
    metrics: { failed, s5xx, s4xx, redirects, slow2s, slow5s },
  };
}

function auditSecurityHeaders(runDir) {
  const lines = safeReadLines(path.join(runDir, 'sec-headers.jsonl'));
  let checked = 0; let missingCritical = 0; let weak = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      checked++;
      const h = (obj.headers || {});
      const csp = h['content-security-policy'];
      const xfo = h['x-frame-options'];
      const xcto = h['x-content-type-options'];
      const rp = h['referrer-policy'];
      const hsts = h['strict-transport-security'];
      const pp = h['permissions-policy'];
      if (!csp) missingCritical++;
      if (!xfo || !xcto || !rp || !hsts || !pp) weak++;
    } catch {}
  }
  const severity = missingCritical > 0 ? 'warning' : weak > 0 ? 'warning' : 'success';
  return { name: 'security_headers', severity, metrics: { checked, missingCritical, weak } };
}

function auditDeadLinks(runDir) {
  const lines = safeReadLines(path.join(runDir, 'network.log'));
  const responses = lines.map(parseNetworkResponseLine).filter(Boolean);
  const s404 = responses.filter(r => r.status === 404 || r.status === 410).length;
  const severity = s404 > 0 ? (s404 > 3 ? 'error' : 'warning') : 'success';
  return { name: 'dead_links', severity, metrics: { notFound: s404 } };
}

function auditApiKeyExposure(runDir) {
  const sources = {
    'final.html': safeRead(path.join(runDir, 'final.html')),
    'browser.log': safeRead(path.join(runDir, 'browser.log')),
    'agent.log': safeRead(path.join(runDir, 'agent.log')),
    'network.log': safeRead(path.join(runDir, 'network.log')),
  };
  const patterns = [
    { name: 'openai', re: /sk-[A-Za-z0-9]{20,}/g },
    { name: 'github', re: /ghp_[A-Za-z0-9]{36,}/g },
    { name: 'aws', re: /AKIA[0-9A-Z]{16}/g },
    { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{20,}/g },
    { name: 'api_key_url', re: /api[_-]?key=([A-Za-z0-9._-]{10,})/gi },
  ];
  const findings = [];
  for (const [name, text] of Object.entries(sources)) {
    for (const p of patterns) {
      const m = text.match(p.re);
      if (m && m.length) {
        for (const raw of m.slice(0, 20)) {
          const token = raw.includes('=') ? raw.split('=').pop() : raw.replace(/^Bearer\s+/i, '');
          findings.push({ source: name, kind: p.name, sample: maskSecret(token || raw) });
        }
      }
    }
  }
  const severity = findings.length > 0 ? 'error' : 'success';
  return { name: 'api_key_exposure', severity, findings };
}

function auditUIUX(runDir) {
  const html = safeRead(path.join(runDir, 'final.html')) || '';
  const hasTitle = /<title>[^<]{1,200}<\/title>/i.test(html);
  const hasH1 = /<h1\b[^>]*>/i.test(html);
  const imgNoAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) || []).length;
  const severity = (!hasTitle || !hasH1) ? 'warning' : (imgNoAlt > 5 ? 'warning' : 'success');
  return { name: 'ui_ux', severity, metrics: { hasTitle, hasH1, imgMissingAlt: imgNoAlt } };
}

function auditUrlRewrite(runDir) {
  const lines = safeReadLines(path.join(runDir, 'network.log'));
  const responses = lines.map(parseNetworkResponseLine).filter(Boolean);
  const redirects = responses.filter(r => r.status >= 300 && r.status <= 399).length;
  const severity = redirects > 10 ? 'warning' : 'success';
  return { name: 'url_rewrite_safety', severity, metrics: { redirects } };
}

async function auditAuthValidation(page, runDir, cfg) {
  try {
    const auth = cfg?.auth || {};
    const baseUrl = cfg?.devServer?.url || '';
    const protectedPaths = Array.isArray(auth.protectedPaths) ? auth.protectedPaths : [];
    const loginPath = auth.loginPath || '/login';

    if (!page || !baseUrl || protectedPaths.length === 0) {
      return { name: 'auth_validation', severity: 'success', skipped: true };
    }

    let checked = 0, ok = 0, failed = 0;
    const samples = [];

    for (const pth of protectedPaths) {
      checked++;
      const url = new URL(pth, baseUrl).toString();
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        const finalUrl = page.url();
        const status = response?.status?.() || 0;
        const redirectedToLogin = loginPath && finalUrl.includes(loginPath);
        const protectedByStatus = status === 401 || status === 403;
        const isOk = redirectedToLogin || protectedByStatus;
        if (isOk) ok++; else failed++;
        samples.push({ path: pth, status, finalUrl, ok: isOk });
      } catch (e) {
        failed++;
        samples.push({ path: pth, error: e.message, ok: false });
      }
    }

    const severity = failed > 0 ? 'error' : 'success';
    // Best-effort: write a small auth audit detail file
    try { writeJson(path.join(runDir, 'audit.auth.json'), { checked, ok, failed, samples }); } catch {}
    return { name: 'auth_validation', severity, metrics: { checked, ok, failed } };
  } catch (e) {
    return { name: 'auth_validation', severity: 'warning', error: e.message };
  }
}

export async function runAudits(page, runDir, cfg) {
  try {
    const results = [];
    results.push(auditConsoleLogs(runDir));
    results.push(auditNetwork(runDir));
    results.push(auditSecurityHeaders(runDir));
    results.push(auditDeadLinks(runDir));
    results.push(auditApiKeyExposure(runDir));
    results.push(auditUIUX(runDir));
    results.push(auditUrlRewrite(runDir));
    // Auth validation (only runs if cfg.auth is set with protectedPaths)
    results.push(await auditAuthValidation(page, runDir, cfg));

    const overall = summarize(results.map(r => r.severity));
    const out = { overall, results, generatedAt: new Date().toISOString() };
    writeJson(path.join(runDir, 'audits.json'), out);

    const md = [
      `# qlood audits`,
      ``,
      `Overall: ${overall.toUpperCase()}`,
      ``,
      ...results.map(r => `- ${r.name}: ${r.severity}${r.metrics ? ` ${JSON.stringify(r.metrics)}` : ''}`),
    ].join('\n');
    writeText(path.join(runDir, 'audits.md'), md + '\n');
    return out;
  } catch (e) {
    // Best-effort; never throw
    try { writeText(path.join(runDir, 'audits.md'), `Audits failed: ${e.message}\n`); } catch {}
    return { overall: 'warning', error: e.message };
  }
}

