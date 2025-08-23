import fs from 'fs';
import path from 'path';

export function getProjectDir(cwd = process.cwd()) {
  return path.join(cwd, 'qlood'); // project-local folder ./qlood
}

export function ensureProjectDirs(cwd = process.cwd()) {
  const base = getProjectDir(cwd);
  const dirs = [
    base,
    path.join(base, 'notes'),
    path.join(base, 'screenshots'),
    path.join(base, 'runs'),
    path.join(base, 'workflows'),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  return base;
}

export function getProjectConfigPath(cwd = process.cwd()) {
  return path.join(getProjectDir(cwd), 'qlood.json');
}

export function loadProjectConfig(cwd = process.cwd()) {
  const p = getProjectConfigPath(cwd);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

export function saveProjectConfig(cfg, cwd = process.cwd()) {
  ensureProjectDirs(cwd);
  const p = getProjectConfigPath(cwd);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

export function defaultProjectConfig() {
  return {
    devServer: {
      url: 'http://localhost:3000',
      start: 'npm run dev',
      readyPath: '/',
      healthcheckPath: '/',
      waitTimeoutMs: 60000,
      waitIntervalMs: 1000
    },
    browser: {
      headless: false
    },
    metadata: {
      createdAt: new Date().toISOString(),
      version: 1
    }
  };
}

export function detectProjectConfig(cwd = process.cwd()) {
  const pkgPath = path.join(cwd, 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch {}
  const scripts = pkg?.scripts || {};
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  // Guess start command
  let startCmd = '';
  if (scripts.dev) startCmd = 'npm run dev';
  else if (scripts.start) startCmd = 'npm start';

  // Guess port by framework (best-effort)
  let port = 3000;
  if (deps.vite || /vite/.test(scripts.dev || '')) port = 5173;
  else if (deps['@angular/core'] || deps['@angular/cli']) port = 4200;
  else if (deps.astro) port = 4321;
  else if (deps['@redwoodjs/core']) port = 8910;
  else if (deps['react-scripts']) port = 3000;
  else if (deps.next) port = 3000;
  else if (deps.nuxt || deps['nuxt3']) port = 3000;

  const urlStr = `http://localhost:${port}`;

  return {
    devServer: {
      url: urlStr,
      start: startCmd || 'npm run dev',
      healthcheckPath: '/',
      readyPath: '/',
      waitTimeoutMs: 60000,
      waitIntervalMs: 1000
    },
    browser: { headless: false },
    metadata: { createdAt: new Date().toISOString(), version: 1 }
  };
}

export function createBasicWorkflow(cwd = process.cwd()) {
  ensureProjectDirs(cwd);
  const p = path.join(getProjectDir(cwd), 'workflows', 'basic-smoke.md');
  if (!fs.existsSync(p)) {
    const content = [
      '# qlood basic smoke test',
      '',
      'Try these scenarios with `qlood test` or paste into the TUI:',
      '',
      '- Open the homepage and ensure the header is visible.',
      '- Navigate to the login page, try invalid credentials, and capture validation.',
      '- Create a new account, log out, and log back in.',
      '- Create a sample item/post and verify it appears in the list.',
      ''
    ].join('\n');
    try { fs.writeFileSync(p, content); } catch {}
  }
}

export function ensureProjectInit({ cwd = process.cwd(), force = false } = {}) {
  const base = ensureProjectDirs(cwd);
  const p = getProjectConfigPath(cwd);
  if (!fs.existsSync(p) || force) {
    const detected = detectProjectConfig(cwd);
    saveProjectConfig(detected || defaultProjectConfig(), cwd);
    createBasicWorkflow(cwd);
  }
  return base;
}
