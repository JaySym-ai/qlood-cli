import fs from 'fs';
import path from 'path';
import { executeCustomPrompt } from './auggie-integration.js';
import { initializePrompt } from './prompts/prompt.initialize.js';
import { simpleInitializePrompt } from './prompts/prompt.initialize-simple.js';

export function getProjectDir(cwd = process.cwd()) {
  return path.join(cwd, '.qlood'); // project-local folder ./.qlood
}

export function ensureProjectDirs(cwd = process.cwd()) {
  const base = getProjectDir(cwd);
  const dirs = [
    base,
    path.join(base, 'notes'),
    path.join(base, 'screenshots'),
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
      console.log('Generating project context with Auggie... This may take several minutes.');
    }

    // Try the comprehensive prompt first
    let result = await executeCustomPrompt(initializePrompt, {
      cwd,
      usePrintFormat: true,
      timeout: 120000 // 2 minutes timeout for project analysis
    });

    // If the comprehensive prompt fails, try the simple one
    if (!result.success) {
      if (!options.silent) {
        console.log('Comprehensive analysis failed, trying simplified analysis...');
      }

      result = await executeCustomPrompt(simpleInitializePrompt, {
        cwd,
        usePrintFormat: true,
        timeout: 60000 // 1 minute timeout for simple analysis
      });
    }

    // If both Auggie attempts fail, use manual fallback
    if (!result.success) {
      if (!options.silent) {
        console.log('Auggie analysis failed, generating basic context manually...');
      }

      const manualContext = generateManualContext(cwd);

      // Ensure the notes directory exists
      ensureProjectDirs(cwd);

      // Save the manual context to context.md
      const contextPath = path.join(getProjectDir(cwd), 'notes', 'context.md');
      fs.writeFileSync(contextPath, manualContext, 'utf-8');

      if (!options.silent) {
        console.log(`Basic project context saved to ${contextPath}`);
      }
      return true;
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

/**
 * Generate a basic project context manually when Auggie is not available
 * @param {string} cwd - Current working directory
 * @returns {string} - Basic markdown context
 */
function generateManualContext(cwd = process.cwd()) {
  let context = '# Project Context\n\n';
  context += '*This context was generated automatically when AI analysis was unavailable.*\n\n';

  // Try to read package.json
  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      context += '## Project Information\n\n';
      context += `**Name:** ${packageJson.name || 'Unknown'}\n\n`;
      context += `**Version:** ${packageJson.version || 'Unknown'}\n\n`;

      if (packageJson.description) {
        context += `**Description:** ${packageJson.description}\n\n`;
      }

      // Scripts
      if (packageJson.scripts) {
        context += '## Available Scripts\n\n';
        Object.entries(packageJson.scripts).forEach(([name, command]) => {
          context += `- **${name}:** \`${command}\`\n`;
        });
        context += '\n';
      }

      // Dependencies
      if (packageJson.dependencies) {
        context += '## Dependencies\n\n';
        const deps = Object.keys(packageJson.dependencies);
        deps.slice(0, 10).forEach(dep => {
          context += `- ${dep}\n`;
        });
        if (deps.length > 10) {
          context += `- ... and ${deps.length - 10} more\n`;
        }
        context += '\n';
      }
    } catch (error) {
      context += '## Project Information\n\n';
      context += '*Could not parse package.json*\n\n';
    }
  }

  // Try to read README
  const readmePaths = ['README.md', 'README.txt', 'README'];
  for (const readmePath of readmePaths) {
    const fullReadmePath = path.join(cwd, readmePath);
    if (fs.existsSync(fullReadmePath)) {
      try {
        const readmeContent = fs.readFileSync(fullReadmePath, 'utf-8');
        context += '## README Content\n\n';
        // Include first 1000 characters of README
        const truncatedReadme = readmeContent.length > 1000
          ? readmeContent.substring(0, 1000) + '...'
          : readmeContent;
        context += truncatedReadme + '\n\n';
        break;
      } catch (error) {
        // Continue to next README file
      }
    }
  }

  context += '## Getting Started\n\n';
  context += 'To get started with this project:\n\n';
  context += '1. Install dependencies: `npm install` or `yarn install`\n';
  context += '2. Check available scripts in package.json\n';
  context += '3. Run the development server (typically `npm start` or `npm run dev`)\n\n';

  context += '---\n\n';
  context += '*To get a more detailed analysis, ensure Auggie is properly authenticated and try regenerating this context.*\n';

  return context;
}

export async function ensureProjectInit({ cwd = process.cwd(), force = false, skipContext = false } = {}) {
  const base = ensureProjectDirs(cwd);
  const p = getProjectConfigPath(cwd);
  let wasInitialized = false;

  if (!fs.existsSync(p) || force) {
    // Ensure ./.qlood/results exists
    try { fs.mkdirSync(path.join(base, 'results'), { recursive: true }); } catch {}

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