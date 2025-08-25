import fs from 'fs';
import path from 'path';
import { executeCustomPrompt } from './auggie-integration.js';
import { initializePrompt } from './prompts/prompt.initialize.js';

export function getProjectDir(cwd = process.cwd()) {
  return path.join(cwd, '.qlood'); // project-local folder ./.qlood
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

export function scanProject(dir, level = 0) {
  if (level > 20) return []; // Avoid infinite loops and very deep trees
  const results = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === '.qlood') {
      continue;
    }

    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        results.push({
          name: file,
          type: 'directory',
          children: scanProject(filePath, level + 1),
        });
      } else {
        results.push({ name: file, type: 'file' });
      }
    } catch (e) {
      // Ignore files that we can't stat (e.g. broken symlinks)
    }
  }
  return results;
}

export function getProjectStructurePath(cwd = process.cwd()) {
  return path.join(getProjectDir(cwd), 'project-structure.json');
}

export function saveProjectStructure(structure, cwd = process.cwd()) {
  ensureProjectDirs(cwd);
  const p = getProjectStructurePath(cwd);
  fs.writeFileSync(p, JSON.stringify(structure, null, 2));
}

/**
 * Extracts clean markdown content from Auggie's response by removing tool call artifacts
 * @param {string} rawResponse - The raw response from Auggie
 * @returns {string} Clean markdown content
 */
function extractCleanMarkdown(rawResponse) {
  if (!rawResponse) return '';

  // Split response into lines for processing
  const lines = rawResponse.split('\n');
  const cleanLines = [];
  let inToolCall = false;
  let inCodeBlock = false;
  let skipNextEmoji = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Track code blocks to avoid filtering content within them
    if (trimmedLine.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      cleanLines.push(line);
      continue;
    }

    // If we're in a code block, preserve all content
    if (inCodeBlock) {
      cleanLines.push(line);
      continue;
    }

    // Detect start of tool calls
    if (trimmedLine.startsWith('<function_calls>') || trimmedLine.includes('[90m🔧 Tool call:')) {
      inToolCall = true;
      continue;
    }

    // Detect end of tool calls
    if (trimmedLine.startsWith('</function_calls>') || trimmedLine.includes('[90m📋 Tool result:')) {
      inToolCall = false;
      skipNextEmoji = true;
      continue;
    }

    // Skip lines that are part of tool calls
    if (inToolCall) {
      continue;
    }

    // Skip tool call artifacts and processing indicators
    if (
      trimmedLine.startsWith('<invoke') ||
      trimmedLine.startsWith('<') ||
      trimmedLine.startsWith('[90m') ||
      trimmedLine.includes('Tool call:') ||
      trimmedLine.includes('Tool result:') ||
      (skipNextEmoji && trimmedLine.startsWith('🤖'))
    ) {
      skipNextEmoji = false;
      continue;
    }

    // Skip lines that show truncated output
    if (trimmedLine.includes('... (') && trimmedLine.includes('more lines)')) {
      continue;
    }

    // Add the clean line
    cleanLines.push(line);
  }

  // Join lines and clean up excessive whitespace
  let cleanContent = cleanLines.join('\n');

  // Remove multiple consecutive blank lines
  cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n');

  // Trim leading and trailing whitespace
  cleanContent = cleanContent.trim();

  return cleanContent;
}

export async function generateProjectContext(cwd = process.cwd(), options = {}) {
  try {
    // Don't log here if called from TUI (it will handle the animation)
    if (!options.silent) {
      console.log('Generating project context with Auggie...');
    }

    // Execute the initialize prompt using Auggie
    const result = await executeCustomPrompt(initializePrompt, {
      cwd,
      usePrintFormat: true,
      timeout: 120000 // 2 minutes timeout for project analysis
    });

    if (!result.success) {
      if (!options.silent) {
        console.error('Failed to generate project context:', result.stderr);
      }
      return false;
    }

    // Extract clean markdown from the response
    const cleanMarkdown = extractCleanMarkdown(result.stdout);

    // Ensure the notes directory exists
    ensureProjectDirs(cwd);

    // Save the clean markdown to context.md
    const contextPath = path.join(getProjectDir(cwd), 'notes', 'context.md');
    fs.writeFileSync(contextPath, cleanMarkdown, 'utf-8');

    if (!options.silent) {
      console.log(`Project context saved to ${contextPath}`);
    }
    return true;
  } catch (error) {
    if (!options.silent) {
      console.error('Error generating project context:', error);
    }
    return false;
  }
}

export async function ensureProjectInit({ cwd = process.cwd(), force = false, skipContext = false } = {}) {
  const base = ensureProjectDirs(cwd);
  const p = getProjectConfigPath(cwd);
  let wasInitialized = false;

  if (!fs.existsSync(p) || force) {
    const detected = detectProjectConfig(cwd);
    saveProjectConfig(detected || defaultProjectConfig(), cwd);
    createBasicWorkflow(cwd);
    const structure = scanProject(cwd);
    saveProjectStructure(structure, cwd);
    wasInitialized = true;

    // Only generate context if not skipped (for TUI to handle with animation)
    if (!skipContext) {
      try {
        await generateProjectContext(cwd);
      } catch (error) {
        console.warn('Warning: Failed to generate project context:', error.message);
      }
    }
  }
  return { base, wasInitialized };
}