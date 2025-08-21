import { ensurePage } from './chrome.js';
import { gotoCmd, clickCmd, typeCmd } from './commands.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getApiKey, getModel, setApiKey } from './config.js';

export async function runAgent(goal, { model } = {}) {
  let apiKey = getApiKey();
  if (!apiKey) {
    const rl = readline.createInterface({ input, output });
    const entered = await rl.question('Enter your OpenRouter API key: ');
    rl.close();
    if (!entered) {
      console.error('An API key is required. Aborting.');
      process.exit(1);
    }
    setApiKey(entered.trim());
    apiKey = entered.trim();
  }
  const effectiveModel = model || getModel();

  // Minimal tool schema the agent can call
  const tools = [
    { name: 'goto', description: 'Navigate to a URL', params: ['url'] },
    { name: 'click', description: 'Click a CSS selector', params: ['selector'] },
    { name: 'type', description: 'Type into selector', params: ['selector', 'text'] },
    { name: 'done', description: 'Finish when goal achieved', params: ['result'] }
  ];

  const page = await ensurePage();

  // Simple loop: ask model what to do next; execute; feed back page title and URL
  for (let step = 0; step < 10; step++) {
    const context = `Current page: ${await page.title()}\nURL: ${page.url()}`;
    const prompt = `Goal: ${goal}\nYou have tools: ${JSON.stringify(tools)}\nState:\n${context}\nRespond with a JSON object: {tool: string, args: object}.`;

    const body = {
      model,
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
    if (tool === 'goto') await gotoCmd(page, args.url);
    else if (tool === 'click') await clickCmd(page, args.selector);
    else if (tool === 'type') await typeCmd(page, args.selector, args.text);
    else if (tool === 'done') { console.log('Done:', args.result); break; }
    else { console.log('Unknown tool, stopping.'); break; }
  }
}

