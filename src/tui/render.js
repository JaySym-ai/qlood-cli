import blessed from 'blessed';
import { theme } from './layout.js';
import { getState, setState } from './state.js';
import { getMetrics, onMetricsUpdate } from '../metrics.js';
import { debugLogger } from '../debug.js';

const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

export function createRenderer(screen, ui) {
  const { log, statusBar } = ui;
  let renderTimer = null;
  let toastTimer = null;
  let toastBox = null;
  let spinnerTimer = null;
  let statusTick = null;
  let streamSpinnerTimer = null;

  // Streaming buffer
  let streamBuffer = '';
  let streamFlushTimer = null;

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      try { screen.render(); } catch {}
    }, 80);
  }

  function boundedStreamAppendTop(text) {
    try {
      const str = String(text || '');
      if (!str) return;
      const parts = str.split('\n');
      for (const line of parts) {
        if (line === '') continue;
        log.add(line);
      }
      try {
        const getLinesFn = typeof log.getLines === 'function' ? log.getLines.bind(log) : null;
        let totalLines = 0;
        if (getLinesFn) {
          totalLines = getLinesFn().length;
        } else {
          const get = typeof log.getContent === 'function' ? log.getContent.bind(log) : () => (log.content || '');
          totalLines = String(get() || '').split('\n').length;
        }
        const MAX_TOTAL_LOG_LINES = 1500;
        if (totalLines > MAX_TOTAL_LOG_LINES) {
          const toDelete = totalLines - MAX_TOTAL_LOG_LINES;
          for (let i = 0; i < toDelete; i++) {
            try { if (typeof log.deleteTop === 'function') log.deleteTop(); } catch {}
          }
        }
      } catch {}
      try {
        if (typeof log.getScrollHeight === 'function' && typeof log.setScroll === 'function') {
          log.setScroll(log.getScrollHeight());
        } else {
          log.setScrollPerc(100);
        }
      } catch { try { log.setScrollPerc(100); } catch {} }
    } catch (e) {
      try { log.add(String(text || '')); } catch {}
    }
  }

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
    scheduleRender();
    streamBuffer = '';
  }

  function addLog(message) {
    log.add(message);
    try {
      if (typeof log.getScrollHeight === 'function' && typeof log.setScroll === 'function') {
        log.setScroll(log.getScrollHeight());
      } else {
        log.setScrollPerc(100);
      }
    } catch { try { log.setScrollPerc(100); } catch {} }
    scheduleRender();
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
    scheduleRender();
    toastTimer = setTimeout(() => {
      if (toastBox) { screen.remove(toastBox); toastBox = null; scheduleRender(); }
    }, duration);
  }

  function normalizeChunk(chunk) {
    const text = String(chunk || '')
      .replace(/\r/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Keep original line boundaries; only drop obvious control markers/noise
    const joined = text
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        if (!t) return true; // preserve blank lines to avoid cramming
        if (t === '^D' || t === '^C') return false;
        if (/^script:.*(done|exiting)/i.test(t)) return false;
        return true;
      })
      .join('\n');
    return joined;
  }

  function renderStatus() {
    const now = new Date();
    const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const { auggieCalls } = getMetrics();
    const s = getState();
    const spin = s.streamSpinnerActive ? `{${theme.accent}-fg}${spinnerFrames[s.streamSpinnerFrame]} Running{/}` : `{${theme.dim}-fg}Idle{/}`;
    statusBar.setContent(`{${theme.dim}-fg}Stats:{/} Auggie ${auggieCalls}  {${theme.dim}-fg}| ${clock}{/}  ${spin}`);
  }

  function startStream() {
    setState({ streamSpinnerActive: true, lastStreamChunkAt: Date.now() });
    if (streamSpinnerTimer) clearInterval(streamSpinnerTimer);
    streamSpinnerTimer = setInterval(() => {
      const s = getState();
      const next = (s.streamSpinnerFrame + 1) % spinnerFrames.length;
      setState({ streamSpinnerFrame: next });
      renderStatus();
      scheduleRender();
    }, 100);
  }

  function stopStream() {
    try { flushStreamLog(); } catch {}
    setState({ streamSpinnerActive: false });
    if (streamSpinnerTimer) { clearInterval(streamSpinnerTimer); streamSpinnerTimer = null; }
    renderStatus();
    scheduleRender();
  }

  function attachStatusUpdates() {
    renderStatus();
    statusTick = setInterval(() => {
      renderStatus();
      scheduleRender();
    }, 1000);
    const unsub = onMetricsUpdate(() => {
      renderStatus();
      scheduleRender();
    });
    return () => { try { clearInterval(statusTick); } catch {}; try { unsub(); } catch {}; };
  }

  return {
    scheduleRender,
    addLog,
    showToast,
    normalizeChunk,
    boundedStreamAppendTop,
    streamLog,
    flushStreamLog,
    startStream,
    stopStream,
    renderStatus,
    attachStatusUpdates,
  };
}
