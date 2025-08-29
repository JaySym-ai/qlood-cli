import blessed from 'blessed';

export const theme = {
  bg: 'black',
  fg: 'white',
  dim: 'gray',
  accent: 'cyan',
  accentAlt: 'magenta',
  success: 'green',
  warn: 'yellow',
  error: 'red',
};

export function createScreen() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'QLOOD-CLI',
    fullUnicode: true,
    dockBorders: true,
  });
  return screen;
}

export function createLayout(screen) {
  const log = blessed.log({
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-4',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollOnInput: true,
    scrollbar: { ch: ' ', track: { bg: theme.bg }, style: { bg: theme.accent } },
    keys: true,
    mouse: true,
    tags: true,
    label: ' QLOOD-CLI ',
    shadow: true,
    padding: { left: 1, right: 1 },
    style: { fg: theme.fg, bg: theme.bg, border: { fg: theme.dim }, label: { fg: theme.accent } },
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
    height: 3,
    width: '100%',
    inputOnFocus: true,
    keys: true,
    border: { type: 'line' },
    style: { fg: theme.fg, bg: theme.bg, border: { fg: theme.dim } },
    name: 'input',
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    shadow: true,
    scrollable: false,
    wrap: false,
  });

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

  screen.append(log);
  screen.append(statusBar);
  screen.append(input);
  screen.append(backdrop);

  return { log, statusBar, input, backdrop };
}

