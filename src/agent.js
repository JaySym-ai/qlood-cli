import { ensurePage, getBrowser, createChrome, screenshot as takeScreenshot } from './chrome.js';
import { gotoCmd, clickCmd, typeCmd } from './commands.js';
import { cliExecutor } from './cli-executor.js';
import { debugLogger } from './debug.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Simple cancellation wiring for the in-flight agent loop/fetch
let currentAbortController = null;
export function cancelAgentRun() {
  try { currentAbortController?.abort?.(); } catch {}
}

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getApiKey, getModel, setApiKey, getMainPrompt, getSystemInstructions, loadConfig, getPromptUseCase } from './config.js';
import { getPrompt as getTemplatePrompt, composeGuidelines } from './prompts/index.js';

import fs from 'node:fs';
import path from 'node:path';

function getQloodDir() {
  const dir = path.join(process.cwd(), '.qlood');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
  return dir;
}
function resolveQloodPath(rel) {
  const base = getQloodDir();
  const p = path.resolve(base, rel || '');
  if (!p.startsWith(base)) throw new Error('Access outside ./.qlood is not allowed');
  return p;
}

// Tool registry with schemas and handlers
const toolRegistry = {
  goto: {
    description: 'Navigate to a URL',
    schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
    handler: async (page, args) => {
      const startTime = new Date();
      debugLogger.logToolExecution('goto', args, startTime);
      try {
        const result = await gotoCmd(page, String(args.url), { silent: true });
        debugLogger.logToolResult('goto', { url: args.url }, startTime);
        return result;
      } catch (error) {
        debugLogger.logToolResult('goto', null, startTime, error);
        throw error;
      }
    },
  },
  click: {
    description: 'Click a CSS selector',
    schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
      additionalProperties: false,
    },
    handler: async (page, args) => {
      const startTime = new Date();
      debugLogger.logToolExecution('click', args, startTime);
      try {
        const result = await clickCmd(page, String(args.selector), { silent: true });
        debugLogger.logToolResult('click', { selector: args.selector }, startTime);
        return result;
      } catch (error) {
        debugLogger.logToolResult('click', null, startTime, error);
        throw error;
      }
    },
  },
  type: {
    description: 'Type text into a CSS selector',
    schema: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
      required: ['selector', 'text'],
      additionalProperties: false,
    },
    handler: async (page, args) => {
      const startTime = new Date();
      debugLogger.logToolExecution('type', args, startTime);
      try {
        const result = await typeCmd(page, String(args.selector), String(args.text), { silent: true });
        debugLogger.logToolResult('type', { selector: args.selector, text: args.text }, startTime);
        return result;
      } catch (error) {
        debugLogger.logToolResult('type', null, startTime, error);
        throw error;
      }
    },
  },
  screenshot: {
    description: 'Save a full-page screenshot to optional path',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
    handler: async (page, args) => {
      const startTime = new Date();
      const path = args?.path || 'screenshot.png';
      debugLogger.logToolExecution('screenshot', { path }, startTime);
      try {
        const result = await takeScreenshot(page, path);
        debugLogger.logToolResult('screenshot', { path }, startTime);
        return result;
      } catch (error) {
        debugLogger.logToolResult('screenshot', null, startTime, error);
        throw error;
      }
    },
  },
  scroll: {
    description: 'Scroll vertically by pixels (positive=down, negative=up)',
    schema: {
      type: 'object',
      properties: { y: { type: 'number' } },
      required: ['y'],
      additionalProperties: false,
    },
    handler: async (page, args) => {
      const startTime = new Date();
      const y = Number(args.y || 0);
      debugLogger.logToolExecution('scroll', { y }, startTime);
      try {
        const result = await page.evaluate((dy) => window.scrollBy(0, dy), y);
        debugLogger.logToolResult('scroll', { y }, startTime);
        return result;
      } catch (error) {
        debugLogger.logToolResult('scroll', null, startTime, error);
        throw error;
      }
    },
  },
  pressEnter: {
    description: 'Press Enter key on the currently focused element',
    schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: async (page) => {
      const startTime = new Date();
      debugLogger.logToolExecution('pressEnter', {}, startTime);
      try {
        const result = await page.keyboard.press('Enter');
        debugLogger.logToolResult('pressEnter', {}, startTime);
        return result;
      } catch (error) {
        debugLogger.logToolResult('pressEnter', null, startTime, error);
        throw error;
      }
    },
  },
  search: {
    description: 'Type search query and submit (combines typing + enter)',
    schema: {
      type: 'object',
      properties: { 
        selector: { type: 'string' }, 
        query: { type: 'string' } 
      },
      required: ['selector', 'query'],
      additionalProperties: false,
    },
    handler: async (page, args) => {
      const startTime = new Date();
      const selector = String(args.selector);
      const text = String(args.query);
      debugLogger.logToolExecution('search', { selector, query: text }, startTime);
      
      try {
        // Prefer a visible element when waiting
        await page.waitForSelector(selector, { timeout: 10000, visible: true });

        // Resolve the primary handle
        let handle = await page.$(selector);
        if (!handle) throw new Error(`Search target not found: ${selector}`);

        // If the match is a container (e.g. form or div), try to find an input-like descendant
        const tagName = await page.evaluate(el => el.tagName, handle);
        let target = handle;
        if (!['INPUT', 'TEXTAREA'].includes(tagName)) {
          const inner = await handle.$('input, textarea, [contenteditable=""], [contenteditable="true"]');
          if (inner) target = inner;
        }

        // Try to focus/click the target. If clicking fails due to overlays, fall back to programmatic focus
        try {
          await target.click({ delay: 10 });
        } catch (clickErr) {
          // Attempt to bring it into view and focus programmatically
          try {
            await page.evaluate(el => { el.scrollIntoView({ block: 'center', inline: 'center' }); }, target);
            await page.evaluate(el => { if (el && typeof el.focus === 'function') el.focus(); }, target);
          } catch (_) {
            throw clickErr;
          }
        }

        // Clear existing value while firing input events
        await page.evaluate(el => {
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (el && el.isContentEditable) {
            el.textContent = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, target);

        // Type into the resolved element handle for robustness
        const typeSupported = await page.evaluate(el => {
          return !!(el instanceof HTMLElement);
        }, target);
        if (typeSupported) {
          await target.type(text);
        } else {
          // Fallback to page-level typing
          await page.type(selector, text);
        }

        // Submit via Enter. If a surrounding form exists, Enter will submit it.
        await page.keyboard.press('Enter');
        
        debugLogger.logToolResult('search', { selector, query: text }, startTime);
      } catch (error) {
        debugLogger.logToolResult('search', null, startTime, error);
        if (error.message.includes('detached')) {
          throw new Error(`Search failed - page detached: ${selector}`);
        }
        throw error;
      }
    },
  },
  done: {
    description: 'Finish when goal achieved',
    schema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: false,
    },
    handler: async (_page, args) => {
      const startTime = new Date();
      debugLogger.logToolExecution('done', args, startTime);
      debugLogger.logToolResult('done', args, startTime);
    },
  },
  cli: {
    description: 'Execute CLI commands on the system',
    schema: {
      type: 'object',
      properties: { 
        command: { type: 'string', description: 'The command to execute' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
        background: { type: 'boolean', description: 'Run in background (default: false)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        cwd: { type: 'string', description: 'Working directory (default: current)' }
      },
      required: ['command'],
      additionalProperties: false,
    },
    handler: async (_page, args) => {
      const startTime = new Date();
      const { command, args: cmdArgs = [], background = false, timeout = 30000, cwd } = args;
      
      debugLogger.logToolExecution('cli', { command, args: cmdArgs, background, timeout, cwd }, startTime);
      
      try {
        const result = await cliExecutor.executeCommand(command, {
          args: cmdArgs,
          background,
          timeout,
          cwd
        });
        
        const toolResult = {
          success: result.success,
          output: result.stdout || result.message || '',
          error: result.stderr || '',
          exitCode: result.exitCode,
          processId: result.processId
        };
        
        debugLogger.logToolResult('cli', toolResult, startTime);
        return toolResult;
      } catch (error) {
        const toolResult = {
          success: false,
          error: error.message,
          exitCode: 1
        };
        debugLogger.logToolResult('cli', null, startTime, error);
        return toolResult;
      }
    },
  },
  cliHelp: {
    description: 'Get help information for CLI commands',
    schema: {
      type: 'object',
      properties: { 
        command: { type: 'string', description: 'The command to get help for' }
      },
      required: ['command'],
      additionalProperties: false,
    },
    handler: async (_page, args) => {
      const startTime = new Date();
      const { command } = args;
      
      debugLogger.logToolExecution('cliHelp', { command }, startTime);
      
      try {
        const result = await cliExecutor.getCommandHelp(command);
        debugLogger.logToolResult('cliHelp', result, startTime);
        return result;
      } catch (error) {
        const errorResult = {
          success: false,
          message: error.message
        };
        debugLogger.logToolResult('cliHelp', null, startTime, error);
        return errorResult;
      }
    },
  },
  cliList: {
    description: 'List running background processes',
    schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: async (_page, _args) => {
      const startTime = new Date();
      debugLogger.logToolExecution('cliList', {}, startTime);
      
      const processes = cliExecutor.listProcesses();
      const result = {
        success: true,
        processes
      };
      
      debugLogger.logToolResult('cliList', result, startTime);
      return result;
    },
  },
  cliKill: {
    description: 'Kill a background process by ID',
    schema: {
      type: 'object',
      properties: { 
        processId: { type: 'number', description: 'Process ID to kill' }
      },
      required: ['processId'],
      additionalProperties: false,
    },
    handler: async (_page, args) => {
      const startTime = new Date();
      const { processId } = args;
      
      debugLogger.logToolExecution('cliKill', { processId }, startTime);
      
      const result = cliExecutor.killProcess(processId);
      debugLogger.logToolResult('cliKill', result, startTime);
      
      return result;
    },
  },

  // Qlood local knowledge base and workflow tools (scoped to ./.qlood)
  qloodList: {
    description: 'List files under ./.qlood (notes, workflows, etc.)',
    schema: {
      type: 'object',
      properties: { },
      required: [],
      additionalProperties: false,
    },
    handler: async () => {
      const dir = getQloodDir();
      const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
      return { files };
    }
  },
  qloodRead: {
    description: 'Read a UTF-8 file from ./.qlood',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (_page, args) => {
      const p = resolveQloodPath(String(args.path));
      if (!fs.existsSync(p)) throw new Error('File not found');
      const content = fs.readFileSync(p, 'utf8');
      return { path: path.relative(getQloodDir(), p), content };
    }
  },
  qloodWrite: {
    description: 'Write a UTF-8 file to ./.qlood (overwrite by default, or append)',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' }
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    handler: async (_page, args) => {
      const p = resolveQloodPath(String(args.path));
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const data = String(args.content);
      if (args.append) fs.appendFileSync(p, data, 'utf8'); else fs.writeFileSync(p, data, 'utf8');
      return { path: path.relative(getQloodDir(), p), bytes: Buffer.byteLength(data, 'utf8'), append: !!args.append };
    }
  },
  qloodDelete: {
    description: 'Delete a file from ./.qlood',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (_page, args) => {
      const p = resolveQloodPath(String(args.path));
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      return { path: path.relative(getQloodDir(), p), deleted: true };
    }
  },
};

function toolsForPrompt() {
  const entries = Object.entries(toolRegistry).map(([name, def]) => ({
    name,
    description: def.description,
    schema: def.schema,
  }));
  return entries;
}

function parseMaybeJson(str) {
  try { return JSON.parse(str); } catch { /* ignore */ }
  // Try fenced code block
  const m = str.match(/```(?:json)?\n([\s\S]*?)```/i);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  return null;
}

function coercePlanShape(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // Our simple shape
  if (typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} };
  // OpenAI-ish { function_call: { name, arguments } }
  if (obj.function_call && typeof obj.function_call.name === 'string') {
    const raw = obj.function_call.arguments;
    let args = raw;
    if (typeof raw === 'string') { try { args = JSON.parse(raw); } catch { args = {}; } }
    return { tool: obj.function_call.name, args: args || {} };
  }
  // Gemini-ish { functionCall: { name, args } }
  if (obj.functionCall && typeof obj.functionCall.name === 'string') {
    return { tool: obj.functionCall.name, args: obj.functionCall.args || {} };
  }
  // Minimal { name, arguments }
  if (obj.name && obj.arguments) {
    const raw = obj.arguments;
    let args = raw;
    if (typeof raw === 'string') { try { args = JSON.parse(raw); } catch { args = {}; } }
    return { tool: obj.name, args: args || {} };
  }
  return null;
}

// Check if a query is conversational and can be answered without tools
function isConversationalQuery(goal) {
  const lowerGoal = goal.toLowerCase().trim();
  
  // Simple identity questions
  if (lowerGoal.match(/^(who are you|what are you|what is this|hello|hi|help)(\?)?$/)) {
    return true;
  }
  
  // Questions about capabilities without asking to do something
  if (lowerGoal.match(/^(what can you do|what do you do|how do you work)(\?)?$/)) {
    return true;
  }
  
  // Basic greetings without requests
  if (lowerGoal.match(/^(good morning|good afternoon|good evening|hey there)(\?)?$/)) {
    return true;
  }
  
  return false;
}

// Handle conversational queries without tools
function handleConversationalQuery(goal, onLog) {
  const lowerGoal = goal.toLowerCase().trim();
  
  let response = '';
  
  if (lowerGoal.match(/^(who are you|what are you)(\?)?$/)) {
    response = 'I am Qlood, an AI assistant that can help you automate web browsers and execute CLI commands to accomplish your goals.';
  } else if (lowerGoal.match(/^(what can you do|what do you do)(\?)?$/)) {
    response = 'I can help you automate web browsing tasks (clicking, typing, navigating), execute CLI commands, and manage files in your .qlood directory for notes and workflows.';
  } else if (lowerGoal.match(/^(hello|hi|hey there|good morning|good afternoon|good evening)(\?)?$/)) {
    response = 'Hello! I\'m ready to help you with web automation or CLI tasks. What would you like me to do?';
  } else if (lowerGoal.match(/^(help|what is this)(\?)?$/)) {
    response = 'I\'m Qlood, an AI that automates web browsers and runs CLI commands. You can ask me to navigate websites, fill forms, click buttons, execute terminal commands, or manage local files. Just tell me what you want to accomplish!';
  } else if (lowerGoal.match(/^how do you work(\?)?$/)) {
    response = 'I work by understanding your goals and using tools to accomplish them - I can control web browsers, execute CLI commands, take screenshots, and manage files. Just describe what you want to do and I\'ll break it down into steps.';
  }
  
  if (onLog) {
    onLog(response);
  } else {
    console.log(response);
  }
}

export async function runAgent(goal, { headless = false, debug = false, promptForApiKey = true, onLog } = {}) {
  // Check if this is a conversational query that doesn't need tools
  if (isConversationalQuery(goal)) {
    handleConversationalQuery(goal, onLog);
    return;
  }

  // Sanitize the goal to prevent Unicode issues
  const sanitizedGoal = goal
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '?')
    .replace(/[^\x00-\xFF]/g, '?')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const actionHistory = [];
  let apiKey = getApiKey();
  if (!apiKey) {
    if (promptForApiKey) {
      const rl = readline.createInterface({ input, output });
      const entered = await rl.question('Enter your OpenRouter API key: ');
      rl.close();
      if (!entered) {
        throw new Error('OpenRouter API key missing');
      }
      setApiKey(entered.trim());
      apiKey = entered.trim();
    } else {
      throw new Error('OpenRouter API key missing');
    }
  }
  const effectiveModel = getModel();

  const tools = toolsForPrompt();

  let page = null;

  // Helper to add small human-like delays
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Simple loop: ask model what to do next; execute; feed back page title and URL
  for (let step = 0; step < 10; step++) {
    let context = 'No page open yet';
    if (page) {
      try {
        const title = await page.title();
        const url = page.url();
        context = `Current page: ${title}\nURL: ${url}`;
        debugLogger.logPageState(page);
      } catch (error) {
        if (error.message.includes('detached')) {
          context = 'Page detached - will reconnect on next action';
          page = null; // Force reconnection
        } else {
          context = 'Page error - will reconnect';
          page = null;
        }
        debugLogger.logError('Page context check', error);
      }
    }
    
    const historyText = actionHistory.length > 0 
      ? `\nRecent actions:\n${actionHistory.slice(-3).map((h, i) => `${actionHistory.length - 3 + i + 1}. ${h}`).join('\n')}`
      : '';
    
    const cfg = loadConfig();
    const useCase = getPromptUseCase();
    const basePrompt = (cfg.mainPrompt || '').trim() || getTemplatePrompt(useCase);
    const guidelines = composeGuidelines();
    const systemInstructions = getSystemInstructions();
    const additionalInstructions = systemInstructions ? `\n\nAdditional Instructions:\n${systemInstructions}` : '';
    
    const prompt = `${guidelines}

Goal: ${sanitizedGoal}

Tools (name, description, JSON schema parameters):
${JSON.stringify(tools, null, 2)}

State:
${context}${historyText}
${additionalInstructions}`;

    // Sanitize the prompt to prevent Unicode issues
    const sanitizedPrompt = prompt
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '?')
      .replace(/[^\x00-\xFF]/g, '?')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const body = {
      model: effectiveModel,
      messages: [
        { role: 'system', content: 'You are an AI assistant capable of web automation and CLI execution. Only output tool calls as JSON.' },
        { role: 'user', content: sanitizedPrompt }
      ]
    };

    debugLogger.logAgentRequest(sanitizedGoal, effectiveModel, sanitizedPrompt, tools);

    const bodyString = JSON.stringify(body);
    if (debug && onLog) {
      onLog(`Request body length: ${bodyString.length}`);
      // Check for problematic characters
      for (let i = 0; i < bodyString.length; i++) {
        const code = bodyString.charCodeAt(i);
        if (code === 65533 || code > 255) {
          onLog(`Found problematic char at index ${i}: code ${code}`);
          break;
        }
      }
    }

    // Only remove problematic Unicode replacement characters from API key
    const sanitizedApiKey = apiKey.replace(/[\uFFFD]/g, '');

    // Support cancellation
    const controller = new AbortController();
    currentAbortController = controller;
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${sanitizedApiKey}`,
        'HTTP-Referer': 'https://github.com/qloodhq/qlood-cli',
        'X-Title': 'qlood-cli'
      },
      body: bodyString,
      signal: controller.signal,
    });
    currentAbortController = null;

    if (!resp.ok) {
      const error = new Error(`OpenRouter error: ${resp.status}`);
      debugLogger.logError('OpenRouter API', error);
      throw error;
    }
    
    const data = await resp.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const content = rawContent
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/[^\x00-\xFF]/g, '?');
    
    if (debug && onLog) {
      onLog(`Raw response length: ${rawContent.length}, filtered length: ${content.length}`);
    }

    let plan = parseMaybeJson(content);
    
    debugLogger.logAgentResponse(content, plan);
    
    if (!plan) { 
      const msg = 'Model did not return JSON; stopping.';
      debugLogger.logError('Agent parsing', new Error(msg));
      if (onLog) onLog(msg); else console.log(msg); 
      break; 
    }
    
    const coerced = coercePlanShape(plan);
    if (!coerced) { 
      const msg = 'Could not interpret tool call; stopping.';
      debugLogger.logError('Agent parsing', new Error(msg));
      if (onLog) onLog(msg); else console.log(msg); 
      break; 
    }
    
    const { tool, args } = coerced;
  async function ensureAgentPage() {
    try { await getBrowser(); } catch { await createChrome({ headless, debug }); }
    
    // Always refresh the page reference to handle detached frames
    page = await ensurePage();
    
    // Verify page is accessible
    try {
      await page.evaluate(() => document.readyState);
    } catch (error) {
      if (debug && onLog) onLog('Page became detached, getting fresh page...');
      page = await ensurePage();
    }
  }
  if (onLog) onLog(`Tool: ${tool} ${args ? JSON.stringify(args) : ''}`);
  if (tool === 'done') { 
    if (onLog) onLog(`Done: ${args?.result ?? ''}`); 
    else console.log('Done:', args?.result ?? ''); 
    break; 
  }
  const entry = toolRegistry[tool];
  if (!entry) { 
    if (onLog) onLog(`Unknown tool '${tool}', stopping.`); 
    else console.log(`Unknown tool '${tool}', stopping.`); 
    break; 
  }
  await ensureAgentPage();
  // Small randomized delay before actions to avoid bursty behavior
  await sleep(300 + Math.floor(Math.random() * 500));
  await entry.handler(page, args || {});
  
  // Record the action in history
  const actionDesc = tool === 'goto' ? `navigated to ${args?.url}` :
                     tool === 'click' ? `clicked ${args?.selector}` :
                     tool === 'type' ? `typed "${args?.text}" into ${args?.selector}` :
                     tool === 'scroll' ? `scrolled ${args?.y} pixels` :
                     tool === 'screenshot' ? `took screenshot` :
                     tool === 'pressEnter' ? `pressed Enter key` :
                     tool === 'search' ? `searched for "${args?.query}" in ${args?.selector}` :
                     tool === 'cli' ? `executed CLI: ${args?.command} ${args?.args?.join(' ') || ''}` :
                     tool === 'cliHelp' ? `got help for CLI: ${args?.command}` :
                     tool === 'cliList' ? `listed background processes` :
                     tool === 'cliKill' ? `killed process ${args?.processId}` :
                     `performed ${tool}`;
  actionHistory.push(actionDesc);
  }
}
