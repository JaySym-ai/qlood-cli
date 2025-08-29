import { debugLogger } from './debug.js';
import { createScreen, createLayout } from './tui/layout.js';
import { createRenderer } from './tui/render.js';
import { registerEvents } from './tui/events.js';
import { registerKeymap } from './tui/keymap.js';

export async function runTui() {
  // Enable debug logging for session
  debugLogger.autoEnable(process.cwd());

  // Require interactive terminal
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Error: QLOOD-CLI requires an interactive terminal (TTY).');
    console.error('Tip: Run in a real terminal, or use subcommands like "qlood test ..." or "qlood agent ..." in non-interactive environments.');
    process.exit(1);
  }

  // Build UI
  const screen = createScreen();
  const ui = createLayout(screen);
  const renderer = createRenderer(screen, ui);
  const detachStatus = renderer.attachStatusUpdates();

  function teardownAndExit(code = 0) {
    try { detachStatus && detachStatus(); } catch {}
    try { screen.destroy(); } catch {}
    process.exit(code);
  }

  // Events and input handling
  const events = registerEvents({ ui, renderer });
  registerKeymap({ screen, input: ui.input, renderer, events, teardown: teardownAndExit });

  // Kick off
  await events.bootstrap();
}

