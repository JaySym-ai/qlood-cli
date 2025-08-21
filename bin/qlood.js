#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { createChrome, withPage, listPages, newTab, switchToTab, screenshot } from '../src/chrome.js';
import { clickCmd, typeCmd, gotoCmd, openCmd } from '../src/commands.js';
import { copyText, pasteText } from '../src/clipboard.js';
import { runAgent } from '../src/agent.js';
import { runTui } from '../src/tui.js';
import { loadConfig, setModel, setApiKey, getModel, getApiKey } from '../src/config.js';

dotenv.config();

const program = new Command();

// Load defaults from config if present
const cfgDefaults = loadConfig();

program
  .name('qlood')
  .description('Automate Chrome via CDP with LLM agent (OpenRouter)')
  .version('0.1.0');

program.option('--headless', 'Run headless Chromium', false);
program.option('--debug', 'Run with visible browser and devtools', false);
program.option('--model <id>', 'OpenRouter model id', cfgDefaults.model || process.env.QLOOD_DEFAULT_MODEL || 'moonshotai/kimi-k2');

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
  .action(async (url) => withPage(async (page) => gotoCmd(page, url)));

program
  .command('click')
  .argument('<selector>')
  .description('Click element matching CSS selector')
  .action(async (selector) => withPage(async (page) => clickCmd(page, selector)));

program
  .command('type')
  .argument('<selector>')
  .argument('<text>')
  .description('Type text into element matching selector')
  .action(async (selector, text) => withPage(async (page) => typeCmd(page, selector, text)));

const tabs = program.command('tabs').description('Manage tabs');

tabs.command('new').description('Open new tab').action(async () => newTab());

tabs.command('list').description('List tabs').action(async () => {
  const pages = await listPages();
  pages.forEach((p, i) => console.log(`${i}: ${p.url()}`));
});

tabs.command('switch').argument('<index>').description('Switch to tab by index').action(async (index) => switchToTab(Number(index)));

program
  .command('screenshot')
  .argument('[path]', 'file path', 'screenshot.png')
  .description('Save screenshot')
  .action(async (path) => withPage(async (page) => screenshot(page, path)));

const cb = program.command('clipboard').description('Clipboard utilities');
cb.command('copy').argument('<text>').action(async (text) => copyText(text));
cb.command('paste').action(async () => {
  const text = await pasteText();
  process.stdout.write(text + '\n');
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
  .description('Manage qlood configuration (model, api key)')
  .addCommand(new Command('model')
    .argument('<id>')
    .description('Set default OpenRouter model id')
    .action((id) => { setModel(id); console.log(`Model set to ${id}`); }))
  .addCommand(new Command('key')
    .argument('<apiKey>')
    .description('Set OpenRouter API key (stored in ~/.qlood/config.json)')
    .action((apiKey) => { setApiKey(apiKey); console.log('API key updated'); }));

program
  .command('tui')
  .description('Start interactive TUI')
  .action(async () => {
    await runTui();
  });

if (process.argv.length <= 2) {
  // No args -> launch TUI by default
  await runTui();
} else {
  program.parseAsync();
}

