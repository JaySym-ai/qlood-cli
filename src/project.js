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


// Cache for parsed .gitignore patterns
let gitignorePatterns = null;
let gitignoreCache = new Map();

/**
 * Parse .gitignore file and return patterns for filtering
 */
function parseGitignore(cwd) {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return [];
  }

  try {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    return gitignoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(pattern => {
        // Convert gitignore patterns to regex-friendly format
        let regexPattern = pattern
          .replace(/\./g, '\\.')  // Escape dots
          .replace(/\*/g, '[^/]*') // * matches anything except /
          .replace(/\?\?/g, '*')   // Convert ** back to * for recursive matching
          .replace(/\*\*/g, '.*'); // ** matches anything including /

        // Handle directory patterns (ending with /)
        if (pattern.endsWith('/')) {
          regexPattern = regexPattern.slice(0, -1) + '(?:/.*)?';
        }

        return new RegExp(`^${regexPattern}$`);
      });
  } catch (e) {
    return [];
  }
}

/**
 * Check if a file/directory should be ignored based on patterns
 */
function shouldIgnore(filePath, rootDir, patterns) {
  // Get relative path from project root
  const relativePath = path.relative(rootDir, filePath);
  const fileName = path.basename(filePath);

  // Always ignore these directories regardless of .gitignore
  const alwaysIgnore = [
    'node_modules',
    '.git',
    '.qlood',
    '.augment',
    '.claude',
    '.github',
    '.playwright-mcp',
    '.vercel',
    '.vscode',
    '.svelte-kit',
    'build',
    'dist',
    'out',
    '.next',
    '.nuxt',
    'coverage',
    '.nyc_output',
    'tmp',
    'temp',
    '.cache',
    '.parcel-cache',
    '.webpack'
  ];

  // Check if filename or relative path matches always-ignore patterns
  if (alwaysIgnore.includes(fileName)) {
    return true;
  }

  // Check if any part of the path contains ignored directories
  const pathParts = relativePath.split(path.sep);
  if (pathParts.some(part => alwaysIgnore.includes(part))) {
    return true;
  }

  // Check gitignore patterns
  for (const pattern of patterns) {
    if (pattern.test(relativePath) || pattern.test(fileName)) {
      return true;
    }
  }

  return false;
}

export function scanProject(dir, level = 0, rootDir = null) {
  if (level > 20) return []; // Avoid infinite loops and very deep trees

  // Set root directory on first call
  if (rootDir === null) {
    rootDir = dir;
    gitignorePatterns = parseGitignore(dir);
  }

  const results = [];
  let files;

  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return results; // Can't read directory
  }

  for (const file of files) {
    const filePath = path.join(dir, file);

    // Check if this file/directory should be ignored
    if (shouldIgnore(filePath, rootDir, gitignorePatterns)) {
      continue;
    }

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const children = scanProject(filePath, level + 1, rootDir);
        // Only include directory if it has children or if it's empty but important
        if (children.length > 0 || isImportantEmptyDirectory(file)) {
          results.push({
            name: file,
            type: 'directory',
            children,
          });
        }
      } else {
        // Only include relevant file types
        if (isRelevantFile(file)) {
          results.push({ name: file, type: 'file' });
        }
      }
    } catch (e) {
      // Ignore files that we can't stat (e.g. broken symlinks)
    }
  }
  return results;
}

/**
 * Check if a file is relevant for project structure analysis
 */
function isRelevantFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName).toLowerCase();

  // Always include certain important files
  const importantFiles = [
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'composer.json',
    'requirements.txt',
    'gemfile',
    'cargo.toml',
    'go.mod',
    'dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'makefile',
    'readme.md',
    'readme.txt',
    'readme',
    'license',
    'license.md',
    'license.txt',
    'contributing.md',
    'changelog.md',
    'changelog.txt',
    '.env.example',
    '.env.sample',
    'tsconfig.json',
    'jsconfig.json',
    'webpack.config.js',
    'vite.config.js',
    'vite.config.ts',
    'next.config.js',
    'nuxt.config.js',
    'nuxt.config.ts',
    'astro.config.js',
    'astro.config.ts',
    'svelte.config.js',
    'tailwind.config.js',
    'tailwind.config.ts',
    'postcss.config.js',
    'babel.config.js',
    '.babelrc',
    '.prettierrc',
    '.eslintrc.js',
    '.eslintrc.json',
    'jest.config.js',
    'vitest.config.js',
    'playwright.config.js',
    'playwright.config.ts'
  ];

  if (importantFiles.includes(baseName)) {
    return true;
  }

  // Include source code files
  const sourceExtensions = [
    '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
    '.py', '.rb', '.php', '.java', '.c', '.cpp', '.cs',
    '.go', '.rs', '.kt', '.swift', '.dart', '.scala',
    '.html', '.htm', '.css', '.scss', '.sass', '.less',
    '.json', '.yaml', '.yml', '.toml', '.xml',
    '.md', '.mdx', '.txt', '.sql', '.graphql',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat'
  ];

  return sourceExtensions.includes(ext);
}

/**
 * Check if an empty directory is important to include
 */
function isImportantEmptyDirectory(dirName) {
  const importantDirs = [
    'src',
    'lib',
    'components',
    'pages',
    'routes',
    'api',
    'public',
    'static',
    'assets',
    'styles',
    'css',
    'scss',
    'tests',
    'test',
    '__tests__',
    'spec',
    'e2e',
    'cypress',
    'playwright',
    'config',
    'configs',
    'utils',
    'helpers',
    'hooks',
    'services',
    'store',
    'stores',
    'middleware',
    'plugins',
    'types',
    'interfaces',
    'models',
    'schemas',
    'db',
    'database',
    'migrations',
    'seeds',
    'docs',
    'documentation'
  ];

  return importantDirs.includes(dirName.toLowerCase());
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
      trimmed.startsWith('Running these') ||
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

export async function generateProjectContext(cwd = process.cwd(), options = {}) {
  try {
    // Don't log here if called from TUI (it will handle the animation)
    if (!options.silent) {
      console.log('Generating project context with Auggie... This may take several minutes.');
    }

    // Try the comprehensive prompt first
    let result = await executeCustomPrompt(initializePrompt, {
      cwd,
      usePrintFormat: true
    });



    // Extract clean markdown from the response
    const cleanMarkdown = result.success ? extractCleanMarkdown(result.stdout) : '';

    // Check if we got meaningful content (not just processing steps)
    const hasUsefulContent = cleanMarkdown &&
      cleanMarkdown.length > 100 &&
      !cleanMarkdown.includes('I\'ll quickly scan') &&
      !cleanMarkdown.includes('Running these') &&
      (cleanMarkdown.includes('# ') || cleanMarkdown.includes('## '));

    // If Auggie failed or didn't provide useful content, use manual fallback
    if (!result.success || !hasUsefulContent) {
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
  let packageJson = null;

  if (fs.existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      context += '## Project Overview\n\n';
      context += `**Name:** ${packageJson.name || 'Unknown'}\n\n`;
      context += `**Version:** ${packageJson.version || 'Unknown'}\n\n`;

      if (packageJson.description) {
        context += `**Description:** ${packageJson.description}\n\n`;
      }

      // Analyze project type and purpose
      const projectAnalysis = analyzeProjectType(packageJson, cwd);
      if (projectAnalysis.type !== 'Unknown') {
        context += `**Project Type:** ${projectAnalysis.type}\n\n`;
        if (projectAnalysis.description) {
          context += `**Technical Purpose:** ${projectAnalysis.description}\n\n`;
        }
      }

      if (projectAnalysis.framework) {
        context += `**Framework/Technology:** ${projectAnalysis.framework}\n\n`;
      }

      // Analyze domain and business purpose
      const domainAnalysis = analyzeProjectDomain(packageJson, cwd);
      if (domainAnalysis.domain) {
        context += `**Domain:** ${domainAnalysis.domain}\n\n`;
      }
      if (domainAnalysis.purpose) {
        context += `**Business Purpose:** ${domainAnalysis.purpose}\n\n`;
      }
      if (domainAnalysis.targetUsers) {
        context += `**Target Users:** ${domainAnalysis.targetUsers}\n\n`;
      }

      // Architecture insights
      const archInsights = analyzeProjectArchitecture(cwd);
      if (archInsights.length > 0) {
        context += '## Project Structure & Architecture\n\n';
        archInsights.forEach(insight => {
          context += `- ${insight}\n`;
        });
        context += '\n';
      }

      // Key features based on dependencies and structure
      const features = detectProjectFeatures(packageJson, cwd);
      if (features.length > 0) {
        context += '## Key Features & Capabilities\n\n';
        features.forEach(feature => {
          context += `- ${feature}\n`;
        });
        context += '\n';
      }

      // Scripts
      if (packageJson.scripts) {
        context += '## Available Scripts\n\n';
        Object.entries(packageJson.scripts).forEach(([name, command]) => {
          context += `- **${name}:** \`${command}\`\n`;
        });
        context += '\n';
      }

      // Dependencies (condensed)
      if (packageJson.dependencies) {
        context += '## Key Dependencies\n\n';
        const deps = Object.keys(packageJson.dependencies);
        const importantDeps = deps.filter(dep => isImportantDependency(dep));

        if (importantDeps.length > 0) {
          importantDeps.slice(0, 8).forEach(dep => {
            context += `- ${dep}\n`;
          });
          if (deps.length > importantDeps.length) {
            const remaining = deps.length - importantDeps.length;
            context += `- ... and ${remaining} more dependencies\n`;
          }
        } else {
          deps.slice(0, 6).forEach(dep => {
            context += `- ${dep}\n`;
          });
          if (deps.length > 6) {
            context += `- ... and ${deps.length - 6} more\n`;
          }
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
  if (packageJson && packageJson.scripts) {
    const startScript = packageJson.scripts.dev ? 'npm run dev' :
                       packageJson.scripts.start ? 'npm start' :
                       'npm run dev';
    context += `3. Run the development server: \`${startScript}\`\n\n`;
  } else {
    context += '3. Run the development server (typically `npm start` or `npm run dev`)\n\n';
  }

  context += '---\n\n';
  context += '*To get a more detailed analysis, ensure Auggie is properly authenticated and try regenerating this context.*\n';

  return context;
}

/**
 * Analyze the project type based on dependencies and structure
 */
function analyzeProjectType(packageJson, cwd) {
  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const scripts = packageJson.scripts || {};

  // Check for specific frameworks/types
  if (deps.react || deps['@types/react']) {
    if (deps.next) return { type: 'React Application', framework: 'Next.js', description: 'Server-side rendered React application with Next.js framework' };
    if (deps['react-native']) return { type: 'Mobile Application', framework: 'React Native', description: 'Cross-platform mobile app built with React Native' };
    if (deps.gatsby) return { type: 'Static Site', framework: 'Gatsby', description: 'Static site generator built with React and Gatsby' };
    return { type: 'Web Application', framework: 'React', description: 'Single-page application built with React' };
  }

  if (deps.vue || deps['@vue/core']) {
    if (deps.nuxt) return { type: 'Web Application', framework: 'Nuxt.js', description: 'Server-side rendered Vue application with Nuxt.js framework' };
    return { type: 'Web Application', framework: 'Vue.js', description: 'Single-page application built with Vue.js' };
  }

  if (deps.svelte || deps['@sveltejs/kit']) {
    if (deps['@sveltejs/kit']) return { type: 'Web Application', framework: 'SvelteKit', description: 'Full-stack web application built with SvelteKit framework' };
    return { type: 'Web Application', framework: 'Svelte', description: 'Single-page application built with Svelte' };
  }

  if (deps['@angular/core']) return { type: 'Web Application', framework: 'Angular', description: 'Single-page application built with Angular framework' };
  if (deps.astro) return { type: 'Static Site', framework: 'Astro', description: 'Static site built with Astro framework' };
  if (deps.express) return { type: 'Backend API', framework: 'Express.js', description: 'RESTful API or web server built with Express.js' };
  if (deps.fastify) return { type: 'Backend API', framework: 'Fastify', description: 'High-performance web server built with Fastify' };
  if (deps.nestjs || deps['@nestjs/core']) return { type: 'Backend API', framework: 'NestJS', description: 'Scalable backend application built with NestJS framework' };

  // Check for Capacitor mobile app
  if (deps['@capacitor/core']) {
    return { type: 'Mobile Application', framework: 'Capacitor', description: 'Cross-platform mobile app using web technologies with Capacitor' };
  }

  // Check for Electron app
  if (deps.electron) return { type: 'Desktop Application', framework: 'Electron', description: 'Cross-platform desktop application built with Electron' };

  // Check for CLI tools
  if (deps.commander || deps.yargs || deps['@oclif/core'] || packageJson.bin) {
    return { type: 'CLI Tool', description: 'Command-line interface application' };
  }

  // Check for libraries/packages
  if (scripts.build && (scripts.prepublishOnly || packageJson.main || packageJson.module)) {
    return { type: 'Library/Package', description: 'Reusable library or npm package' };
  }

  return { type: 'Unknown' };
}

/**
 * Analyze project domain and business purpose
 */
function analyzeProjectDomain(packageJson, cwd) {
  const name = (packageJson.name || '').toLowerCase();
  const description = (packageJson.description || '').toLowerCase();

  // Analyze project name and description for domain indicators
  const domainKeywords = {
    // E-commerce & Shopping
    'ecommerce': { domain: 'E-commerce', purpose: 'Online shopping and retail platform', users: 'Customers and merchants' },
    'shop': { domain: 'E-commerce', purpose: 'Online shopping platform', users: 'Customers and store owners' },
    'cart': { domain: 'E-commerce', purpose: 'Shopping cart and checkout system', users: 'Online shoppers' },
    'store': { domain: 'E-commerce', purpose: 'Digital storefront', users: 'Customers and merchants' },
    'marketplace': { domain: 'E-commerce', purpose: 'Multi-vendor marketplace platform', users: 'Buyers and sellers' },

    // Productivity & Planning
    'agenda': { domain: 'Productivity', purpose: 'Schedule and agenda management application', users: 'Professionals and individuals managing schedules' },
    'calendar': { domain: 'Productivity', purpose: 'Calendar and event management system', users: 'Users managing appointments and events' },
    'todo': { domain: 'Productivity', purpose: 'Task management and todo list application', users: 'Individuals and teams tracking tasks' },
    'task': { domain: 'Productivity', purpose: 'Task tracking and project management', users: 'Teams and project managers' },
    'planner': { domain: 'Productivity', purpose: 'Planning and scheduling application', users: 'People organizing their time and activities' },
    'schedule': { domain: 'Productivity', purpose: 'Scheduling and time management system', users: 'Users managing appointments and time slots' },
    'organizer': { domain: 'Productivity', purpose: 'Personal organization and planning tool', users: 'Individuals organizing their daily activities' },

    // Communication & Social
    'chat': { domain: 'Communication', purpose: 'Real-time messaging and chat application', users: 'People communicating with each other' },
    'message': { domain: 'Communication', purpose: 'Messaging platform', users: 'Users exchanging messages' },
    'social': { domain: 'Social Media', purpose: 'Social networking platform', users: 'Social media users and content creators' },
    'forum': { domain: 'Communication', purpose: 'Discussion forum and community platform', users: 'Community members and moderators' },
    'blog': { domain: 'Content Management', purpose: 'Blogging and content publishing platform', users: 'Writers and readers' },

    // Finance & Business
    'finance': { domain: 'Finance', purpose: 'Financial management and tracking application', users: 'Individuals and businesses managing finances' },
    'budget': { domain: 'Finance', purpose: 'Budget tracking and financial planning tool', users: 'People managing their personal or business finances' },
    'invoice': { domain: 'Finance', purpose: 'Invoice generation and billing system', users: 'Businesses and freelancers' },
    'payment': { domain: 'Finance', purpose: 'Payment processing and transaction system', users: 'Merchants and customers' },
    'accounting': { domain: 'Finance', purpose: 'Accounting and bookkeeping software', users: 'Accountants and business owners' },

    // Education & Learning
    'learn': { domain: 'Education', purpose: 'Learning management and educational platform', users: 'Students and educators' },
    'course': { domain: 'Education', purpose: 'Course management and delivery system', users: 'Students and instructors' },
    'quiz': { domain: 'Education', purpose: 'Quiz and assessment platform', users: 'Students and teachers' },
    'education': { domain: 'Education', purpose: 'Educational platform and learning tools', users: 'Students and educators' },

    // Health & Fitness
    'health': { domain: 'Healthcare', purpose: 'Health tracking and wellness application', users: 'Individuals monitoring their health' },
    'fitness': { domain: 'Health & Fitness', purpose: 'Fitness tracking and workout application', users: 'Fitness enthusiasts and athletes' },
    'workout': { domain: 'Health & Fitness', purpose: 'Workout planning and tracking system', users: 'People following fitness routines' },
    'medical': { domain: 'Healthcare', purpose: 'Medical information and healthcare management', users: 'Patients and healthcare providers' },

    // Media & Entertainment
    'music': { domain: 'Entertainment', purpose: 'Music streaming or management application', users: 'Music listeners and artists' },
    'video': { domain: 'Entertainment', purpose: 'Video streaming or management platform', users: 'Viewers and content creators' },
    'game': { domain: 'Gaming', purpose: 'Gaming platform or game application', users: 'Gamers and players' },
    'photo': { domain: 'Media', purpose: 'Photo sharing and management application', users: 'Photographers and photo enthusiasts' },

    // Real Estate & Location
    'property': { domain: 'Real Estate', purpose: 'Property management and real estate platform', users: 'Property managers and real estate professionals' },
    'map': { domain: 'Navigation', purpose: 'Mapping and location services', users: 'Users needing navigation and location information' },
    'travel': { domain: 'Travel', purpose: 'Travel planning and booking platform', users: 'Travelers and travel agencies' },

    // Food & Restaurant
    'food': { domain: 'Food & Dining', purpose: 'Food ordering or restaurant management system', users: 'Diners and restaurant owners' },
    'restaurant': { domain: 'Food & Dining', purpose: 'Restaurant management or ordering platform', users: 'Restaurant staff and customers' },
    'recipe': { domain: 'Food & Cooking', purpose: 'Recipe sharing and cooking application', users: 'Home cooks and food enthusiasts' },

    // Analytics & Data
    'analytics': { domain: 'Data Analytics', purpose: 'Data analysis and business intelligence platform', users: 'Data analysts and business stakeholders' },
    'dashboard': { domain: 'Data Visualization', purpose: 'Dashboard and data visualization tool', users: 'Users monitoring metrics and KPIs' },
    'report': { domain: 'Business Intelligence', purpose: 'Reporting and business intelligence system', users: 'Managers and decision makers' },

    // CRM & Customer Management
    'crm': { domain: 'Customer Management', purpose: 'Customer relationship management system', users: 'Sales teams and customer service representatives' },
    'customer': { domain: 'Customer Management', purpose: 'Customer management and service platform', users: 'Businesses serving customers' },

    // Inventory & Logistics
    'inventory': { domain: 'Inventory Management', purpose: 'Inventory tracking and warehouse management', users: 'Warehouse staff and inventory managers' },
    'shipping': { domain: 'Logistics', purpose: 'Shipping and logistics management system', users: 'Shipping companies and logistics coordinators' },

    // HR & Employee Management
    'employee': { domain: 'Human Resources', purpose: 'Employee management and HR system', users: 'HR professionals and employees' },
    'payroll': { domain: 'Human Resources', purpose: 'Payroll processing and employee compensation', users: 'HR departments and employees' },

    // Documentation & Knowledge
    'wiki': { domain: 'Knowledge Management', purpose: 'Wiki and knowledge base platform', users: 'Teams sharing and organizing knowledge' },
    'docs': { domain: 'Documentation', purpose: 'Documentation and knowledge management system', users: 'Teams and individuals organizing information' },
    'notes': { domain: 'Productivity', purpose: 'Note-taking and knowledge organization tool', users: 'Individuals and teams taking and organizing notes' }
  };

  // Check project name and description for domain keywords
  let matchedDomain = null;
  const searchText = `${name} ${description}`;

  for (const [keyword, domainInfo] of Object.entries(domainKeywords)) {
    if (searchText.includes(keyword)) {
      matchedDomain = domainInfo;
      break;
    }
  }

  // Try to analyze source files for more context (limited scan)
  if (!matchedDomain) {
    try {
      const srcDir = path.join(cwd, 'src');
      if (fs.existsSync(srcDir)) {
        const sourceFiles = scanSourceFiles(srcDir, ['lib', 'components', 'pages', 'routes']);
        const sourceContent = sourceFiles.join(' ').toLowerCase();

        for (const [keyword, domainInfo] of Object.entries(domainKeywords)) {
          if (sourceContent.includes(keyword)) {
            matchedDomain = domainInfo;
            break;
          }
        }
      }
    } catch (error) {
      // Ignore errors scanning source files
    }
  }

  return matchedDomain || {};
}

/**
 * Scan source files for domain keywords (limited to avoid performance issues)
 */
function scanSourceFiles(dir, maxDirs = [], level = 0) {
  if (level > 2) return []; // Limit recursion depth

  const keywords = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && /\.(js|ts|jsx|tsx|vue|svelte)$/.test(e.name));

    // Scan a few files for keywords
    for (let i = 0; i < Math.min(files.length, 5); i++) {
      try {
        const filePath = path.join(dir, files[i].name);
        const content = fs.readFileSync(filePath, 'utf-8');
        // Extract meaningful words from variables, functions, and comments
        const matches = content.match(/\b[a-zA-Z]{4,}\b/g) || [];
        keywords.push(...matches.slice(0, 50)); // Limit to avoid performance issues
      } catch (error) {
        // Continue to next file
      }
    }

    // Recursively scan important directories
    if (level < 2) {
      const dirs = entries.filter(e => e.isDirectory() &&
        (maxDirs.length === 0 || maxDirs.includes(e.name.toLowerCase())));

      for (const dirEntry of dirs.slice(0, 3)) { // Limit subdirectories
        keywords.push(...scanSourceFiles(path.join(dir, dirEntry.name), [], level + 1));
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return keywords;
}

/**
 * Analyze project architecture based on directory structure
 */
function analyzeProjectArchitecture(cwd) {
  const insights = [];

  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    const files = entries.filter(e => e.isFile()).map(e => e.name);

    // Architecture patterns
    if (dirs.includes('src')) {
      if (fs.existsSync(path.join(cwd, 'src', 'components'))) {
        insights.push('Component-based architecture with dedicated components directory');
      }
      if (fs.existsSync(path.join(cwd, 'src', 'pages')) || fs.existsSync(path.join(cwd, 'src', 'routes'))) {
        insights.push('File-based routing with pages/routes directory structure');
      }
      if (fs.existsSync(path.join(cwd, 'src', 'api'))) {
        insights.push('API routes co-located with frontend code');
      }
      if (fs.existsSync(path.join(cwd, 'src', 'store')) || fs.existsSync(path.join(cwd, 'src', 'stores'))) {
        insights.push('Centralized state management with store pattern');
      }
      insights.push('Source code organized in src/ directory');
    }

    if (dirs.includes('public') || dirs.includes('static')) {
      insights.push('Static assets served from public/static directory');
    }

    if (dirs.includes('tests') || dirs.includes('test') || dirs.includes('__tests__')) {
      insights.push('Dedicated testing directory for test organization');
    }

    if (files.includes('docker-compose.yml') || files.includes('Dockerfile')) {
      insights.push('Containerized application with Docker configuration');
    }

    if (files.includes('vercel.json') || files.includes('netlify.toml')) {
      insights.push('Configured for cloud deployment');
    }

  } catch (error) {
    // Ignore errors reading directory
  }

  return insights;
}

/**
 * Detect project features based on dependencies
 */
function detectProjectFeatures(packageJson, cwd) {
  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const features = [];

  // Authentication
  if (deps['@auth0/nextjs-auth0'] || deps['next-auth'] || deps.passport) {
    features.push('User authentication and authorization');
  }

  // Database
  if (deps.prisma || deps.mongoose || deps.sequelize || deps.typeorm) {
    features.push('Database integration and ORM');
  }

  // Styling
  if (deps.tailwindcss) features.push('Tailwind CSS for styling');
  if (deps['styled-components'] || deps['@emotion/styled']) features.push('CSS-in-JS styling solution');
  if (deps.sass || deps.scss) features.push('Sass/SCSS styling');

  // UI Components
  if (deps['@mui/material'] || deps['@material-ui/core']) features.push('Material-UI component library');
  if (deps['@chakra-ui/react']) features.push('Chakra UI component library');
  if (deps.antd) features.push('Ant Design component library');

  // Testing
  if (deps.jest) features.push('Unit testing with Jest');
  if (deps.cypress) features.push('End-to-end testing with Cypress');
  if (deps.playwright || deps['@playwright/test']) features.push('Browser testing with Playwright');

  // Build tools
  if (deps.vite) features.push('Vite build tooling for fast development');
  if (deps.webpack) features.push('Webpack bundling configuration');

  // Mobile capabilities
  if (deps['@capacitor/camera']) features.push('Camera functionality for mobile');
  if (deps['@capacitor/geolocation']) features.push('Geolocation services');
  if (deps['@capacitor/push-notifications']) features.push('Push notification support');

  // API integration
  if (deps.axios || deps['node-fetch']) features.push('HTTP client for API integration');
  if (deps.graphql || deps['@apollo/client']) features.push('GraphQL API integration');

  return features;
}

/**
 * Check if a dependency is important enough to highlight
 */
function isImportantDependency(dep) {
  const important = [
    'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby',
    'express', 'fastify', 'nestjs', '@nestjs/core', 'astro',
    'typescript', 'tailwindcss', 'prisma', 'mongoose', 'graphql',
    '@capacitor/core', 'electron', 'vite', 'webpack'
  ];
  return important.some(imp => dep.includes(imp));
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
    const structure = scanProject(cwd);
    saveProjectStructure(structure, cwd);
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
