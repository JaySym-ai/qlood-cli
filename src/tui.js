import blessed from 'blessed';
import fs from 'fs';
import { loadConfig, setApiKey, getApiKey, setMainPrompt, setSystemInstructions, getMainPrompt, getSystemInstructions } from './config.js';
import { openCmd, gotoCmd, clickCmd, typeCmd } from './commands.js';
import { withPage, createChrome, cancelCurrentAction } from './chrome.js';
import { runAgent, cancelAgentRun } from './agent.js';
import { debugLogger } from './debug.js';
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

  // THEME
  const theme = {
    bg: 'black',
    fg: 'white',
    dim: 'gray',
    accent: 'cyan',
    accentAlt: 'magenta',
    success: 'green',
    warn: 'yellow',
    error: 'red',
  };

  // Layout: Header (3) | Log (flex) | Footer status (1) | Input (3)
  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    tags: true,
    border: { type: 'line' },
    shadow: true,
    style: {
      fg: theme.fg,
      bg: theme.bg,
      border: { fg: theme.dim },
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
      track: { bg: theme.bg },
      style: { bg: theme.accent },
    },
    keys: true,
    mouse: true,
    tags: true,
    label: ' qlood ',
    shadow: true,
    padding: { left: 1, right: 1 },
    style: {
      fg: theme.fg,
      bg: theme.bg,
      border: { fg: theme.dim },
      label: { fg: theme.accent },
    },
    content: ''
  });

  const statusBar = blessed.box({
    bottom: 3,
    left: 0,
    height: 1,
    width: '100%',
    tags: true,
    style: { fg: theme.dim, bg: theme.bg },
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
      fg: theme.fg,
      bg: theme.bg,
      border: { fg: theme.dim },
    },
    name: 'input',
    padding: { left: 1, right: 1 },
    shadow: true,
  });

  screen.append(header);
  screen.append(log);
  screen.append(statusBar);
  screen.append(input);

  // Backdrop (for overlays)
  const backdrop = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    style: { bg: theme.bg },
    hidden: true,
    mouse: false,
    keys: false,
  });
  screen.append(backdrop);

  let spinnerTimer = null;
  let headerAnimTimer = null;
  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let spinnerIndex = 0;
  let working = false;
  let headerHue = 0;

  // Toasts
  let toastTimer = null;
  let toastBox = null;

  // Help overlay
  let helpOverlay = null;

  // Command palette overlay
  let paletteOverlay = null;
  let paletteList = null;

  // Loading overlay
  let loadingOverlay = null;
  let loadingSpinnerTimer = null;
  
  function colorCycle(colors) {
    return colors[(headerHue) % colors.length];
  }

  function gradientText(text) {
    // Cycle across accent colors for a simple gradient illusion
    const palette = [theme.accent, theme.accentAlt, 'blue'];
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const c = palette[(i + headerHue) % palette.length];
      out += `{${c}-fg}${text[i]}{/}`;
    }
    return out;
  }

  function renderHeader() {
    const k = getApiKey();
    const keyState = k ? '{green-fg}API key ✓{/}' : '{red-fg}API key ✗{/}';
    const state = working
      ? `{${theme.accent}-fg}${spinnerFrames[spinnerIndex]} Working...{/}`
      : `{${theme.dim}-fg}Idle{/}`;
    const brand = `{bold}${gradientText(' qlood ')}{/}`;
    header.setContent(
      `${brand} {${theme.dim}-fg}AI Test Runner{/}\n` +
      ` ${state}   ${keyState}\n` +
      ` {${theme.dim}-fg}Use {/}{bold}/test <goal>{/}{${theme.dim}-fg}, or enter a goal for the agent.{/}`
    );
  }

  function addLog(message) {
    log.add(message);
    log.setScrollPerc(100);
    screen.render();
    
    // Log system output for debug (strip color codes for cleaner log)
    const cleanMessage = message.replace(/\{[^}]*\}/g, '');
    debugLogger.logSystemOutput(cleanMessage, 'info');
  }

  function showToast(message, type = 'info', duration = 2200) {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastBox) { screen.remove(toastBox); toastBox = null; }
    const color = type === 'success' ? theme.success : type === 'error' ? theme.error : type === 'warn' ? theme.warn : theme.accent;
    toastBox = blessed.box({
      bottom: 4,
      right: 2,
      width: 'shrink',
      height: 'shrink',
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      tags: true,
      content: `{bold}{${color}-fg}${message}{/}`,
      border: { type: 'line' },
      style: { fg: theme.fg, bg: theme.bg, border: { fg: color } },
      shadow: true,
    });
    screen.append(toastBox);
    screen.render();
    toastTimer = setTimeout(() => {
      if (toastBox) { screen.remove(toastBox); toastBox = null; screen.render(); }
    }, duration);
  }

  function ensureLoadingOverlay() {
    if (loadingOverlay) return;
    loadingOverlay = blessed.box({
      top: 'center', left: 'center', width: 30, height: 5,
      border: { type: 'line' },
      tags: true,
      content: '',
      style: { fg: theme.fg, bg: theme.bg, border: { fg: theme.accent } },
      shadow: true,
      hidden: true,
    });
    screen.append(loadingOverlay);
  }

  let workingLogLine = null;

  function showWorking() {
    working = true;
    
    // Add a working indicator line to the log instead of overlay
    const workingText = `{${theme.accent}-fg}${spinnerFrames[spinnerIndex]}{/} {dim}Working...{/}`;
    workingLogLine = blessed.text({
      parent: log,
      content: workingText,
      tags: true,
      style: { fg: theme.fg }
    });
    
    // Consolidated animation timer to prevent multiple concurrent renders
    if (!spinnerTimer) {
      let dotCount = 0;
      let pulseState = false;
      
      spinnerTimer = setInterval(() => {
        // Update spinner
        spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        
        // Update header
        renderHeader();
        
        // Update working log line if it exists
        if (workingLogLine) {
          const workingText = `{${theme.accent}-fg}${spinnerFrames[spinnerIndex]}{/} {dim}Working...{/}`;
          workingLogLine.setContent(workingText);
        }
        
        // Update dots every ~500ms (4 cycles of 120ms)
        if (spinnerIndex % 4 === 0) {
          dotCount = dotCount >= 3 ? 0 : dotCount + 1;
          const dots = '.'.repeat(dotCount);
          log.setLabel(` qlood - Working${dots} `);
        }
        
        // Update status pulse every ~600ms (5 cycles of 120ms) 
        if (spinnerIndex % 5 === 0) {
          pulseState = !pulseState;
          statusBar.style.fg = pulseState ? theme.accent : theme.dim;
        }
        
        // Single render call for all updates
        screen.render();
      }, 120);
    }
  }

  function hideWorking() {
    if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
    if (loadingSpinnerTimer) { clearInterval(loadingSpinnerTimer); loadingSpinnerTimer = null; }
    if (loadingOverlay) { loadingOverlay.hidden = true; }
    backdrop.hidden = true;
    
    // Remove the working indicator line from log
    if (workingLogLine) {
      workingLogLine.destroy();
      workingLogLine = null;
    }
    
    // Reset status bar color and log label
    statusBar.style.fg = theme.dim;
    log.setLabel(' qlood ');
    working = false;
    renderHeader();
    screen.render();
  }

  addLog('{bold}Welcome to qlood TUI{/}');
  loadConfig();
  const apiKey = getApiKey();
  if (!apiKey) {
    addLog('{yellow-fg}No API key found. Use{/} {bold}/key <your-key>{/} {yellow-fg}to set it.{/}');
    showToast('No API key set', 'warn');
  } else {
    addLog('{green-fg}API key configured{/}');
    showToast('API key configured', 'success');
  }
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

  // Global Y/N handling when we expect confirmation
  screen.key(['y', 'Y'], () => {
    if (!expectingInitConfirm && !expectingStructureUpdateConfirm) return;
    input.clearValue();
    if (expectingInitConfirm) {
      ensureProjectInit({});
      const cfg = loadProjectConfig(process.cwd());
      addLog(`{green-fg}Initialized ./.qlood{/} (url: ${cfg?.devServer?.url || 'n/a'}, start: ${cfg?.devServer?.start || 'n/a'})`);
      addLog('You can now run a test with {bold}/test <your scenario>{/} or type a goal for the agent.');
      showToast('Project initialized', 'success');
      expectingInitConfirm = false;
    }
    if (expectingStructureUpdateConfirm) {
      const currentStructure = scanProject(process.cwd());
      saveProjectStructure(currentStructure, process.cwd());
      addLog(`{green-fg}Project structure updated.{/}`);
      addLog('You can now continue using qlood.');
      showToast('Project structure updated', 'success');
      expectingStructureUpdateConfirm = false;
    }
    input.focus();
    screen.render();
  });
  screen.key(['n', 'N'], () => {
    if (!expectingInitConfirm && !expectingStructureUpdateConfirm) return;
    input.clearValue();
    if (expectingInitConfirm) {
      addLog('{red-fg}Initialization declined. Exiting qlood...{/}');
      showToast('Initialization declined', 'warn');
      setTimeout(() => { screen.destroy(); process.exit(0); }, 300);
      return;
    }
    if (expectingStructureUpdateConfirm) {
      addLog('{red-fg}Update declined.{/}');
      showToast('Update declined', 'warn');
      expectingStructureUpdateConfirm = false;
    }
    input.focus();
    screen.render();
  });

  function renderStatus() {
    const now = new Date();
    const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    statusBar.setContent(`{${theme.dim}-fg}Keys:{/} Enter run  •  Up/Down history  •  Ctrl+C cancel  •  q quit  •  F1 help  •  Ctrl+K palette {${theme.dim}-fg}| ${clock}{/}`);
  }
  renderHeader();
  renderStatus();

  // Header idle animation (gentle)
  function startHeaderAnim() {
    if (headerAnimTimer) return;
    headerAnimTimer = setInterval(() => {
      headerHue = (headerHue + 1) % 999;
      renderHeader();
      screen.render();
    }, 700);
  }
  startHeaderAnim();

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
    
    // Log user input for debug
    debugLogger.logUserInput(cmd, 'TUI');

    try {
      if (expectingInitConfirm) {
        const ans = cmd.toLowerCase();
        if (ans === 'y' || ans === 'yes') {
          ensureProjectInit({});
          const cfg = loadProjectConfig(process.cwd());
          addLog(`{green-fg}Initialized ./.qlood{/} (url: ${cfg?.devServer?.url || 'n/a'}, start: ${cfg?.devServer?.start || 'n/a'})`);
          addLog('You can now run a test with {bold}/test <your scenario>{/} or type a goal for the agent.');
          showToast('Project initialized', 'success');
          expectingInitConfirm = false;
          return;
        } else if (ans === 'n' || ans === 'no') {
          addLog('{red-fg}Initialization declined. Exiting qlood...{/}');
          showToast('Initialization declined', 'warn');
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
          showToast('Project structure updated', 'success');
          expectingStructureUpdateConfirm = false;
          return;
        } else if (ans === 'n' || ans === 'no') {
          addLog('{red-fg}Update declined.{/}')
          showToast('Update declined', 'warn');
          expectingStructureUpdateConfirm = false;
          return;
        } else {
          addLog('Please answer with y or n.');
          return;
        }
      }
      if (cmd.startsWith('/key ')) {
        const k = cmd.replace('/key ', '').trim();
        if (!k) return addLog('Usage: /key <apiKey>');
        setApiKey(k);
        addLog('API key updated');
        showToast('API key updated', 'success');
      } else if (cmd.startsWith('/prompt ')) {
        const p = cmd.replace('/prompt ', '').trim();
        if (!p) return addLog('Usage: /prompt <main prompt>');
        setMainPrompt(p);
        addLog('Main prompt updated');
        showToast('Main prompt updated', 'success');
      } else if (cmd.startsWith('/instructions ')) {
        const i = cmd.replace('/instructions ', '').trim();
        if (!i) return addLog('Usage: /instructions <system instructions>');
        setSystemInstructions(i);
        addLog('System instructions updated');
        showToast('System instructions updated', 'success');
      } else if (cmd === '/debug') {
        if (debugLogger.isEnabled()) {
          const info = debugLogger.getSessionInfo();
          addLog(`{yellow-fg}Debug already enabled{/} (Session: ${info.sessionId})`);
          addLog(`Debug file: {blue-fg}${info.debugFile}{/}`);
          addLog(`Steps logged: {cyan-fg}${info.stepCounter}{/}`);
          addLog('Use {bold}/debug off{/} to disable.');
        } else {
          debugLogger.enable(process.cwd());
          addLog('{green-fg}Debug mode enabled!{/}');
          addLog(`Debug logs will be saved to {blue-fg}./.qlood/debug/{/}`);
          addLog('All tool calls and AI requests will be logged.');
          addLog('Use {bold}/debug off{/} to disable.');
          showToast('Debug enabled', 'success');
        }
      } else if (cmd === '/debug off') {
        if (debugLogger.isEnabled()) {
          const debugFile = debugLogger.getDebugFile();
          debugLogger.disable();
          addLog('{yellow-fg}Debug mode disabled.{/}');
          addLog(`Final debug log: {blue-fg}${debugFile}{/}`);
          showToast('Debug disabled', 'warn');
        } else {
          addLog('{yellow-fg}Debug mode is not enabled.{/}');
          showToast('Debug not enabled', 'warn');
        }
      } else if (cmd.startsWith('/open ')) {
        const url = cmd.replace('/open ', '').trim();
        if (!url) return addLog('Usage: /open <url>');
        await openCmd(url, { debug: true, silent: true });
        addLog(`Opened ${url}`);
        showToast('Opened browser', 'info');
      } else if (cmd.startsWith('/goto ')) {
        const url = cmd.replace('/goto ', '').trim();
        if (!url) return addLog('Usage: /goto <url>');
        await ensureChromeReady();
        await withPage((page) => gotoCmd(page, url, { silent: true }));
        addLog(`Goto ${url}`);
        showToast('Navigated', 'info');
      } else if (cmd.startsWith('/click ')) {
        const sel = cmd.replace('/click ', '').trim();
        if (!sel) return addLog('Usage: /click <selector>');
        await ensureChromeReady();
        await withPage((page) => clickCmd(page, sel, { silent: true }));
        addLog(`Clicked ${sel}`);
        showToast('Clicked', 'info');
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
        showToast('Typed', 'info');
      } else if (cmd === '/help') {
        addLog('{bold}Commands:{/}');
        addLog('  {cyan-fg}/key <apiKey>{/}');
        addLog('  {cyan-fg}/prompt <main prompt>{/}');
        addLog('  {cyan-fg}/instructions <system instructions>{/}');
        addLog('  {cyan-fg}/debug{/} / {cyan-fg}/debug off{/}');
        addLog('  {cyan-fg}/open <url>{/}');
        addLog('  {cyan-fg}/goto <url>{/}');
        addLog('  {cyan-fg}/click <selector>{/}');
        addLog('  {cyan-fg}/type <selector> <text>{/}');
        addLog('  {cyan-fg}/tools{/}');
        addLog('  {cyan-fg}/test <scenario>{/}');
        addLog('  {cyan-fg}/quit{/}');
        addLog('');
        addLog('Free text (no /): run the AI agent with your request.');
        addLog('{gray-fg}Agent tools:{/} {blue-fg}goto{/}(url), {blue-fg}click{/}(selector), {blue-fg}type{/}(selector,text), {blue-fg}search{/}(selector,query), {blue-fg}pressEnter{/}(), {blue-fg}screenshot{/}(path?), {blue-fg}scroll{/}(y), {blue-fg}cli{/}(command), {blue-fg}done{/}(result)');
      } else if (cmd === '/tools') {
        addLog('Available tools:');
        addLog('  {blue-fg}goto{/}(url): Navigate to URL');
        addLog('  {blue-fg}click{/}(selector): Click element');
        addLog('  {blue-fg}type{/}(selector, text): Type text');
        addLog('  {blue-fg}search{/}(selector, query): Type and submit search');
        addLog('  {blue-fg}pressEnter{/}(): Press Enter key');
        addLog('  {blue-fg}screenshot{/}(path?): Save screenshot (default screenshot.png)');
        addLog('  {blue-fg}scroll{/}(y): Scroll by y pixels (positive=down)');
        addLog('  {blue-fg}cli{/}(command, args?, options?): Execute CLI commands');
        addLog('  {blue-fg}cliHelp{/}(command): Get help for CLI commands');
        addLog('  {blue-fg}cliList{/}(): List running background processes');
        addLog('  {blue-fg}cliKill{/}(processId): Kill background process');
      } else if (cmd.startsWith('/test ')) {
        const scenario = cmd.replace('/test ', '').trim();
        if (!scenario) return addLog('Usage: /test <scenario>');
        showWorking();
        try {
          await runProjectTest(scenario, { debug: true, onLog: (m) => addLog(m) });
          addLog('{green-fg}Test completed{/}');
          showToast('Test completed', 'success');
        } catch (e) {
          addLog(`{red-fg}Test error:{/} ${e?.message || e}`);
          showToast('Test error', 'error');
        } finally {
          hideWorking();
        }
      } else if (cmd === '/quit') {
        screen.destroy();
        process.exit(0);
      } else {
        // Free text: run AI agent with this as the goal
        function sanitizeGoal(text) {
          // Replace control chars and non-ASCII; strip combining marks
          return String(text)
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x20-\x7E]/g, '?');
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
          showToast('Agent error', 'error');
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

  // Removed placeholder handling - input field starts empty

  // Use submit event rather than nested readInput calls
  input.on('submit', async (value) => {
    let line = value ?? input.getValue();
    if (!line.trim()) {
      input.clearValue();
      screen.render();
      input.focus();
      return;
    }
    input.clearValue();
    screen.render();
    await handle(line);
    input.focus();
  });

  input.on('focus', () => {
    input.style.border = { fg: theme.accent };
    input.style.fg = theme.fg;
    // subtle focus pulse
    let steps = 0;
    const colors = [theme.accent, theme.accentAlt, theme.accent];
    const focusTimer = setInterval(() => {
      input.style.border = { fg: colors[steps % colors.length] };
      screen.render();
      steps++;
      if (steps > 4) clearInterval(focusTimer);
    }, 120);
    screen.render();
  });
  input.on('blur', () => {
    input.style.border = { fg: theme.dim };
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
      if (headerAnimTimer) clearInterval(headerAnimTimer);
      if (spinnerTimer) clearInterval(spinnerTimer);
      if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer);
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
        if (headerAnimTimer) clearInterval(headerAnimTimer);
        if (spinnerTimer) clearInterval(spinnerTimer);
        if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer);
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
    if (headerAnimTimer) clearInterval(headerAnimTimer);
    if (spinnerTimer) clearInterval(spinnerTimer);
    if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer);
    screen.destroy();
    process.exit(0);
  });

  // F1 or ? -> Help overlay
  function toggleHelpOverlay() {
    if (helpOverlay && !helpOverlay.hidden) {
      helpOverlay.hide();
      backdrop.hidden = true;
      screen.render();
      return;
    }
    if (!helpOverlay) {
      helpOverlay = blessed.box({
        top: 'center', left: 'center', width: '80%', height: '70%',
        border: { type: 'line' },
        style: { fg: theme.fg, bg: theme.bg, border: { fg: theme.accent } },
        tags: true,
        scrollable: true,
        keys: true,
        mouse: true,
        label: ' Help & Shortcuts ',
        padding: { left: 1, right: 1, top: 1, bottom: 1 },
        shadow: true,
        content: ''
      });
      screen.append(helpOverlay);
    }
    const helpText = [
      '{bold}Commands{/}',
      '  /key <apiKey>          Set API key',
      '  /prompt <text>         Set main prompt',
      '  /instructions <text>   Set system instructions',
      '  /debug | /debug off    Toggle debug logging',
      '  /open <url>            Open new browser',
      '  /goto <url>            Navigate current tab',
      '  /click <selector>      Click element',
      '  /type <sel> <text>     Type into element',
      '  /tools                 List tools',
      '  /test <scenario>       Run AI test',
      '  /quit                  Exit',
      '',
      '{bold}Shortcuts{/}',
      '  Enter    Run input',
      '  Up/Down  History',
      '  Ctrl+C   Cancel; twice to quit',
      '  q        Quit',
      '  F1/?     Toggle Help',
      '  Ctrl+K   Command Palette',
    ].join('\n');
    helpOverlay.setContent(helpText);
    helpOverlay.show();
    backdrop.hidden = false;
    helpOverlay.focus();
    // Close on Esc / q / Enter / F1 / ?
    helpOverlay.key(['escape', 'q', 'enter', 'f1', '?'], () => {
      helpOverlay.hide();
      backdrop.hidden = true;
      input.focus();
      screen.render();
    });
    screen.render();
  }
  screen.key(['f1', '?'], toggleHelpOverlay);

  // Ctrl+K -> Command palette
  function ensurePalette() {
    if (paletteOverlay) return;
    paletteOverlay = blessed.box({
      top: 'center', left: 'center', width: '70%', height: '60%',
      border: { type: 'line' },
      style: { fg: theme.fg, bg: theme.bg, border: { fg: theme.accentAlt } },
      label: ' Command Palette ',
      shadow: true,
    });
    paletteList = blessed.list({
      parent: paletteOverlay,
      top: 1, left: 1, right: 1, bottom: 1,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      style: {
        item: { fg: theme.fg },
        selected: { fg: theme.bg, bg: theme.accent },
      },
      items: [],
    });
    paletteList.on('select', (el) => {
      const raw = el.getText();
      const cmd = raw.replace(/^.*?\s+-\s+/, '').trim();
      input.setValue(cmd);
      paletteOverlay.hide();
      backdrop.hidden = true;
      input.focus();
      screen.render();
    });
    paletteOverlay.key(['escape'], () => {
      paletteOverlay.hide();
      backdrop.hidden = true;
      input.focus();
      screen.render();
    });
    screen.append(paletteOverlay);
  }
  function togglePalette() {
    ensurePalette();
    if (!paletteOverlay.hidden) {
      paletteOverlay.hide();
      backdrop.hidden = true;
      input.focus();
      screen.render();
      return;
    }
    const entries = [
      '{bold}Open{/}   - /open <url>',
      '{bold}Goto{/}   - /goto <url>',
      '{bold}Click{/}  - /click <selector>',
      '{bold}Type{/}   - /type <selector> <text>',
      '{bold}Tools{/}  - /tools',
      '{bold}Test{/}   - /test <scenario>',
      '{bold}API Key{/}- /key <apiKey>',
      '{bold}Prompt{/} - /prompt <text>',
      '{bold}Instr{/}  - /instructions <text>',
      '{bold}Debug{/}  - /debug',
    ];
    paletteList.setItems(entries);
    paletteOverlay.show();
    backdrop.hidden = false;
    paletteList.focus();
    screen.render();
  }
  screen.key(['C-k'], togglePalette);

  // Global Escape: close overlays and refocus input
  screen.key(['escape'], () => {
    if (helpOverlay && !helpOverlay.hidden) helpOverlay.hide();
    if (paletteOverlay && !paletteOverlay.hidden) paletteOverlay.hide();
    if (loadingOverlay && !loadingOverlay.hidden) { /* keep working overlay if running */ }
    backdrop.hidden = true;
    input.focus();
    screen.render();
  });

  input.focus();
  screen.render();
}
