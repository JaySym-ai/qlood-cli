#!/usr/bin/env node
import { exec, spawn } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const currentVersion = packageJson.version;

exec('npm view qlood-cli version', (err, stdout) => {
  if (err) return;
  const latestVersion = stdout.trim();
  if (currentVersion !== latestVersion) {
    console.log(`
New version available: ${latestVersion}. You are using ${currentVersion}.`);
    console.log('Auto-updating in the background...');
    const updater = spawn('npm', ['i', 'qlood-cli'], {
      detached: true,
      stdio: 'ignore'
    });
    updater.unref();
  }
});

import { Command } from 'commander';
import dotenv from 'dotenv';
import { createChrome, withPage, screenshot, cancelCurrentAction } from '../src/chrome.js';
import { clickCmd, typeCmd, gotoCmd, openCmd } from '../src/commands.js';
import { runAgent } from '../src/agent.js';
import { runTui } from '../src/tui.js';
import { loadConfig, setApiKey, setMainPrompt, setSystemInstructions } from '../src/config.js';
import { runProjectTest } from '../src/test.js';
import { debugLogger } from '../src/debug.js';


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
  .version('0.1.0');

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

if (process.argv.length <= 2) {
  // No args -> launch TUI by default
  await runTui();
} else {
  program.parseAsync();
}
