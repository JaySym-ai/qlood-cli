#!/usr/bin/env node

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const currentVersion = packageJson.version;


import { Command } from 'commander';
import dotenv from 'dotenv';
import { runTui } from '../src/tui.js';
import { setMainPrompt, setSystemInstructions } from '../src/config.js';
import { debugLogger } from '../src/debug.js';
import { ensureAuggieUpToDate, executeRawCommand } from '../src/auggie-integration.js';
import { getProjectDir, ensureProjectInit } from '../src/project.js';
import fs from 'fs/promises';
import { registerReviewCommand } from '../src/commands/review.js';

import { startCliSpinner } from '../src/cli/spinner.js';
import { checkAndAutoUpdate as checkAndAutoUpdateUtil } from '../src/cli/update.js';


dotenv.config();


const program = new Command();

// Ensure Auggie is installed and up to date at startup
try {
  console.log('Checking Auggie CLI status...');
  const result = await ensureAuggieUpToDate();
  if (result.success) {
    console.log(`✓ Auggie ready${result.version ? ` (v${result.version})` : ''}`);
  } else {
    console.warn(`⚠️  Auggie check failed: ${result.message}`);
  }
} catch (e) {
  console.warn(`⚠️  Auggie check error: ${e?.message || e}`);
}

// Do not set a global SIGINT handler here to allow
// context-specific handling (e.g., TUI double-press behavior).

// Load defaults from config if present



await checkAndAutoUpdateUtil(currentVersion);


program
  .name('qlood')
  .description('AI-powered testing CLI for your web app. Initializes ./.qlood and drives Chromium to find bugs.')
  .version(currentVersion);

// No local Playwright controls; all browser work is delegated to Auggie (MCP)

program
  .command('agent')
  .argument('<goal...>')
  .description('Run Auggie to achieve a goal using MCP Playwright (headless)')
  .action(async (goalParts) => {
    const goal = Array.isArray(goalParts) ? goalParts.join(' ') : String(goalParts);
    // Ensure project is initialized and MCP config exists
    await ensureProjectInit();
    // Delegate to Auggie CLI with required flags (--mcp-config, --print)
    const result = await executeRawCommand(['--mcp-config', '.qlood/mcp-config.json', '--print', goal], { cwd: process.cwd() });
    if (!result.success) {
      console.error('Auggie error:', result.stderr || 'Unknown error');
      process.exit(1);
    } else {
      console.log(result.stdout);
      // Exit cleanly after agent run completes so we don't fall back to TUI
      process.exit(0);
    }
  });

// Config commands (no API key management; Auggie handles auth)
program
  .command('config')
  .description('Manage qlood configuration (prompts)')
  .addCommand(new Command('prompt')
    .argument('<prompt>')
    .description('Set main system prompt for AI features')
    .action((prompt) => { setMainPrompt(prompt); console.log('Main prompt updated'); }))
  .addCommand(new Command('instructions')
    .argument('<instructions>')
    .description('Set additional system instructions for AI features')
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

// Register externalized commands
registerReviewCommand(program, { startCliSpinner });
registerCleanCommand(program);

// Project commands
// Removed legacy local test runner; use `qlood agent` or review workflows instead.



// Delete command to remove .qlood directory
async function deleteQloodDir() {
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
}

program
  .command('delete')
  .description('Delete the ./.qlood directory to force reinitialization')
  .action(async () => {
    await deleteQloodDir();
  });




// review command is now registered from src/commands/review.js


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



if (process.argv.length <= 2) {
  // No args -> launch TUI by default
  await runTui();
} else {
  program.parseAsync();
}
