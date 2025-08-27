import fs from 'fs';
import path from 'path';

export function getProjectDir(cwd = process.cwd()) {
  return path.join(cwd, '.qlood'); // project-local folder ./.qlood
}

export function ensureProjectDirs(cwd = process.cwd()) {
  const base = getProjectDir(cwd);
  const dirs = [
    base,
    path.join(base, 'results'),
    // Canonical directory for workflows
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
      headless: true
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

  // Determine if this looks like a web app with a dev server
  const devScript = String(scripts.dev || '');
  const startScript = String(scripts.start || '');
  const scriptHints = `${devScript} ${startScript}`.toLowerCase();
  const hasWebDeps = !!(deps.vite || deps.next || deps.nuxt || deps['nuxt3'] || deps.astro || deps['react-scripts'] || deps['@angular/core'] || deps['@angular/cli'] || deps['@redwoodjs/core']);
  const webScriptHint = /(vite|next|nuxt|astro|react-scripts|webpack|vite-node|parcel|gatsby|remix|svelte|angular|ember|redwood)/i.test(scriptHints);
  const looksWeb = hasWebDeps || webScriptHint;

  // Guess start command only for web-looking projects
  let startCmd = '';
  if (looksWeb) {
    if (scripts.dev) startCmd = 'npm run dev';
    else if (scripts.start) startCmd = 'npm start';
  }

  // Guess port by framework (best-effort)
  let port = 3000;
  if (deps.vite || /vite/.test(devScript)) port = 5173;
  else if (deps['@angular/core'] || deps['@angular/cli']) port = 4200;
  else if (deps.astro) port = 4321;
  else if (deps['@redwoodjs/core']) port = 8910;
  else if (deps['react-scripts']) port = 3000;
  else if (deps.next) port = 3000;
  else if (deps.nuxt || deps['nuxt3']) port = 3000;

  if (!looksWeb) {
    // For non-web/CLI projects, do not assume a dev server
    return {
      devServer: {
        url: '',
        start: '',
        healthcheckPath: '/',
        readyPath: '/',
        waitTimeoutMs: 60000,
        waitIntervalMs: 1000
      },
      browser: { headless: false },
      metadata: { createdAt: new Date().toISOString(), version: 1 }
    };
  }

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




// project-structure.json generation removed; no longer needed

/**
 * Extracts clean markdown content from Auggie's response by removing tool call artifacts
 * @param {string} rawResponse - The raw response from Auggie
 * @returns {string} Clean markdown content
 */
export function extractCleanMarkdown(rawResponse) {
  if (!rawResponse) return '';

  // Split response into lines for processing
  const lines = rawResponse.split('\n');
  const filtered = [];

  let inCodeBlock = false;
  let inCatListing = false; // after "Here's the result of running `cat -n`..."

  function isScanNarration(s) {
    const t = s.trim();
    return (
      /^je vais\b/i.test(t) ||
      /^(i'm|i am|i will|i’ll|i\'ll)\b/i.test(t) ||
      /^here('s| is| are)\b/i.test(t) ||
      /^file not found:/i.test(t) ||
      /^regex search results/i.test(t) ||
      /^total (matches|lines)/i.test(t) ||
      /^here's the files and directories/i.test(t) ||
      /^here's the result of running `cat -n`/i.test(t)
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Toggle code blocks; keep their content, but we may drop certain diagnostic blocks separately
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      // Do not automatically include the backtick lines; we'll rebuild content later
      filtered.push(line);
      continue;
    }

    // Handle cat -n listings introduced by narration
    if (/^here's the result of running `cat -n`/i.test(trimmed)) {
      inCatListing = true;
      continue;
    }
    if (inCatListing) {
      // Typical cat -n lines start with optional spaces + digits + a tab
      if (/^\s*\d+\t/.test(line)) {
        continue; // skip numbering lines
      }
      // End of listing when numbering pattern stops and a blank line or heading appears
      if (trimmed === '' || /^#{1,6}\s/.test(trimmed)) {
        inCatListing = false;
      }
      if (inCatListing) continue;
    }

    // Skip generic scan narration and directory listings
    if (isScanNarration(trimmed)) continue;

    if (
      trimmed.startsWith('<invoke') ||
      trimmed.startsWith('<') ||
      trimmed.startsWith('[90m') ||
      // Removed legacy tool-call scrubbers (now unused)
      trimmed.startsWith("I'll quickly scan") ||
      trimmed.startsWith("I'll list") ||
      trimmed.startsWith('Running these')
    ) {
      continue;
    }

    // Skip truncated output markers
    if (trimmed.includes('... (') && trimmed.includes('more lines)')) continue;

    filtered.push(line);
  }

  // Join lines and normalize whitespace
  let content = filtered.join('\n');
  content = content.replace(/\n{3,}/g, '\n\n').trim();

  // Heuristic: keep from the last substantial heading block onward
  // Find candidate heading indices (outside code blocks approximation)
  const lines2 = content.split('\n');
  const headingIdxs = [];
  let code = false;
  for (let i = 0; i < lines2.length; i++) {
    const t = lines2[i].trim();
    if (t.startsWith('```')) { code = !code; continue; }
    if (code) continue;
    if (/^#{1,3}\s/.test(t)) headingIdxs.push(i);
  }
  if (headingIdxs.length) {
    // Choose the last heading that leaves at least ~80 lines or 2 headings after it
    let pick = headingIdxs[0];
    for (const idx of headingIdxs) {
      const remaining = lines2.length - idx;
      const nextHeadings = headingIdxs.filter(h => h > idx).length;
      if (remaining >= 80 || nextHeadings >= 2) pick = idx;
    }
    content = lines2.slice(pick).join('\n').trim();
  }

  return content;
}



export async function ensureProjectInit({ cwd = process.cwd(), force = false } = {}) {
  const base = ensureProjectDirs(cwd);
  const p = getProjectConfigPath(cwd);
  let wasInitialized = false;

  if (!fs.existsSync(p) || force) {
    // Ensure ./.qlood/results exists
    try { fs.mkdirSync(path.join(base, 'results'), { recursive: true }); } catch {}

    const detected = detectProjectConfig(cwd);
    saveProjectConfig(detected || defaultProjectConfig(), cwd);
    wasInitialized = true;

    // Create MCP config for Playwright (used by Auggie)
    try {
      const mcpPath = path.join(base, 'mcp-config.json');
      const mcpConfig = {
        mcpServers: {
          Playwright: {
            command: 'npx',
            args: ['-y', '@playwright/mcp@latest']
          }
        }
      };
      fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Warning: Failed to create MCP config:', e.message);
    }
  }
  return { base, wasInitialized };
}
