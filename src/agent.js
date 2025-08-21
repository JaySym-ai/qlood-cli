import { ensurePage, getBrowser, createChrome, screenshot as takeScreenshot } from './chrome.js';
import { gotoCmd, clickCmd, typeCmd } from './commands.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getApiKey, getModel, setApiKey } from './config.js';

export async function runAgent(goal, { model, headless = false, debug = false, promptForApiKey = true, onLog } = {}) {
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

  // Minimal tool schema the agent can call
  const tools = [
    { name: 'goto', description: 'Navigate to a URL', params: ['url'] },
    { name: 'click', description: 'Click a CSS selector', params: ['selector'] },
    { name: 'type', description: 'Type text into a CSS selector', params: ['selector', 'text'] },
    { name: 'screenshot', description: 'Save a full-page screenshot to path', params: ['path?'] },
    { name: 'scroll', description: 'Scroll vertically by pixels (positive=down)', params: ['y'] },
    { name: 'done', description: 'Finish when goal achieved', params: ['result'] }
  ];

  let page = null;

  // Simple loop: ask model what to do next; execute; feed back page title and URL
  for (let step = 0; step < 10; step++) {
    const context = page
      ? `Current page: ${await page.title()}\nURL: ${page.url()}`
      : 'No page open yet';
    const prompt = `Goal: ${goal}\nYou have tools: ${JSON.stringify(tools)}\nState:\n${context}\nRespond with a JSON object: {tool: string, args: object}.`;

    const body = {
      model: effectiveModel,
      messages: [
        { role: 'system', content: 'You are a web automation planner. Only output tool calls as JSON.' },
        { role: 'user', content: prompt }
      ]
    };

    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/owner/repo',
        'X-Title': 'qlood-cli agent'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) throw new Error(`OpenRouter error: ${resp.status}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';

  let plan;
  try { plan = JSON.parse(content); } catch {
    console.log('Model did not return JSON; stopping.');
    break;
  }

  const { tool, args } = plan || {};
  async function ensureAgentPage() {
    try { await getBrowser(); } catch { await createChrome({ headless, debug }); }
    if (!page) page = await ensurePage();
  }
  if (onLog) onLog(`Tool: ${tool} ${args ? JSON.stringify(args) : ''}`);
  if (tool === 'goto') { await ensureAgentPage(); await gotoCmd(page, args.url, { silent: true }); }
  else if (tool === 'click') { await ensureAgentPage(); await clickCmd(page, args.selector, { silent: true }); }
  else if (tool === 'type') { await ensureAgentPage(); await typeCmd(page, args.selector, args.text, { silent: true }); }
  else if (tool === 'screenshot') { await ensureAgentPage(); const p = args.path || 'screenshot.png'; await takeScreenshot(page, p); if (onLog) onLog(`Saved screenshot: ${p}`); }
  else if (tool === 'scroll') { await ensureAgentPage(); const y = Number(args.y || 0); await page.evaluate((dy) => window.scrollBy(0, dy), y); }
  else if (tool === 'done') { if (onLog) onLog(`Done: ${args.result}`); else console.log('Done:', args.result); break; }
  else { if (onLog) onLog('Unknown tool, stopping.'); else console.log('Unknown tool, stopping.'); break; }
  }
}
