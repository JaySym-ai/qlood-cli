import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import { setMainPrompt, setSystemInstructions } from './config.js';
import { debugLogger } from './debug.js';
import { ensureProjectInit, loadProjectConfig, getProjectDir, ensureProjectDirs, extractCleanMarkdown } from './project.js';
import { checkAuthentication, executeCustomPromptStream } from './auggie-integration.js';

import { addWorkflow, updateWorkflow, deleteWorkflow, listWorkflows } from './workflows.js';

import { buildRefactorPrompt } from './prompts/prompt.refactor.js';
import { getMetrics, onMetricsUpdate } from './metrics.js';
export async function runTui() {
  // Auto-enable debug logging for this session
  debugLogger.autoEnable(process.cwd());

  // Ensure we are attached to a real TTY; otherwise Blessed will fail with setRawMode EIO
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Error: QLOOD-CLI requires an interactive terminal (TTY).');
    console.error('Tip: Run in a real terminal, or use subcommands like "qlood test ..." or "qlood agent ..." in non-interactive environments.');
    process.exit(1);
  }

  // Local browser control removed; Auggie (MCP) handles automation.

  const screen = blessed.screen({
    smartCSR: true,
    title: 'QLOOD-CLI',
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

  // Layout: Log (flex) | Footer status (1) | Input (3)

  const log = blessed.log({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-4',
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
    label: ' QLOOD-CLI ',
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

  // Loading message animator for log
  let loadingInterval = null;
  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let spinnerIndex = 0;
  let working = false;


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

  // Streaming status spinner (non-intrusive; shown in status bar)
  let streamSpinnerActive = false;
  let streamSpinnerTimer = null;
  let streamSpinnerFrame = 0;

  // Streaming heartbeat to reassure during long silences
  let lastStreamChunkAt = 0;
  let heartbeatTimer = null;

  function startStream() {
    setStreamSpinner(true);
    lastStreamChunkAt = Date.now();
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastStreamChunkAt > 4000) {
        addLog('{dim}… still working{/}');
        lastStreamChunkAt = now;
      }
    }, 2000);
  }

  function stopStream() {
    setStreamSpinner(false);
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }
  // Status bar spinner controller (top-level)
  // Rendering scheduler to reduce flicker
  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      try { screen.render(); } catch {}
  // Bounded live stream into the log: keep only the last N lines of stream
  const STREAM_MAX_LINES = Number(process.env.QLOOD_STREAM_MAX_LINES || 200);
  function boundedStreamAppend(text) {
    const content = log.getContent();
    const parts = content.split('\n');
    // Find the last non-stream marker; we treat everything after the last "Starting:" as stream for simplicity
    let splitIdx = parts.lastIndexOf('{cyan-fg}Starting:');
    if (splitIdx === -1) splitIdx = parts.length; // no starting marker, append at end

    // Existing stream tail
    const head = parts.slice(0, splitIdx + 1);
    const tail = parts.slice(splitIdx + 1);

    // New stream lines
    const newLines = String(text || '').split('\n');
    const combined = [...tail, ...newLines].filter(Boolean);

    // Trim to last STREAM_MAX_LINES
    const trimmedTail = combined.slice(-STREAM_MAX_LINES);

    const next = [...head, ...trimmedTail].join('\n');
    log.setContent(next);
  }
    }, 80);
  }


  // Bounded live stream into the log: keep only the last N lines of stream (top-level, correct scope)
  function boundedStreamAppendTop(text) {
    const max = Number(process.env.QLOOD_STREAM_MAX_LINES || 200);
    const content = log.getContent();
    const parts = content.split('\n');
    // Treat everything after the last "Starting:" line as the live stream tail
    let splitIdx = parts.lastIndexOf('{cyan-fg}Starting:');
    if (splitIdx === -1) splitIdx = parts.length;
    const head = parts.slice(0, splitIdx + 1);
    const tail = parts.slice(splitIdx + 1);
    const newLines = String(text || '').split('\n');
    const combined = [...tail, ...newLines].filter(Boolean);
    const trimmedTail = combined.slice(-max);
    log.setContent([...head, ...trimmedTail].join('\n'));
  }

  // Throttled stream logging buffer
  let streamBuffer = '';
  let streamFlushTimer = null;
  function streamLog(text) {
    streamBuffer += String(text || '');
    if (!streamFlushTimer) {
      streamFlushTimer = setTimeout(() => flushStreamLog(), 120);
    }
  }
  function flushStreamLog() {
    if (streamFlushTimer) { clearTimeout(streamFlushTimer); streamFlushTimer = null; }
    if (!streamBuffer) return;
    boundedStreamAppendTop(streamBuffer.trimEnd());
    streamBuffer = '';
  }

  function setStreamSpinner(active) {
    if (active && !streamSpinnerActive) {
      streamSpinnerActive = true;
      const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
      streamSpinnerTimer = setInterval(() => {
        streamSpinnerFrame = (streamSpinnerFrame + 1) % frames.length;
        renderStatus();
        screen.render();
      }, 100);
    } else if (!active && streamSpinnerActive) {
      streamSpinnerActive = false;
      if (streamSpinnerTimer) { clearInterval(streamSpinnerTimer); streamSpinnerTimer = null; }
      renderStatus();
      screen.render();
    }
  }

  // Normalize streamed chunks to reduce choppy wrapping (top-level)
  function normalizeChunk(chunk) {
    const text = String(chunk || '').replace(/\r/g, '');
    const lines = text.split('\n');
    const out = [];
    let acc = '';
    for (const raw of lines) {
      const l = raw;
      const t = l.trim();
      const isBoundary = t === '' || /^[🔧📋]/.test(t) || /^-{2,}$/.test(t);
      if (isBoundary) {
        if (acc) { out.push(acc); acc = ''; }
        out.push(l);
        continue;
      }
      if (t.length <= 3) {
        acc += (acc ? ' ' : '') + t;
      } else {
        if (acc) { out.push(acc); acc = ''; }
        out.push(l);
      }
    }
    if (acc) out.push(acc);
    return out.join('\n');
  }


  // Loading overlay
  let loadingOverlay = null;
  let loadingSpinnerTimer = null;







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

      return;
    }
    // Animated mode (unused when SIMPLE_OUTPUT=true)
    const workingText = `{${theme.accent}-fg}${spinnerFrames[spinnerIndex]}{/} {dim}Working...{/}`;
    workingLogLine = blessed.text({ parent: log, content: workingText, tags: true, style: { fg: theme.fg } });
    if (!spinnerTimer) {
      let dotCount = 0; let pulseState = false;
      spinnerTimer = setInterval(() => {
        spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;

        if (workingLogLine) workingLogLine.setContent(`{${theme.accent}-fg}${spinnerFrames[spinnerIndex]}{/} {dim}Working...{/}`);
        if (spinnerIndex % 4 === 0) { dotCount = dotCount >= 3 ? 0 : dotCount + 1; log.setLabel(` QLOOD-CLI - Working${'.'.repeat(dotCount)} `);}
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
      log.setLabel(' QLOOD-CLI ');
      screen.render();
    }
    working = false;

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

  addLog('{bold}Welcome to QLOOD-CLI{/}');
  // Auggie handles authentication; run `auggie --login` if needed.

  // Check Auggie authentication
  startLoadingAnimation('Checking Auggie authentication...');
  const isAuggieAuthenticated = await checkAuggieAuth();
  stopLoadingAnimation('Authentication check complete', true);
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
      const hasWfs = fs.existsSync(wfDir) && fs.readdirSync(wfDir).some(f => /^(\d+)[-_].+\.md$/.test(f));
      if (hasWfs) {
        addLog('Tip: Use {bold}/wfls{/} to list workflows.');
      } else {
        addLog('Tip: Create your first workflow using {bold}/wfadd <description>{/}.');
      }
    } catch {
      addLog('Tip: Use {bold}/wfls{/} to list workflows.');
    }
  }

  // If project isn't initialized, prompt to initialize (only if authenticated)
  let expectingInitConfirm = false;
  if (isAuggieAuthenticated) {
    const projectCfg = loadProjectConfig(process.cwd());
    if (!projectCfg) {
      expectingInitConfirm = true;
      addLog('{yellow-fg}This project is not initialized for QLOOD-CLI.{/}');
      addLog('We can create ./.qlood and scan your project to set sensible defaults (URL, start command).');
      addLog('This will also allow the {cyan-fg}www.augmentcode.com{/} Auggie CLI tool to index your codebase for faster retrieval.');
      addLog('Initialize now? {bold}y{/}/n');
    } else {
      // Project is initialized; Auggie will handle context internally when needed.
    }
  }

  // Removed project structure comparison/update logic

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
    if (!expectingInitConfirm) return;
    input.clearValue();
    if (expectingInitConfirm) {
      // Initialize project (Auggie handles context)
      const result = await ensureProjectInit();
      const cfg = loadProjectConfig(process.cwd());
      addLog(`{green-fg}Initialized ./.qlood{/}`);

      // Auggie handles context internally; no local generation
      const authResult = await checkAuthentication();
      if (!(authResult.success && authResult.authenticated)) {
        addLog('{red-fg}❌ Authentication required for Auggie features.{/}');
        addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
      }

      const items = listWorkflows();
      if (!items.length) {
        addLog('{yellow-fg}No workflows found yet.{/}');
        addLog('Create one with: {bold}/wfadd <short description>{/}');
        addLog('Example: {cyan-fg}/wfadd User signup and login{/}');
      }
      showToast('Project initialized', 'success');
      expectingInitConfirm = false;
    }
    input.focus();
    screen.render();
  });
  screen.key(['n', 'N'], () => {
    if (!expectingInitConfirm) return;
    input.clearValue();
    if (expectingInitConfirm) {
  // Normalize streamed chunks to reduce choppy wrapping
  function normalizeChunk(chunk) {
    const text = String(chunk || '').replace(/\r/g, '');
    const lines = text.split('\n');
    const out = [];
    let acc = '';
    for (const raw of lines) {
      const l = raw;
      const t = l.trim();
      const isBoundary = t === '' || /^[🔧📋]/.test(t) || /^-{2,}$/.test(t);
      if (isBoundary) {
        if (acc) { out.push(acc); acc = ''; }
        out.push(l);
        continue;
      }
      if (t.length <= 3) {
        acc += (acc ? ' ' : '') + t;
      } else {
        if (acc) { out.push(acc); acc = ''; }
        out.push(l);
      }
    }
    if (acc) out.push(acc);
    return out.join('\n');
  }

      addLog('{red-fg}Initialization declined. Exiting QLOOD-CLI...{/}');
      showToast('Initialization declined', 'warn');
      setTimeout(() => { teardownAndExit(0); }, 300);
      return;
    }
    // No structure update flow
    input.focus();
    screen.render();
  });

  function renderStatus() {
    const now = new Date();
    const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const { llmCalls, auggieCalls } = getMetrics();
    const spin = streamSpinnerActive ? `{${theme.accent}-fg}${spinnerFrames[streamSpinnerFrame]} Running{/}` : `{${theme.dim}-fg}Idle{/}`;
    statusBar.setContent(`{${theme.dim}-fg}Stats:{/} LLM ${llmCalls}  •  Auggie ${auggieCalls}  {${theme.dim}-fg}| ${clock}{/}  ${spin}`);
  }

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

    try { if (spinnerTimer) clearInterval(spinnerTimer); } catch {}
    try { if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer); } catch {}
    screen.destroy();
    process.exit(code);
  }



  // Command history (simple)
  const history = [];
  let histIndex = -1;

  // Local browser lifecycle removed; ensureChromeReady is a no-op
  async function ensureChromeReady() { return; }

  async function handle(line) {
    const cmd = (line || '').trim();
    if (!cmd) return;
    history.push(cmd);
    histIndex = history.length;

    // Log user input for debug
  function setStreamSpinner(active) {
    if (active && !streamSpinnerActive) {
      streamSpinnerActive = true;
      const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
      streamSpinnerTimer = setInterval(() => {
        streamSpinnerFrame = (streamSpinnerFrame + 1) % frames.length;
        // Re-render status bar to show spinner
        renderStatus();
        screen.render();
      }, 100);
    } else if (!active && streamSpinnerActive) {
      streamSpinnerActive = false;
      if (streamSpinnerTimer) { clearInterval(streamSpinnerTimer); streamSpinnerTimer = null; }
      renderStatus();
      screen.render();
    }
  }

    // Log user input for debug

    debugLogger.logUserInput(cmd, 'TUI');

    try {
      if (expectingInitConfirm) {
        const ans = cmd.toLowerCase();
        if (ans === 'y' || ans === 'yes') {
          const result = await ensureProjectInit();
          const cfg = loadProjectConfig(process.cwd());
          addLog(`{green-fg}Initialized ./.qlood{/}`);
          const authResult = await checkAuthentication();
          if (!(authResult.success && authResult.authenticated)) {
            addLog('{red-fg}❌ Authentication required for Auggie features.{/}');
            addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
          }
          const items = listWorkflows();
          if (!items.length) {
            addLog('{yellow-fg}No workflows found yet.{/}');
            addLog('Create one with: {bold}/wfadd <short description>{/}');
            addLog('Example: {cyan-fg}/wfadd User signup and login{/}');
          }
          showToast('Project initialized', 'success');
          expectingInitConfirm = false;
          return;
        } else if (ans === 'n' || ans === 'no') {
          addLog('{red-fg}Initialization declined. Exiting QLOOD-CLI...{/}');
          showToast('Initialization declined', 'warn');
          setTimeout(() => { teardownAndExit(0); }, 300);
          return;
        } else {
          addLog('Please answer with y or n.');
          return;
        }
      }
      // No structure update confirmation flow
      if (cmd.startsWith('/prompt ')) {
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
      } else if (cmd.startsWith('/open ')) {
        const url = cmd.replace('/open ', '').trim();
        if (!url) return addLog('Usage: /open <url>');
        addLog('{yellow-fg}/open is no longer available. Use Auggie via `qlood agent` for browser actions.{/}');
      } else if (cmd.startsWith('/goto ')) {
        const url = cmd.replace('/goto ', '').trim();
        if (!url) return addLog('Usage: /goto <url>');
        addLog('{yellow-fg}Low-level browser commands are removed. Use Auggie via `qlood agent`.{/}');
      } else if (cmd.startsWith('/click ')) {
        const sel = cmd.replace('/click ', '').trim();
        if (!sel) return addLog('Usage: /click <selector>');
        addLog('{yellow-fg}Low-level browser commands are removed. Use Auggie via `qlood agent`.{/}');
      } else if (cmd.startsWith('/type ')) {
        const rest = cmd.replace('/type ', '');
        const space = rest.indexOf(' ');
        if (space === -1) return addLog('Usage: /type <selector> <text>');
        const sel = rest.slice(0, space).trim();
        const text = rest.slice(space + 1);
        if (!sel) return addLog('Usage: /type <selector> <text>');
        addLog('{yellow-fg}Low-level browser commands are removed. Use Auggie via `qlood agent`.{/}');
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
        addLog('{cyan-fg}Starting: Creating workflow with Auggie...{/}');
        startStream();
        try {
          const streamHandlers = {
            onStdout: (chunk) => {
              lastStreamChunkAt = Date.now();
              const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
              if (text.trim().length === 0) return;
              streamLog(text + "\n");
              scheduleRender();
            },
            onStderr: (chunk) => {
              lastStreamChunkAt = Date.now();
              const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
              if (text.trim().length === 0) return;
              streamLog(`{yellow-fg}${text}{/}\n`);
              scheduleRender();
            }
          };
          const { id, file } = await addWorkflow(desc, { streamHandlers });
          stopStream();
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
      } else if (cmd.startsWith('/wfupdate ')) {
        const id = Number(cmd.replace('/wfupdate ', '').trim());
        if (!id) return addLog('Usage: /wfupdate <id>');
        const authResult = await checkAuthentication();
        if (!authResult.success || !authResult.authenticated) {
          addLog(`{red-fg}❌ Authentication required to update workflows.{/}`);
          addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
          showToast('Login required', 'error');
          return;
        }
        addLog('{cyan-fg}Starting: Updating workflow with Auggie...{/}');
        startStream();
        try {
          const streamHandlers = {
            onStdout: (chunk) => {
              lastStreamChunkAt = Date.now();
              const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
              if (text.trim().length === 0) return;
              streamLog(text + "\n");
              scheduleRender();
            },
            onStderr: (chunk) => {
              lastStreamChunkAt = Date.now();
              const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
              if (text.trim().length === 0) return;
              streamLog(`{yellow-fg}${text}{/}\n`);
              scheduleRender();
            }
          };
          const res = await updateWorkflow(id, { streamHandlers });
          stopStream();
          addLog(res.updated ? `{green-fg}Workflow updated{/}: ${res.file}` : `{yellow-fg}No changes applied{/}: ${res.file}`);
        } catch (e) {
          stopLoadingAnimation(`wfupdate error: ${e?.message || e}`, false);
          addLog(`{red-fg}wfupdate error:{/} ${e?.message || e}`);
        }
      } else if (cmd === '/wfls') {
        const items = listWorkflows();
        if (!items.length) { addLog('No workflows found. Use /wfadd to create one.'); }
        for (const it of items) addLog(`- ${it.id}: ${it.name} (${it.file})`);
      } else if (cmd === '/wf') {
        const items = listWorkflows();
        if (!items.length) {
          addLog('{yellow-fg}No workflows found in ./.qlood/workflows.{/}');
          addLog('Create one with: {bold}/wfadd <short description>{/}');
          addLog('Example: {cyan-fg}/wfadd User signup and login{/}');
          addLog('{yellow-fg}Run functionality removed. Use `qlood agent` for goals.{/}');
          return;
        }
        addLog('Multiple workflows found. Use {bold}/wfls{/} to list.');

      } else if (cmd.startsWith('/wf ')) {
        const idText = cmd.replace('/wf ', '').trim();
        const id = Number(idText);
        const items = listWorkflows();
        if (!items.length) {
          addLog('{yellow-fg}No workflows found in ./.qlood/workflows.{/}');
          addLog('Create one with: {bold}/wfadd <short description>{/}');
          addLog('Example: {cyan-fg}/wfadd User signup and login{/}');
          addLog('{yellow-fg}Run functionality removed. Use `qlood agent` for goals.{/}');
          return;
        }
        addLog('{yellow-fg}Running workflows from TUI is no longer supported.{/}');
      } else if (cmd === '/clean') {
        try {
          const base = getProjectDir(process.cwd());
          const targets = ['debug', 'results'].map(d => path.join(base, d));
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
          addLog(`{green-fg}Cleaned{/} ${removed} item(s) from {bold}.qlood/debug{/} and {bold}.qlood/results{/}.`);
          showToast('Workspace cleaned', 'success');
        } catch (e) {
          addLog(`{red-fg}clean error:{/} ${e?.message || e}`);
          showToast('Clean failed', 'error');
        }
      } else if (cmd === '/help') {
        addLog('{bold}Commands:{/}');
        addLog('  {cyan-fg}/wfadd <description>{/} - Create a new test workflow');
        addLog('  {cyan-fg}/wfls{/} - List all available workflows');
        addLog('  {cyan-fg}/wfupdate <id>{/} - Update workflow to match code changes');
        addLog('  {cyan-fg}/wfdel <id>{/} - Delete a workflow');
        addLog('  {cyan-fg}/refactor{/} - Analyze repo and save a refactor plan under ./.qlood/results');
        addLog('  {cyan-fg}/clean{/} - Delete all files under ./.qlood/debug and ./.qlood/results');
        addLog('  {cyan-fg}/quit{/} - Exit QLOOD-CLI');
        addLog('');
        addLog('All input must start with {bold}/{/}.');


        // Credentials management help
        addLog('');
        addLog('{bold}Testing credentials (safe handling){/}');
        addLog('  - Provide credentials via env vars or a gitignored .env file:');
        addLog('    {cyan-fg}QLOOD_TEST_USERNAME{/}, {cyan-fg}QLOOD_TEST_PASSWORD{/}');
        addLog('  - Avoid passing secrets on the command line; typed text is masked in logs.');

      } else if (cmd === '/auggie-login' || cmd === '/login') {
        addLog('{cyan-fg}To authenticate with Auggie:{/}');
        addLog('1. Open a new terminal window');
        addLog('2. Run: {bold}auggie --login{/}');
        addLog('3. Follow the authentication prompts');
        addLog('4. Once authenticated, restart QLOOD-CLI to use AI features');
        addLog('');
        addLog('If Auggie is not installed, run: {bold}qlood auggie-check{/}');
        addLog('');
        addLog('Alternative: Run {bold}auggie --compact{/} for a compact login interface');
      } else if (cmd === '/context' || cmd.startsWith('/context ')) {
        addLog('{yellow-fg}Context management is now handled internally by Auggie. This command is deprecated.{/}');
        showToast('Context command removed', 'warn');
      } else if (cmd === '/refactor') {
        const authResult = await checkAuthentication();
        if (!authResult.success || !authResult.authenticated) {
          addLog('{red-fg}❌ Authentication required to run refactor analysis.{/}');
          addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
          showToast('Login required', 'error');
          return;
        }
        addLog('{cyan-fg}Starting: Scanning repository for refactoring opportunities...{/}');
        setStreamSpinner(true);
        const cwd = process.cwd();
        try {
          ensureProjectDirs(cwd);
          const prompt = buildRefactorPrompt();
          let liveBuf = '';
          const result = await executeCustomPromptStream(prompt, { cwd, usePrintFormat: true }, {
            onStdout: (chunk) => {
              liveBuf += chunk;
              const text = String(chunk).replace(/\r/g, '');
              if (text.trim().length === 0) return;
              streamLog(text + "\n");
              scheduleRender();
            },
            onStderr: (chunk) => {
              const text = String(chunk).replace(/\r/g, '');
              if (text.trim().length === 0) return;
              streamLog(`{yellow-fg}${text}{/}\n`);
              scheduleRender();
            }
          });
          let content = result.success ? extractCleanMarkdown(result.stdout || liveBuf) : '';
          if (!content || content.trim().length < 50) {
            content = (result.stdout || liveBuf || '# Refactor Plan\n\nNo results.');
          }
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const baseDir = path.join(getProjectDir(cwd), 'results', `refactor-${ts}`);
          fs.mkdirSync(baseDir, { recursive: true });
          const outPath = path.join(baseDir, 'refactor.md');
          fs.writeFileSync(outPath, content, 'utf-8');
          setStreamSpinner(false);
          addLog(`Saved refactor plan: ${path.relative(cwd, outPath)}`);
          showToast('Refactor plan saved', 'success');
        } catch (e) {
          setStreamSpinner(false);
          addLog(`{red-fg}refactor error:{/} ${e?.message || e}`);
          showToast('Refactor failed', 'error');
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

  // Ctrl+C behavior: exits the TUI.
  let lastCtrlC = 0;
  screen.key(['C-c'], async () => {

    if (spinnerTimer) clearInterval(spinnerTimer);
    if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer);
    teardownAndExit(0);
  });

  // Also catch SIGINT directly (mac terminals may deliver SIGINT instead of key binding)
  process.on('SIGINT', async () => {
    hideWorking();

    if (spinnerTimer) clearInterval(spinnerTimer);
    if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer);
    teardownAndExit(0);
  });

  // 'q' to quit directly
  screen.key(['q'], () => {

    if (spinnerTimer) clearInterval(spinnerTimer);
    if (loadingSpinnerTimer) clearInterval(loadingSpinnerTimer);
    teardownAndExit(0);
  });

  input.focus();
  screen.render();
}
