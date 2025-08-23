import blessed from 'blessed';
import fs from 'fs';
import { loadConfig, setModel, setApiKey, getApiKey, getModel } from './config.js';
import { openCmd, gotoCmd, clickCmd, typeCmd } from './commands.js';
import { withPage, createChrome, cancelCurrentAction } from './chrome.js';
import { runAgent, cancelAgentRun } from './agent.js';
import { ensureProjectInit, loadProjectConfig, getProjectStructurePath, saveProjectStructure, scanProject } from './project.js';
import { runProjectTest } from './test.js';

export async function runTui() {
  // Do NOT auto-launch Chrome here; lazily start on first browser command.

  const screen = blessed.screen({
    smartCSR: true,
    title: 'qlood TUI',
    fullUnicode: true,
    dockBorders: true,
  });

  // Layout: Header (3) | Log (flex) | Footer status (1) | Input (3)
  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'gray' },
    },
    content: ''
  });

  const log = blessed.log({
    top: 3,
    left: 0,
    width: '100%',
    height: '100%-7',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      track: { bg: 'black' },
      style: { bg: 'cyan' },
    },
    keys: true,
    mouse: true,
    tags: true,
    label: ' qlood ',
    content: ''
  });

  const statusBar = blessed.box({
    bottom: 3,
    left: 0,
    height: 1,
    width: '100%',
    tags: true,
    style: { fg: 'gray' },
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
    style: {
      border: { fg: 'gray' },
    },
    name: 'input',
  });

  screen.append(header);
  screen.append(log);
  screen.append(statusBar);
  screen.append(input);

  let spinnerTimer = null;
  let labelTimer = null;
  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let spinnerIndex = 0;
  let working = false;
  
  function renderHeader() {
    const model = getModel();
    const k = getApiKey();
    const keyState = k ? '{green-fg}API key ✓{/}' : '{red-fg}API key ✗{/}';
    const state = working ? `{cyan-fg}${spinnerFrames[spinnerIndex]} Working...{/}` : '{gray-fg}Idle{/}';
    header.setContent(
      '{bold}{cyan-fg} qlood {/} {gray-fg}Test Runner TUI{/}\n' +
      ` ${state}   {blue-fg}Model:{/} ${model}   ${keyState}\n` +
      ' {gray-fg}Use {/}{bold}/test <goal>{/}{gray-fg}, or enter free text to drive the agent.{/}'
    );
  }

  function addLog(message) {
    log.add(message);
    log.setScrollPerc(100);
    screen.render();
  }

  function showWorking() {
    working = true;
    if (!spinnerTimer) {
      spinnerTimer = setInterval(() => {
        spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        renderHeader();
        screen.render();
      }, 120);
    }
    if (!labelTimer) {
      let dots = '';
      labelTimer = setInterval(() => {
        dots = dots.length >= 3 ? '' : dots + '.';
        log.setLabel(` qlood - Working${dots} `);
        screen.render();
      }, 500);
    }
  }

  function hideWorking() {
    if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
    if (labelTimer) { clearInterval(labelTimer); labelTimer = null; }
    log.setLabel(' qlood ');
    working = false;
    renderHeader();
    screen.render();
  }

  addLog('{bold}Welcome to qlood TUI{/}');
  loadConfig();
  addLog(`Model: {blue-fg}${getModel()}{/}`);
  const apiKey = getApiKey();
  if (!apiKey) addLog('{yellow-fg}No API key found. Use{/} {bold}/key <your-key>{/} {yellow-fg}to set it.{/}');
  else addLog('{green-fg}API key configured{/}');
  addLog('Type {bold}/help{/} for available commands.');
  addLog('Tip: /test runs an AI test. If not initialized, we will prompt you.');

  // If project isn't initialized, prompt to initialize
  let expectingInitConfirm = false;
  let expectingStructureUpdateConfirm = false;
  const projectCfg = loadProjectConfig(process.cwd());
  if (!projectCfg) {
    expectingInitConfirm = true;
    addLog('{yellow-fg}This project is not initialized for qlood.{/}');
    addLog('We can create ./.qlood, scan your project to set sensible defaults (URL, start command), and add a basic workflow.');
    addLog('Initialize now? {bold}y{/}/n');
  } else {
    const structurePath = getProjectStructurePath(process.cwd());
    if (fs.existsSync(structurePath)) {
      const storedStructure = JSON.parse(fs.readFileSync(structurePath, 'utf-8'));
      const currentStructure = scanProject(process.cwd());
      if (JSON.stringify(storedStructure) !== JSON.stringify(currentStructure)) {
        expectingStructureUpdateConfirm = true;
        addLog('{yellow-fg}Project structure has changed.{/}')
        addLog('Update qlood knowledge about the project? {bold}y{/}/n');
      }
    }
  }

  function renderStatus() {
    statusBar.setContent('{gray-fg}Keys: Enter run  •  Up/Down history  •  Ctrl+C cancel  •  q quit{/}');
  }
  renderHeader();
  renderStatus();

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
      if (expectingInitConfirm) {
        const ans = cmd.toLowerCase();
        if (ans === 'y' || ans === 'yes') {
          ensureProjectInit({});
          const cfg = loadProjectConfig(process.cwd());
          addLog(`{green-fg}Initialized ./.qlood{/} (url: ${cfg?.devServer?.url || 'n/a'}, start: ${cfg?.devServer?.start || 'n/a'})`);
          addLog('You can now run a test with {bold}/test <your scenario>{/} or type a goal for the agent.');
          expectingInitConfirm = false;
          return;
        } else if (ans === 'n' || ans === 'no') {
          addLog('{red-fg}Initialization declined. Exiting qlood...{/}');
          // small delay to allow user to read
          setTimeout(() => { screen.destroy(); process.exit(0); }, 300);
          return;
        } else {
          addLog('Please answer with y or n.');
          return;
        }
      }
      if (expectingStructureUpdateConfirm) {
        const ans = cmd.toLowerCase();
        if (ans === 'y' || ans === 'yes') {
          const currentStructure = scanProject(process.cwd());
          saveProjectStructure(currentStructure, process.cwd());
          addLog(`{green-fg}Project structure updated.{/}`);
          addLog('You can now continue using qlood.');
          expectingStructureUpdateConfirm = false;
          return;
        } else if (ans === 'n' || ans === 'no') {
          addLog('{red-fg}Update declined.{/}')
          expectingStructureUpdateConfirm = false;
          return;
        } else {
          addLog('Please answer with y or n.');
          return;
        }
      }
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
        addLog('{bold}Commands:{/}');
        addLog('  {cyan-fg}/model <id>{/}');
        addLog('  {cyan-fg}/key <apiKey>{/}');
        addLog('  {cyan-fg}/open <url>{/}');
        addLog('  {cyan-fg}/goto <url>{/}');
        addLog('  {cyan-fg}/click <selector>{/}');
        addLog('  {cyan-fg}/type <selector> <text>{/}');
        addLog('  {cyan-fg}/tools{/}');
        addLog('  {cyan-fg}/test <scenario>{/}');
        addLog('  {cyan-fg}/quit{/}');
        addLog('');
        addLog('Free text (no /): run the AI agent with your request.');
        addLog('{gray-fg}Agent tools:{/} {blue-fg}goto{/}(url), {blue-fg}click{/}(selector), {blue-fg}type{/}(selector,text), {blue-fg}search{/}(selector,query), {blue-fg}pressEnter{/}(), {blue-fg}screenshot{/}(path?), {blue-fg}scroll{/}(y), {blue-fg}done{/}(result)');
      } else if (cmd === '/tools') {
        addLog('Available tools:');
        addLog('  {blue-fg}goto{/}(url): Navigate to URL');
        addLog('  {blue-fg}click{/}(selector): Click element');
        addLog('  {blue-fg}type{/}(selector, text): Type text');
        addLog('  {blue-fg}search{/}(selector, query): Type and submit search');
        addLog('  {blue-fg}pressEnter{/}(): Press Enter key');
        addLog('  {blue-fg}screenshot{/}(path?): Save screenshot (default screenshot.png)');
        addLog('  {blue-fg}scroll{/}(y): Scroll by y pixels (positive=down)');
      } else if (cmd.startsWith('/test ')) {
        const scenario = cmd.replace('/test ', '').trim();
        if (!scenario) return addLog('Usage: /test <scenario>');
        showWorking();
        try {
          await runProjectTest(scenario, { debug: true, onLog: (m) => addLog(m) });
          addLog('{green-fg}Test completed{/}');
        } catch (e) {
          addLog(`{red-fg}Test error:{/} ${e?.message || e}`);
        } finally {
          hideWorking();
        }
      } else if (cmd === '/quit') {
        screen.destroy();
        process.exit(0);
      } else {
        // Free text: run AI agent with this as the goal
        function sanitizeGoal(text) {
          // Replace problematic Unicode chars that can cause ByteString issues
          return text
            .replace(/[�]/g, '?')  // replacement characters
            .replace(/[ --]/g, ' ')  // control chars
            .replace(/[က0-က00]/gu, '?')  // 4-byte Unicode
            .replace(/[^ -ÿ]/g, '?')  // non-Latin-1 characters
            .normalize('NFD')  // decompose Unicode
            .replace(/[̀-ͯ]/g, '');  // remove combining marks
        }
        // Sanitize the goal upfront to prevent encoding issues
        const sanitizedCmd = sanitizeGoal(cmd);
        addLog(`Agent goal: {bold}${sanitizedCmd}{/}`);
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
          addLog(`{red-fg}Agent error:{/} ${msg}`);
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
      addLog(`{red-fg}Error:{/} ${e?.message || e}`);
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

  input.on('focus', () => {
    input.style.border = { fg: 'cyan' };
    screen.render();
  });
  input.on('blur', () => {
    input.style.border = { fg: 'gray' };
    screen.render();
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

  // Ctrl+C behavior: first cancels agent + browser action, second within 1.5s exits the TUI.
  let lastCtrlC = 0;
  screen.key(['C-c'], async () => {
    const now = Date.now();
    if (now - lastCtrlC < 1500) {
      screen.destroy();
      process.exit(0);
      return;
    }
    lastCtrlC = now;
    addLog('{yellow-fg}Cancel requested{/}. Press Ctrl+C again to exit.');
    try {
      // Abort in-flight LLM call
      cancelAgentRun();
      await cancelCurrentAction();
      addLog('{green-fg}Current action cancelled.{/}');
    } catch (e) {
      addLog(`Cancel error: ${e?.message || e}`);
    }
  });

  // Also catch SIGINT directly (mac terminals may deliver SIGINT instead of key binding)
  process.on('SIGINT', async () => {
    try {
      cancelAgentRun();
      await cancelCurrentAction();
      hideWorking();
    } finally {
      // Do not exit on first SIGINT; require second as above
      const now = Date.now();
      if (now - lastCtrlC < 1500) {
        screen.destroy();
        process.exit(0);
      } else {
        lastCtrlC = now;
        addLog('{yellow-fg}Cancel requested via SIGINT{/}. Press Ctrl+C again to exit.');
      }
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