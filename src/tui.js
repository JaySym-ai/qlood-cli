import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import { loadConfig, setApiKey, getApiKey, setMainPrompt, setSystemInstructions, getMainPrompt, getSystemInstructions, setHeadlessMode, getHeadlessMode } from './config.js';
import { openCmd, gotoCmd, clickCmd, typeCmd } from './commands.js';
import { withPage, createChrome, cancelCurrentAction } from './chrome.js';
import { runAgent, cancelAgentRun } from './agent.js';
import { debugLogger } from './debug.js';
import { ensureProjectInit, loadProjectConfig, getProjectStructurePath, saveProjectStructure, scanProject, generateProjectContext, getProjectDir } from './project.js';
import { checkAuthentication } from './auggie-integration.js';

import { addWorkflow, runWorkflow, runAllWorkflows, updateWorkflow, deleteWorkflow, listWorkflows } from './workflows.js';

import { getMetrics, onMetricsUpdate } from './metrics.js';
export async function runTui() {
  // Auto-enable debug logging for this session
  debugLogger.autoEnable(process.cwd());

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
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    shadow: true,
    // These properties can help with cursor positioning
    scrollable: false,
    wrap: false,
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
  // Loading message animator for log
  let loadingInterval = null;
  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let spinnerIndex = 0;
  let working = false;
  let headerHue = 0;

  // Simple output mode: no animations, minimal UI effects
  const SIMPLE_OUTPUT = true;

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
    // Show a different tip when no workflows exist yet
    let hasWorkflows = false;
    try {
      const base = getProjectDir(process.cwd());
      const d = path.join(base, 'workflows');
      if (fs.existsSync(d)) {
        const files = fs.readdirSync(d);
        if (files.some(f => /^(\d+)[-_].+\.md$/.test(f))) { hasWorkflows = true; }
      }
    } catch {}
    const tip = hasWorkflows
      ? ` {${theme.dim}-fg}Use {/}{bold}/wf <id>{/}{${theme.dim}-fg} or {/}{bold}/help{/}{${theme.dim}-fg}. Commands must start with {/}{bold}/{/}{${theme.dim}-fg}.{/}`
      : ` {${theme.dim}-fg}Create your first workflow using {/}{bold}/wfadd <description>{/}{${theme.dim}-fg}. Commands must start with {/}{bold}/{/}{${theme.dim}-fg}.{/}`;
    header.setContent(
      `${brand} {${theme.dim}-fg}AI Test Runner{/}\n` +
      ` ${state}   ${keyState}\n` +
      tip
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
    if (SIMPLE_OUTPUT) {
      addLog('{dim}Working...{/}');
      renderHeader();
      return;
    }
    // Animated mode (unused when SIMPLE_OUTPUT=true)
    const workingText = `{${theme.accent}-fg}${spinnerFrames[spinnerIndex]}{/} {dim}Working...{/}`;
    workingLogLine = blessed.text({ parent: log, content: workingText, tags: true, style: { fg: theme.fg } });
    if (!spinnerTimer) {
      let dotCount = 0; let pulseState = false;
      spinnerTimer = setInterval(() => {
        spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        renderHeader();
        if (workingLogLine) workingLogLine.setContent(`{${theme.accent}-fg}${spinnerFrames[spinnerIndex]}{/} {dim}Working...{/}`);
        if (spinnerIndex % 4 === 0) { dotCount = dotCount >= 3 ? 0 : dotCount + 1; log.setLabel(` qlood - Working${'.'.repeat(dotCount)} `);}
        if (spinnerIndex % 5 === 0) { pulseState = !pulseState; statusBar.style.fg = pulseState ? theme.accent : theme.dim; }
        screen.render();
      }, 120);
    }
  }

  function hideWorking() {
    if (!SIMPLE_OUTPUT) {
      if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
      if (loadingSpinnerTimer) { clearInterval(loadingSpinnerTimer); loadingSpinnerTimer = null; }
      if (loadingOverlay) { loadingOverlay.hidden = true; }
      backdrop.hidden = true;
      if (workingLogLine) { workingLogLine.destroy(); workingLogLine = null; }
      statusBar.style.fg = theme.dim;
      log.setLabel(' qlood ');
      screen.render();
    }
    working = false;
    renderHeader();
  }

  // Helper function to check Auggie authentication
  async function checkAuggieAuth() {
    try {
      const authResult = await checkAuthentication();
      if (authResult.success && authResult.authenticated) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      addLog(`{red-fg}Error checking Auggie authentication:{/} ${error.message}`);
      return false;
    }
  }

  // Helper function to show authentication error
  function showAuthError(action = 'use AI features') {
    addLog(`{red-fg}❌ Authentication required to ${action}.{/}`);
    addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
    showToast('Login required', 'error');
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

  // Check Auggie authentication
  const isAuggieAuthenticated = await checkAuggieAuth();
  if (!isAuggieAuthenticated) {
    addLog('{red-fg}❌ Authentication required for AI features.{/}');
    addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
    showToast('Login required', 'error');
    // Skip project initialization when not authenticated, but continue with TUI setup
  } else {
    addLog('Type {bold}/help{/} for available commands.');
    addLog('Tip: Commands must start with {bold}/{/}.');
    // Tip depends on existing workflows
    try {
      const wfDir = path.join(getProjectDir(process.cwd()), 'workflows');
      const hasWfs = fs.existsSync(wfDir) && fs.readdirSync(wfDir).some(f => /^(\d+)-.+\.md$/.test(f));
      if (hasWfs) {
        addLog('Tip: /wf <id> runs a workflow. Use {bold}/wfls{/} to list workflows.');
      } else {
        addLog('Tip: Create your first workflow using {bold}/wfadd <description>{/}.');
      }
    } catch {
      addLog('Tip: /wf <id> runs a workflow. Use {bold}/wfls{/} to list workflows.');
    }
  }

  // If project isn't initialized, prompt to initialize (only if authenticated)
  let expectingInitConfirm = false;
  let expectingStructureUpdateConfirm = false;
  if (isAuggieAuthenticated) {
    const projectCfg = loadProjectConfig(process.cwd());
    if (!projectCfg) {
      expectingInitConfirm = true;
      addLog('{yellow-fg}This project is not initialized for qlood.{/}');
      addLog('We can create ./.qlood, scan your project to set sensible defaults (URL, start command), and add a basic workflow.');
      addLog('This will also allow the {cyan-fg}www.augmentcode.com{/} Auggie CLI tool to index your codebase for faster retrieval.');
      addLog('Initialize now? {bold}y{/}/n');
    } else {
      // Check if context.md exists, if not generate it
      const contextPath = path.join(getProjectDir(process.cwd()), 'notes', 'context.md');
      if (!fs.existsSync(contextPath)) {
        addLog('{cyan-fg}Generating missing project context...{/}');
        startLoadingAnimation('Analyzing project with Auggie... This may take several minutes.');

        generateProjectContext(process.cwd(), { silent: true }).then(success => {
          if (success) {
            stopLoadingAnimation('Project context generated successfully');
          } else {
            stopLoadingAnimation('Could not generate project context', false);
          }
        }).catch(error => {
          stopLoadingAnimation(`Context generation failed: ${error.message}`, false);
        });
      }
    }
  }

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

  // Loading animation helper - operates on the main log widget
  function startLoadingAnimation(message) {
    // Always show a small animated spinner in the log while working
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    addLog(`{cyan-fg}${frames[0]} ${message}{/}`);
    if (loadingInterval) { clearInterval(loadingInterval); loadingInterval = null; }
    loadingInterval = setInterval(() => {
      const content = log.getContent();
      const lines = content.split('\n');
      if (lines.length > 0) {
        lines[lines.length - 1] = `{cyan-fg}${frames[frameIndex]} ${message}{/}`;
        log.setContent(lines.join('\n'));
        screen.render();
      }
      frameIndex = (frameIndex + 1) % frames.length;
    }, 80);
  }

  function stopLoadingAnimation(finalMessage, isSuccess = true) {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
      const content = log.getContent();
      const lines = content.split('\n');
      if (lines.length > 0) {
        const color = isSuccess ? 'green-fg' : 'yellow-fg';
        const icon = isSuccess ? '✓' : '⚠';
        lines[lines.length - 1] = `{${color}}${icon} ${finalMessage}{/}`;
        log.setContent(lines.join('\n'));
        screen.render();
      } else {
        // Fallback if there was nothing to animate
        addLog(isSuccess ? `{green-fg}${finalMessage}{/}` : `{yellow-fg}${finalMessage}{/}`);
      }
    } else {
      // If no animation was running, still show a final message
      addLog(isSuccess ? `{green-fg}${finalMessage}{/}` : `{yellow-fg}${finalMessage}{/}`);
    }
  }

  // Global Y/N handling when we expect confirmation
  screen.key(['y', 'Y'], async () => {
    if (!expectingInitConfirm && !expectingStructureUpdateConfirm) return;
    input.clearValue();
    if (expectingInitConfirm) {
      // Initialize without context generation (we'll do it with animation)
      const result = await ensureProjectInit({ skipContext: true });
      const cfg = loadProjectConfig(process.cwd());
      addLog(`{green-fg}Initialized ./.qlood{/}`);

      // Now generate context with animation (only if authenticated)
      const authResult = await checkAuthentication();
      if (authResult.success && authResult.authenticated) {
        startLoadingAnimation('Generating project context with Auggie... This may take several minutes.');

        try {
          const success = await generateProjectContext(process.cwd(), { silent: true });
          if (success) {
            stopLoadingAnimation('Project context generated successfully');
          } else {
            stopLoadingAnimation('Could not generate project context', false);
          }
        } catch (error) {
          stopLoadingAnimation(`Context generation failed: ${error.message}`, false);
        }
      } else {
        addLog('{red-fg}❌ Authentication required to generate context.{/}');
        addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
      }

      addLog('You can now run a workflow with {bold}/wf <id>{/}.');
      showToast('Project initialized', 'success');
      expectingInitConfirm = false;
    }
    if (expectingStructureUpdateConfirm) {
      const currentStructure = scanProject(process.cwd());
      saveProjectStructure(currentStructure, process.cwd());

      // Generate context with animation (only if authenticated)
      const authResult = await checkAuthentication();
      if (authResult.success && authResult.authenticated) {
        startLoadingAnimation('Updating project context with Auggie... This may take several minutes.');

        try {
          const success = await generateProjectContext(process.cwd(), { silent: true });
          if (success) {
            stopLoadingAnimation('Project context updated successfully');
            addLog(`{green-fg}Project structure and context updated.{/}`);
          } else {
            stopLoadingAnimation('Could not update project context', false);
            addLog(`{green-fg}Project structure updated.{/}`);
          }
        } catch (error) {
          stopLoadingAnimation(`Context update failed: ${error.message}`, false);
          addLog(`{green-fg}Project structure updated.{/}`);
        }
      } else {
        addLog(`{green-fg}Project structure updated.{/}`);
        addLog('{red-fg}❌ Authentication required to generate context.{/}');
        addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
      }

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
      setTimeout(() => { teardownAndExit(0); }, 300);
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
    const { llmCalls, auggieCalls, toolCalls, lastTool } = getMetrics();
    const lastToolText = lastTool ? ` (last: ${lastTool})` : '';
    statusBar.setContent(`{${theme.dim}-fg}Stats:{/} LLM ${llmCalls}  •  Auggie ${auggieCalls}  •  Tools ${toolCalls}${lastToolText}  {${theme.dim}-fg}| ${clock}{/}`);
  }
  renderHeader();
  renderStatus();

  // Live status updates: refresh clock every second, and react to metrics updates
  let statusTick = setInterval(() => {
    renderStatus();
    screen.render();
  }, 1000);
  const unsubscribeMetrics = onMetricsUpdate(() => {
    renderStatus();
    screen.render();
  });

  function teardownAndExit(code = 0) {
    try { if (statusTick) clearInterval(statusTick); } catch {}
    try { if (unsubscribeMetrics) unsubscribeMetrics(); } catch {}
    try { if (headerAnimTimer) clearInterval(headerAnimTimer); } catch {}
    try { if (spinnerTimer) clearInterval(spinnerTimer); } catch {}
    try { if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer); } catch {}
    screen.destroy();
    process.exit(code);
  }

  // Header idle animation (gentle)
  function startHeaderAnim() {
    if (headerAnimTimer) return;
    headerAnimTimer = setInterval(() => {
      headerHue = (headerHue + 1) % 999;
      renderHeader();
      screen.render();
    }, 700);
  }
  if (!SIMPLE_OUTPUT) startHeaderAnim();

  // Command history (simple)
  const history = [];
  let histIndex = -1;

  async function ensureChromeReady() {
    // Launch if needed using current headless configuration
    await createChrome({ devtools: false, maximize: true });
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
          // Initialize without context generation (we'll do it with animation)
          const result = await ensureProjectInit({ skipContext: true });
          const cfg = loadProjectConfig(process.cwd());
          addLog(`{green-fg}Initialized ./.qlood{/}`);

          // Now generate context with animation (only if authenticated)
          const authResult = await checkAuthentication();
          if (authResult.success && authResult.authenticated) {
            startLoadingAnimation('Generating project context with Auggie... This may take several minutes.');

            try {
              const success = await generateProjectContext(process.cwd(), { silent: true });
              if (success) {
                stopLoadingAnimation('Project context generated successfully');
              } else {
                stopLoadingAnimation('Could not generate project context', false);
              }
            } catch (error) {
              stopLoadingAnimation(`Context generation failed: ${error.message}`, false);
            }
          } else {
            addLog('{red-fg}❌ Authentication required to generate context.{/}');
            addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
          }

          addLog('You can now run a workflow with {bold}/wf <id>{/}.');
          showToast('Project initialized', 'success');
          expectingInitConfirm = false;
          return;
        } else if (ans === 'n' || ans === 'no') {
          addLog('{red-fg}Initialization declined. Exiting qlood...{/}');
          showToast('Initialization declined', 'warn');
          // small delay to allow user to read
          setTimeout(() => { teardownAndExit(0); }, 300);
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

          // Generate context with animation
          startLoadingAnimation('Updating project context with Auggie... This may take several minutes.');

          const authResult = await checkAuthentication();
          if (authResult.success && authResult.authenticated) {
            try {
              const success = await generateProjectContext(process.cwd(), { silent: true });
              if (success) {
                stopLoadingAnimation('Project context updated successfully');
                addLog(`{green-fg}Project structure and context updated.{/}`);
              } else {
                stopLoadingAnimation('Could not update project context', false);
                addLog(`{green-fg}Project structure updated.{/}`);
              }
            } catch (error) {
              stopLoadingAnimation(`Context update failed: ${error.message}`, false);
              addLog(`{green-fg}Project structure updated.{/}`);
            }
          } else {
            stopLoadingAnimation('Project structure updated');
            addLog(`{green-fg}Project structure updated.{/}`);
            addLog('{red-fg}❌ Authentication required to generate context.{/}');
            addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
          }

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
      } else if (cmd === '/headless') {
        const currentMode = getHeadlessMode();
        const newMode = !currentMode;
        setHeadlessMode(newMode);
        const status = newMode ? '{green-fg}Active{/}' : '{yellow-fg}Deactivated{/}';
        addLog(`Headless mode: ${status}`);
        showToast(`Headless ${newMode ? 'enabled' : 'disabled'}`, newMode ? 'success' : 'warn');
        addLog('{dim-fg}Browser will restart with new settings on next command.{/}');
        // Close current browser so next command will use new headless setting
        await cancelCurrentAction();
      } else if (cmd.startsWith('/open ')) {
        const url = cmd.replace('/open ', '').trim();
        if (!url) return addLog('Usage: /open <url>');
        await openCmd(url, { silent: true });
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
      } else if (cmd.startsWith('/wfadd ')) {
        const desc = cmd.replace('/wfadd ', '').trim();
        if (!desc) return addLog('Usage: /wfadd <description>');
        const authResult = await checkAuthentication();
        if (!authResult.success || !authResult.authenticated) {
          addLog(`{red-fg}❌ Authentication required to create workflows.{/}`);
          addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
          showToast('Login required', 'error');
          return;
        }
        startLoadingAnimation('Creating workflow with Auggie...');
        try {
          const { id, file } = await addWorkflow(desc);
          stopLoadingAnimation('Workflow created', true);
          addLog(`{green-fg}Workflow created{/}: ${file} (id: ${id})`);
        } catch (e) {
          stopLoadingAnimation(`wfadd error: ${e?.message || e}`, false);
          addLog(`{red-fg}wfadd error:{/} ${e?.message || e}`);
        }
      } else if (cmd.startsWith('/wfdel ')) {
        const id = Number(cmd.replace('/wfdel ', '').trim());
        if (!id) return addLog('Usage: /wfdel <id>');
        try {
          const { file } = deleteWorkflow(id);
          addLog(`{yellow-fg}Workflow deleted{/}: ${file}`);
        } catch (e) {
          addLog(`{red-fg}wfdel error:{/} ${e?.message || e}`);
        }
      } else if (cmd.startsWith('/wdupdate ')) {
        const id = Number(cmd.replace('/wdupdate ', '').trim());
        if (!id) return addLog('Usage: /wdupdate <id>');
        const authResult = await checkAuthentication();
        if (!authResult.success || !authResult.authenticated) {
          addLog(`{red-fg}❌ Authentication required to update workflows.{/}`);
          addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
          showToast('Login required', 'error');
          return;
        }
        startLoadingAnimation('Updating workflow with Auggie...');
        try {
          const res = await updateWorkflow(id);
          stopLoadingAnimation(res.updated ? 'Workflow updated' : 'No changes applied', res.updated);
          addLog(res.updated ? `{green-fg}Workflow updated{/}: ${res.file}` : `{yellow-fg}No changes applied{/}: ${res.file}`);
        } catch (e) {
          stopLoadingAnimation(`wdupdate error: ${e?.message || e}`, false);
          addLog(`{red-fg}wdupdate error:{/} ${e?.message || e}`);
        }
      } else if (cmd === '/wfls') {
        const items = listWorkflows();
        if (!items.length) { addLog('No workflows found. Use /wfadd to create one.'); }
        for (const it of items) addLog(`- ${it.id}: ${it.name} (${it.file})`);
      } else if (cmd.startsWith('/wf ')) {
        const idText = cmd.replace('/wf ', '').trim();
        const id = Number(idText);
        const items = listWorkflows();
        if (!items.length) {
          addLog('{yellow-fg}No workflows found in ./.qlood/workflows.{/}');
          addLog('Create one with: {bold}/wfadd <short description>{/}');
          addLog('Example: {cyan-fg}/wfadd User signup and login{/}');
          addLog('Then run it with: {cyan-fg}/wf 1{/}');
          return;
        }
        if (!id) {
          addLog('Usage: /wf <id>');
          addLog('Tip: list available workflows with {bold}/wfls{/}');
          return;
        }
        showWorking();
        try {
          await runWorkflow(id, { headless: getHeadlessMode(), debug: false, onLog: (m) => addLog(m) });
          addLog('{green-fg}Workflow test completed{/}');
        } catch (e) {
          addLog(`{red-fg}wf error:{/} ${e?.message || e}`);
        } finally {
          hideWorking();
        }
      } else if (cmd === '/wfall') {
        showWorking();
        try {
          const res = await runAllWorkflows({ headless: getHeadlessMode(), debug: false, onLog: (m) => addLog(m) });
          addLog(`{green-fg}Completed ${res.length} workflow(s){/}`);
        } catch (e) {
          addLog(`{red-fg}wfall error:{/} ${e?.message || e}`);
        } finally {
          hideWorking();
        }
      } else if (cmd === '/clean') {
        try {
          const base = getProjectDir(process.cwd());
          const targets = ['debug', 'notes', 'results'].map(d => path.join(base, d));
          let removed = 0;
          for (const dir of targets) {
            if (!fs.existsSync(dir)) continue;
            const entries = fs.readdirSync(dir);
            for (const name of entries) {
              const p = path.join(dir, name);
              try {
                fs.rmSync(p, { recursive: true, force: true });
                removed++;
              } catch (e) {
                addLog(`{yellow-fg}Warning{/}: failed to remove ${path.relative(process.cwd(), p)} - ${e.message}`);
              }
            }
          }
          addLog(`{green-fg}Cleaned{/} ${removed} item(s) from {bold}.qlood/debug{/}, {bold}.qlood/notes{/}, and {bold}.qlood/results{/}.`);
          showToast('Workspace cleaned', 'success');
        } catch (e) {
          addLog(`{red-fg}clean error:{/} ${e?.message || e}`);
          showToast('Clean failed', 'error');
        }
      } else if (cmd === '/help') {
        addLog('{bold}Commands:{/}');
        addLog('  {cyan-fg}/key <apiKey>{/} - Set your OpenRouter API key for AI features');
        addLog('  {cyan-fg}/headless{/} - Toggle headless browser mode');
        addLog('  {cyan-fg}/wfadd <description>{/} - Create a new test workflow');
        addLog('  {cyan-fg}/wfls{/} - List all available workflows');
        addLog('  {cyan-fg}/wf <id>{/} - Run a specific workflow by ID');
        addLog('  {cyan-fg}/wfall{/} - Run all workflows sequentially');
        addLog('  {cyan-fg}/wdupdate <id>{/} - Update workflow to match code changes');
        addLog('  {cyan-fg}/wfdel <id>{/} - Delete a workflow');
        addLog('  {cyan-fg}/context [--update]{/} - View or update project context');
        addLog('  {cyan-fg}/clean{/} - Delete all files under ./.qlood/debug, ./.qlood/notes, ./.qlood/results');
        addLog('  {cyan-fg}/quit{/} - Exit qlood');
        addLog('');
        addLog('All input must start with {bold}/{/} (e.g., {cyan-fg}/wf 1{/}).');

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
      } else if (cmd === '/auggie-login' || cmd === '/login') {
        addLog('{cyan-fg}To authenticate with Auggie:{/}');
        addLog('1. Open a new terminal window');
        addLog('2. Run: {bold}auggie --login{/}');
        addLog('3. Follow the authentication prompts');
        addLog('4. Once authenticated, restart qlood to use AI features');
        addLog('');
        addLog('If Auggie is not installed, run: {bold}qlood auggie-check{/}');
        addLog('');
        addLog('Alternative: Run {bold}auggie --compact{/} for a compact login interface');
      } else if (cmd === '/context' || cmd.startsWith('/context ')) {
        const wantsUpdate = /\b(--update|-u|update)\b/.test(cmd);
        const cwd = process.cwd();
        const qloodPath = path.join(getProjectDir(cwd), 'notes', 'context.md');
        const rootPath = path.join(cwd, 'context.md');
        if (wantsUpdate) {
          const authResult = await checkAuthentication();
          if (authResult.success && authResult.authenticated) {
            startLoadingAnimation('Updating project context with Auggie... This may take several minutes.');
            try {
              const ok = await generateProjectContext(cwd, { silent: true });
              stopLoadingAnimation(ok ? 'Project context updated' : 'Failed to update project context', ok);
              if (ok) {
                addLog('{green-fg}✓ Project context updated{/}');
                showToast('Context updated', 'success');
              } else {
                addLog('{yellow-fg}⚠ Failed to update project context{/}');
                showToast('Context update failed', 'error');
              }
            } catch (e) {
              stopLoadingAnimation(`Context update error: ${e?.message || e}`, false);
              addLog(`{red-fg}Context update error:{/} ${e?.message || e}`);
              showToast('Context update error', 'error');
            }
          } else {
            addLog('{red-fg}❌ Authentication required to update context.{/}');
            addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
            showToast('Login required', 'error');
          }
        }

        // Read and display context
        try {
          let readPath = null;
          if (fs.existsSync(qloodPath)) readPath = qloodPath;
          else if (fs.existsSync(rootPath)) readPath = rootPath;
          if (!readPath) {
            addLog('{yellow-fg}No context found.{/} Use {bold}/context --update{/} to generate it.');
          } else {
            const rel = path.relative(cwd, readPath);
            const content = fs.readFileSync(readPath, 'utf-8');
            const stat = fs.statSync(readPath);
            addLog(`{bold}--- Project Context (${rel}) ---{/}`);
            addLog(`{dim-fg}Last updated: ${new Date(stat.mtime).toISOString()}{/}`);
            addLog(content);
          }
        } catch (e) {
          addLog(`{red-fg}Error reading context:{/} ${e?.message || e}`);
        }
      } else if (cmd === '/quit') {
        teardownAndExit(0);
      } else {
        // Free text is not accepted: show help automatically
        addLog('{yellow-fg}Commands must start with {/}{bold}/{/}{yellow-fg}. Showing help...{/}');
        await handle('/help');
      } // End of else block
    } catch (e) {
      addLog(`{red-fg}Error:{/} ${e?.message || e}`);
    }
  } // End of handle function

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
      teardownAndExit(0);
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
        teardownAndExit(0);
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
    teardownAndExit(0);
  });

  input.focus();
  screen.render();
}
