import blessed from 'blessed';
import { loadConfig, setModel, setApiKey, getApiKey, getModel } from './config.js';
import { openCmd, gotoCmd, clickCmd, typeCmd } from './commands.js';
import { withPage, createChrome, cancelCurrentAction } from './chrome.js';
import { runAgent } from './agent.js';

export async function runTui() {
  // Do NOT auto-launch Chrome here; lazily start on first browser command.

  const screen = blessed.screen({
    smartCSR: true,
    title: 'qlood TUI',
    fullUnicode: true,
    dockBorders: true,
  });

  const log = blessed.log({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-3',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    tags: false,
    label: ' qlood ' ,
    content: ''
  });

  const input = blessed.textbox({
    bottom: 0,
    left: 0,
    height: 3, // fixed height avoids flicker with borders
    width: '100%',
    inputOnFocus: true,
    keys: true,
    border: { type: 'line' },
    name: 'input',
  });

  screen.append(log);
  screen.append(input);

  let workingIndicator = null;
  
  function addLog(message) {
    log.add(message);
    log.setScrollPerc(100);
    screen.render();
  }

  function showWorking() {
    if (workingIndicator) return;
    let dots = '';
    workingIndicator = setInterval(() => {
      dots = dots.length >= 3 ? '' : dots + '.';
      log.setLabel(` qlood - Working${dots} `);
      screen.render();
    }, 500);
  }

  function hideWorking() {
    if (workingIndicator) {
      clearInterval(workingIndicator);
      workingIndicator = null;
      log.setLabel(' qlood ');
      screen.render();
    }
  }

  addLog('Welcome to qlood TUI');
  loadConfig();
  addLog(`Model: ${getModel()}`);
  const apiKey = getApiKey();
  if (!apiKey) addLog('No API key found. Use /key <your-key> to set it.');
  else addLog('API key configured');
  addLog('Type /help for available commands.');
  addLog('Tip: enter free text (no /) to run the AI agent.');

  // Command history (simple)
  const history = [];
  let histIndex = -1;

  async function ensureChromeReady() {
    // Launch if needed; open normal window, maximized, no DevTools.
    await createChrome({ headless: false, debug: false, devtools: false, maximize: true });
  }

  async function handle(line) {
    const cmd = (line || '').trim();
    if (!cmd) return;
    history.push(cmd);
    histIndex = history.length;

    try {
      if (cmd.startsWith('/model ')) {
        const m = cmd.replace('/model ', '').trim();
        if (!m) return addLog('Usage: /model <id>');
        setModel(m);
        addLog(`Model set to ${m}`);
      } else if (cmd.startsWith('/key ')) {
        const k = cmd.replace('/key ', '').trim();
        if (!k) return addLog('Usage: /key <apiKey>');
        setApiKey(k);
        addLog('API key updated');
      } else if (cmd.startsWith('/open ')) {
        const url = cmd.replace('/open ', '').trim();
        if (!url) return addLog('Usage: /open <url>');
        await openCmd(url, { debug: true, silent: true });
        addLog(`Opened ${url}`);
      } else if (cmd.startsWith('/goto ')) {
        const url = cmd.replace('/goto ', '').trim();
        if (!url) return addLog('Usage: /goto <url>');
        await ensureChromeReady();
        await withPage((page) => gotoCmd(page, url, { silent: true }));
        addLog(`Goto ${url}`);
      } else if (cmd.startsWith('/click ')) {
        const sel = cmd.replace('/click ', '').trim();
        if (!sel) return addLog('Usage: /click <selector>');
        await ensureChromeReady();
        await withPage((page) => clickCmd(page, sel, { silent: true }));
        addLog(`Clicked ${sel}`);
      } else if (cmd.startsWith('/type ')) {
        const rest = cmd.replace('/type ', '');
        const space = rest.indexOf(' ');
        if (space === -1) return addLog('Usage: /type <selector> <text>');
        const sel = rest.slice(0, space).trim();
        const text = rest.slice(space + 1);
        if (!sel) return addLog('Usage: /type <selector> <text>');
        await ensureChromeReady();
        await withPage((page) => typeCmd(page, sel, text, { silent: true }));
        addLog(`Typed into ${sel}`);
      } else if (cmd === '/help') {
        addLog('Commands:');
        addLog('  /model <id>');
        addLog('  /key <apiKey>');
        addLog('  /open <url>');
        addLog('  /goto <url>');
        addLog('  /click <selector>');
        addLog('  /type <selector> <text>');
        addLog('  /tools');
        addLog('  /quit');
        addLog('');
        addLog('Free text (no /): run the AI agent with your request.');
        addLog('Agent tools: goto(url), click(selector), type(selector,text), search(selector,query), pressEnter(), screenshot(path?), scroll(y), done(result)');
      } else if (cmd === '/tools') {
        addLog('Available tools:');
        addLog('  goto(url): Navigate to URL');
        addLog('  click(selector): Click element');
        addLog('  type(selector, text): Type text');
        addLog('  search(selector, query): Type and submit search');
        addLog('  pressEnter(): Press Enter key');
        addLog('  screenshot(path?): Save screenshot (default screenshot.png)');
        addLog('  scroll(y): Scroll by y pixels (positive=down)');
      } else if (cmd === '/quit') {
        screen.destroy();
        process.exit(0);
      } else {
        // Free text: run AI agent with this as the goal
        function sanitizeGoal(text) {
          // Replace problematic Unicode chars that can cause ByteString issues
          return text
            .replace(/[\uFFFD]/g, '?')  // replacement characters
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')  // control chars
            .replace(/[\u{10000}-\u{10FFFF}]/gu, '?')  // 4-byte Unicode
            .replace(/[^\x00-\xFF]/g, '?')  // non-Latin-1 characters
            .normalize('NFD')  // decompose Unicode
            .replace(/[\u0300-\u036f]/g, '');  // remove combining marks
        }
        // Sanitize the goal upfront to prevent encoding issues
        const sanitizedCmd = sanitizeGoal(cmd);
        addLog(`Agent goal: ${sanitizedCmd}`);
        showWorking();
        try {
          await runAgent(sanitizedCmd, {
            debug: true,
            headless: false,
            promptForApiKey: false,
            onLog: (m) => addLog(m),
          });
        } catch (e) {
          const msg = e?.message || String(e);
          addLog(`Agent error: ${msg}`);
          if (msg.includes('API key')) {
            addLog('OpenRouter API key missing. Use /key <apiKey> to set it.');
          }
          // Log the full error for debugging
          addLog(`Full error details: ${JSON.stringify({
            name: e?.name,
            message: e?.message,
            stack: e?.stack?.split('\n')[0]
          })}`);
        } finally {
          hideWorking();
        }
      }
    } catch (e) {
      addLog(`Error: ${e?.message || e}`);
    }
  }

  // Use submit event rather than nested readInput calls
  input.on('submit', async (value) => {
    const line = value ?? input.getValue();
    input.clearValue();
    screen.render();
    await handle(line);
    input.focus();
  });

  // History navigation
  input.key(['up'], () => {
    if (!history.length) return;
    histIndex = Math.max(0, histIndex - 1);
    input.setValue(history[histIndex] ?? '');
    screen.render();
  });
  input.key(['down'], () => {
    if (!history.length) return;
    histIndex = Math.min(history.length, histIndex + 1);
    input.setValue(history[histIndex] ?? '');
    screen.render();
  });

  // Ctrl+C behavior: first cancels current action (closes browser),
  // second within 1.5s exits the TUI.
  let lastCtrlC = 0;
  screen.key(['C-c'], async () => {
    const now = Date.now();
    if (now - lastCtrlC < 1500) {
      screen.destroy();
      process.exit(0);
      return;
    }
    lastCtrlC = now;
    addLog('Cancel requested. Press Ctrl+C again to exit.');
    try {
      await cancelCurrentAction();
      addLog('Current action cancelled.');
    } catch (e) {
      addLog(`Cancel error: ${e?.message || e}`);
    }
  });

  // 'q' to quit directly
  screen.key(['q'], () => {
    screen.destroy();
    process.exit(0);
  });

  input.focus();
  screen.render();
}
