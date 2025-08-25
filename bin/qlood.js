#!/usr/bin/env node
import { exec, spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const currentVersion = packageJson.version;

// Lightweight update notice (no auto-install by default). Disable via QLOOD_NO_UPDATE=1
if (process.env.QLOOD_NO_UPDATE !== '1') {
  exec('npm view qlood-cli version', (err, stdout) => {
    if (err) return;
    const latestVersion = stdout.trim();
    if (latestVersion && currentVersion !== latestVersion) {
      console.log(`\nNew version available: ${latestVersion}. You are using ${currentVersion}.`);
      console.log('To update:');
      console.log('  - Local project:  npm i qlood-cli');
      console.log('  - Global install: npm i -g qlood-cli');
      // If explicit opt-in is set, perform background install
      if (process.env.QLOOD_AUTOUPDATE === '1') {
        console.log('Auto-updating in the background (QLOOD_AUTOUPDATE=1)...');
        try {
          const updater = spawn('npm', ['i', 'qlood-cli'], { detached: true, stdio: 'ignore', shell: true });
          updater.unref();
        } catch {}
      }
    }
  });
}

import { Command } from 'commander';
import dotenv from 'dotenv';
import { createChrome, withPage, screenshot, cancelCurrentAction } from '../src/chrome.js';
import { clickCmd, typeCmd, gotoCmd, openCmd } from '../src/commands.js';
import { runAgent } from '../src/agent.js';
import { runTui } from '../src/tui.js';
import { loadConfig, setApiKey, setMainPrompt, setSystemInstructions } from '../src/config.js';
import { runProjectTest } from '../src/test.js';
import { debugLogger } from '../src/debug.js';
import { ensureAuggieUpToDate } from '../src/auggie-integration.js';
import { generateProjectContext, getProjectDir } from '../src/project.js';
import fs from 'fs/promises';


dotenv.config();

const program = new Command();

// SIGINT handling: first Ctrl+C cancels current action (closes browser),
// second within 1.5s exits the process.
let lastSigint = 0;
process.on('SIGINT', async () => {
  const now = Date.now();
  if (now - lastSigint < 1500) {
    console.log('Exiting.');
    process.exit(130);
  }
  lastSigint = now;
  console.log('Cancel requested. Press Ctrl+C again to exit.');
  try {
    await cancelCurrentAction();
    console.log('Current action cancelled.');
  } catch {}
});

// Load defaults from config if present
const cfgDefaults = loadConfig();

program
  .name('qlood')
  .description('AI-powered testing CLI for your web app. Initializes ./.qlood and drives Chromium to find bugs.')
  .version(currentVersion);

program.option('--headless', 'Run headless Chromium', false);
program.option('--debug', 'Run with visible browser and devtools', false);


program
  .command('open')
  .argument('<url>')
  .description('Open a new Chromium window and navigate to URL')
  .action(async (url, _opts, cmd) => {
    const opts = program.opts();
    await openCmd(url, opts);
  });

program
  .command('goto')
  .argument('<url>')
  .description('Navigate current tab to URL')
  .action(async (url) => {
    const opts = program.opts();
    await createChrome({ headless: !!opts.headless, debug: !!opts.debug });
    await withPage(async (page) => gotoCmd(page, url));
  });

program
  .command('click')
  .argument('<selector>')
  .description('Click element matching CSS selector')
  .action(async (selector) => {
    const opts = program.opts();
    await createChrome({ headless: !!opts.headless, debug: !!opts.debug });
    await withPage(async (page) => clickCmd(page, selector));
  });

program
  .command('type')
  .argument('<selector>')
  .argument('<text>')
  .description('Type text into element matching selector')
  .action(async (selector, text) => {
    const opts = program.opts();
    await createChrome({ headless: !!opts.headless, debug: !!opts.debug });
    await withPage(async (page) => typeCmd(page, selector, text));
  });

program
  .command('screenshot')
  .argument('[path]', 'file path', 'screenshot.png')
  .description('Save screenshot')
  .action(async (path) => {
    const opts = program.opts();
    await createChrome({ headless: !!opts.headless, debug: !!opts.debug });
    await withPage(async (page) => screenshot(page, path));
  });

program
  .command('agent')
  .argument('<goal>')
  .description('Run an LLM-driven loop to achieve a goal (experimental)')
  .action(async (goal) => {
    const opts = program.opts();
    await runAgent(goal, opts);
  });

// Config commands
program
  .command('config')
  .description('Manage qlood configuration (model, api key, prompt)')
  
  .addCommand(new Command('key')
    .argument('<apiKey>')
    .description('Set OpenRouter API key (stored in ~/.qlood/config.json)')
    .action((apiKey) => { setApiKey(apiKey); console.log('API key updated'); }))
  .addCommand(new Command('prompt')
    .argument('<prompt>')
    .description('Set main system prompt for AI agent')
    .action((prompt) => { setMainPrompt(prompt); console.log('Main prompt updated'); }))
  .addCommand(new Command('instructions')
    .argument('<instructions>')
    .description('Set additional system instructions for AI agent')
    .action((instructions) => { setSystemInstructions(instructions); console.log('System instructions updated'); }))
  .addCommand(new Command('debug')
    .description('Enable debug mode for detailed logging')
    .action(() => { 
      debugLogger.enable(process.cwd());
      console.log('Debug mode enabled. Logs will be saved to ./.qlood/debug/');
      console.log(`Debug file: ${debugLogger.getDebugFile()}`);
    }));

program
  .command('tui')
  .description('Start interactive TUI')
  .action(async () => {
    await runTui();
  });

// Project commands
program
  .command('test')
  .argument('<scenario...>')
  .description('Run an AI-driven test scenario against your local app')
  .action(async (scenarioParts) => {
    const opts = program.opts();
    const scenario = Array.isArray(scenarioParts) ? scenarioParts.join(' ') : String(scenarioParts);
    await runProjectTest(scenario, { headless: !!opts.headless, debug: !!opts.debug });
  });

program
  .command('init-context')
  .description('Generate or regenerate the project context file at ./.qlood/notes/context.md')
  .action(async () => {
    console.log('Initializing project context...');
    try {
      // Don't pass silent option here - we want console output for CLI command
      const success = await generateProjectContext(process.cwd());
      if (success) {
        console.log('✓ Project context generated successfully');
        process.exit(0);
      } else {
        console.error('✗ Failed to generate project context');
        process.exit(1);
      }
    } catch (error) {
      console.error(`✗ Error generating project context: ${error.message}`);
      process.exit(1);
    }
  });

// Clean command to remove .qlood directory
program
  .command('clean')
  .description('Remove the ./.qlood directory to force reinitialization')
  .action(async () => {
    const cwd = process.cwd();
    const qloodDir = getProjectDir(cwd);

    // Check if .qlood directory exists using fs/promises
    try {
      await fs.access(qloodDir);
    } catch {
      console.log('No .qlood directory found in the current project.');
      return;
    }

    console.log(`Removing ${qloodDir}...`);

    try {
      // Use fs.rm with recursive option for directory removal
      await fs.rm(qloodDir, { recursive: true, force: true });
      console.log('✓ Successfully removed .qlood directory');
      console.log('The project will be reinitialized on the next run.');
    } catch (error) {
      console.error(`✗ Error removing .qlood directory: ${error.message}`);
      console.error('You may need to remove it manually.');
      process.exit(1);
    }
  });

// Auggie integration commands
program
  .command('auggie-check')
  .description('Ensure Auggie is up-to-date and display the result')
  .action(async () => {
    console.log('Checking Auggie CLI status...');
    try {
      const result = await ensureAuggieUpToDate();
      if (result.success) {
        console.log(`✓ ${result.message}`);
        if (result.version) {
          console.log(`  Version: ${result.version}`);
        }
        process.exit(0);
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`✗ Error checking Auggie: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('auggie-context')
  .description('Show project info from ./.qlood/notes/context.md (use --update to regenerate)')
  .option('-u, --update', 'Regenerate context with Auggie before showing', false)
  .action(async (cmdOpts) => {
    const cwd = process.cwd();
    const qloodContextPath = path.join(getProjectDir(cwd), 'notes', 'context.md');
    const rootContextPath = path.join(cwd, 'context.md');

    try {
      // If not updating and context file exists, read and print it
      if (!cmdOpts.update) {
        try {
          // Prefer ./.qlood/notes/context.md, else fall back to ./context.md
          let contextPathToRead = qloodContextPath;
          try { await fs.access(qloodContextPath); }
          catch {
            await fs.access(rootContextPath);
            contextPathToRead = rootContextPath;
          }
          const content = await fs.readFile(contextPathToRead, 'utf-8');
          const stat = await fs.stat(contextPathToRead);
          const rel = path.relative(cwd, contextPathToRead);
          console.log(`\n--- Project Context (${rel}) ---`);
          console.log(`Last updated: ${new Date(stat.mtime).toISOString()}\n`);
          console.log(content);
          process.exit(0);
          return;
        } catch {}
      }

      // Otherwise, (re)generate using Auggie and then print
      console.log(cmdOpts.update ? 'Updating project context with Auggie...' : 'Generating project context with Auggie...');
      const ok = await generateProjectContext(cwd, { silent: true });
      if (!ok) {
        console.error('✗ Failed to generate project context with Auggie');
        process.exit(1);
      }

      // Read the freshly generated file
      const content = await fs.readFile(qloodContextPath, 'utf-8');
      const stat = await fs.stat(qloodContextPath);
      const rel = path.relative(cwd, qloodContextPath);
      console.log(`\n--- Project Context (${rel}) ---`);
      console.log(`Last updated: ${new Date(stat.mtime).toISOString()}\n`);
      console.log(content);
      process.exit(0);
    } catch (error) {
      console.error(`✗ Error getting project context: ${error.message}`);
      process.exit(1);
    }
  });

if (process.argv.length <= 2) {
  // No args -> launch TUI by default
  await runTui();
} else {
  program.parseAsync();
}
