import { ensurePage, getBrowser, createChrome, screenshot as takeScreenshot } from './chrome.js';
import { gotoCmd, clickCmd, typeCmd } from './commands.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getApiKey, getModel, setApiKey } from './config.js';

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
    handler: async (page, args) => gotoCmd(page, String(args.url), { silent: true }),
  },
  click: {
    description: 'Click a CSS selector',
    schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
      additionalProperties: false,
    },
    handler: async (page, args) => clickCmd(page, String(args.selector), { silent: true }),
  },
  type: {
    description: 'Type text into a CSS selector',
    schema: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
      required: ['selector', 'text'],
      additionalProperties: false,
    },
    handler: async (page, args) => typeCmd(page, String(args.selector), String(args.text), { silent: true }),
  },
  screenshot: {
    description: 'Save a full-page screenshot to optional path',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
    handler: async (page, args) => takeScreenshot(page, args?.path || 'screenshot.png'),
  },
  scroll: {
    description: 'Scroll vertically by pixels (positive=down, negative=up)',
    schema: {
      type: 'object',
      properties: { y: { type: 'number' } },
      required: ['y'],
      additionalProperties: false,
    },
    handler: async (page, args) => page.evaluate((dy) => window.scrollBy(0, dy), Number(args.y || 0)),
  },
  pressEnter: {
    description: 'Press Enter key on the currently focused element',
    schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    handler: async (page) => page.keyboard.press('Enter'),
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
      try {
        await page.waitForSelector(args.selector, { timeout: 10000 });
        await page.click(args.selector); // Focus the input
        await page.evaluate((sel) => {
          const input = document.querySelector(sel);
          if (input) input.value = '';
        }, args.selector); // Clear the input
        await page.type(args.selector, args.query);
        await page.keyboard.press('Enter');
      } catch (error) {
        if (error.message.includes('detached')) {
          throw new Error(`Search failed - page detached: ${args.selector}`);
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
    handler: async (_page, _args) => {},
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

export async function runAgent(goal, { model, headless = false, debug = false, promptForApiKey = true, onLog } = {}) {
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
  const effectiveModel = model || getModel();

  const tools = toolsForPrompt();

  let page = null;

  // Simple loop: ask model what to do next; execute; feed back page title and URL
  for (let step = 0; step < 10; step++) {
    let context = 'No page open yet';
    if (page) {
      try {
        const title = await page.title();
        const url = page.url();
        context = `Current page: ${title}\nURL: ${url}`;
      } catch (error) {
        if (error.message.includes('detached')) {
          context = 'Page detached - will reconnect on next action';
          page = null; // Force reconnection
        } else {
          context = 'Page error - will reconnect';
          page = null;
        }
      }
    }
    
    const historyText = actionHistory.length > 0 
      ? `\nRecent actions:\n${actionHistory.slice(-3).map((h, i) => `${actionHistory.length - 3 + i + 1}. ${h}`).join('\n')}`
      : '';
    
    const prompt = `Goal: ${sanitizedGoal}\nYou have tools (name, description, JSON schema parameters):\n${JSON.stringify(tools, null, 2)}\nState:\n${context}${historyText}\n\nIMPORTANT: 
- Don't repeat the same action
- For searches, use the 'search' tool instead of separate type+click
- If you just typed text, try pressEnter() or click a submit button
- If the goal seems achieved, use the 'done' tool
- Be efficient - combine actions when possible

Respond ONLY with a single JSON object representing a tool call. Accepted shapes:\n- {"tool": "name", "args": { ... }}\n- {"function_call": {"name": "name", "arguments": "{...json...}"}}\n- {"functionCall": {"name": "name", "args": { ... }}}`;

    // Sanitize the prompt to prevent Unicode issues
    const sanitizedPrompt = prompt
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '?')
      .replace(/[^\x00-\xFF]/g, '?')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const body = {
      model: effectiveModel,
      messages: [
        { role: 'system', content: 'You are a web automation planner. Only output tool calls as JSON.' },
        { role: 'user', content: sanitizedPrompt }
      ]
    };

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

    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${sanitizedApiKey}`,
        'HTTP-Referer': 'https://github.com/owner/repo',
        'X-Title': 'qlood-cli agent'
      },
      body: bodyString
    });

    if (!resp.ok) throw new Error(`OpenRouter error: ${resp.status}`);
    const data = await resp.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const content = rawContent
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/[^\x00-\xFF]/g, '?');
    
    if (debug && onLog) {
      onLog(`Raw response length: ${rawContent.length}, filtered length: ${content.length}`);
    }

    let plan = parseMaybeJson(content);
    if (!plan) { if (onLog) onLog('Model did not return JSON; stopping.'); else console.log('Model did not return JSON; stopping.'); break; }
    const coerced = coercePlanShape(plan);
    if (!coerced) { if (onLog) onLog('Could not interpret tool call; stopping.'); else console.log('Could not interpret tool call; stopping.'); break; }
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
  await entry.handler(page, args || {});
  
  // Record the action in history
  const actionDesc = tool === 'goto' ? `navigated to ${args?.url}` :
                     tool === 'click' ? `clicked ${args?.selector}` :
                     tool === 'type' ? `typed "${args?.text}" into ${args?.selector}` :
                     tool === 'scroll' ? `scrolled ${args?.y} pixels` :
                     tool === 'screenshot' ? `took screenshot` :
                     tool === 'pressEnter' ? `pressed Enter key` :
                     tool === 'search' ? `searched for "${args?.query}" in ${args?.selector}` :
                     `performed ${tool}`;
  actionHistory.push(actionDesc);
  }
}
