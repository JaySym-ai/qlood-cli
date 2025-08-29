import { getState, setState } from './state.js';
import { cancelActiveAuggie, hasActiveAuggie } from './adapters/auggie.js';

export function registerKeymap({ screen, input, renderer, events, teardown }) {
  const { scheduleRender, addLog, showToast } = renderer;

  // Submit handling
  input.on('submit', async (value) => {
    let line = value ?? input.getValue();
    if (!line.trim()) {
      input.clearValue();
      scheduleRender();
      input.focus();
      return;
    }
    const s0 = getState();
    const nextHistory = s0.history.concat([line]);
    setState({ history: nextHistory, histIndex: nextHistory.length });
    input.clearValue();
    scheduleRender();
    try {
      await events.handleCommand(line);
    } catch (e) {
      if (e && e.message === '__EXIT__') {
        return teardown(0);
      }
      addLog(`{red-fg}Error:{/} ${e?.message || e}`);
    }
    input.focus();
  });

  // Focus visuals
  input.on('focus', () => {
    input.style.border = { fg: 'cyan' };
    input.style.fg = 'white';
    scheduleRender();
  });
  input.on('blur', () => {
    input.style.border = { fg: 'gray' };
    scheduleRender();
  });

  // History navigation
  input.key(['up'], () => {
    const s = getState();
    if (!s.history.length) return;
    const idx = Math.max(0, s.histIndex - 1);
    setState({ histIndex: idx });
    input.setValue(s.history[idx] ?? '');
    scheduleRender();
  });
  input.key(['down'], () => {
    const s = getState();
    if (!s.history.length) return;
    const idx = Math.min(s.history.length, s.histIndex + 1);
    setState({ histIndex: idx });
    input.setValue(s.history[idx] ?? '');
    scheduleRender();
  });

  // Ctrl+C
  let lastCtrlC = 0;
  let ctrlCArmedToExit = false;
  async function handleCtrlC() {
    const now = Date.now();
    const withinDouble = (now - lastCtrlC) < 1000;
    lastCtrlC = now;
    try {
      if (hasActiveAuggie && hasActiveAuggie()) {
        if (withinDouble) {
          cancelActiveAuggie({ force: true });
          addLog('{yellow-fg}Force-killed Auggie (SIGKILL).{/}');
        } else {
          cancelActiveAuggie({ force: false });
          addLog('{yellow-fg}Sent SIGINT to Auggie. Press Ctrl+C again quickly to force kill.{/}');
        }
        return;
      }
    } catch {}

    if (!ctrlCArmedToExit) {
      ctrlCArmedToExit = true;
      addLog('{yellow-fg}Press Ctrl+C again to close QLOOD-CLI.{/}');
      showToast('Press Ctrl+C again to quit', 'warn', 2200);
      scheduleRender();
      return;
    }
    teardown(0);
  }

  screen.key(['C-c'], handleCtrlC);
  process.on('SIGINT', handleCtrlC);

  // 'q' to quit directly
  screen.key(['q'], () => teardown(0));

  input.focus();
  scheduleRender();
}

