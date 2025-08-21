import blessed from 'blessed';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, setModel, setApiKey, getApiKey, getModel } from './config.js';
import { openCmd, gotoCmd, clickCmd, typeCmd } from './commands.js';
import { withPage, createChrome } from './chrome.js';

export async function runTui() {
  await createChrome({ headless: false, debug: true });

  const screen = blessed.screen({ smartCSR: true, title: 'qlood TUI' });

  const log = blessed.log({
    top: 0,
    left: 0,
    width: '100%',
    height: '90%',
    border: 'line',
    tags: true,
    scrollable: true,
    keys: true,
    mouse: true
  });

  const input = blessed.textbox({
    bottom: 0,
    left: 0,
    height: '10%',
    width: '100%',
    inputOnFocus: true,
    border: 'line'
  });

  screen.append(log);
  screen.append(input);

  log.log('{bold}Welcome to qlood TUI{/bold}');
  const cfg = loadConfig();
  log.log(`Model: ${getModel()}`);

  // Prompt for API key if missing
  let apiKey = getApiKey();
  if (!apiKey) {
    const rl = readline.createInterface({ input, output });
    const entered = await rl.question('Enter your OpenRouter API key: ');
    rl.close();
    if (entered) { setApiKey(entered.trim()); apiKey = entered.trim(); log.log('API key saved'); }
    else { log.log('No API key provided; some features will prompt again.'); }
  }

  input.focus();

  async function handle(line) {
    const cmd = line.trim();
    if (!cmd) return;

    if (cmd.startsWith('/model ')) {
      const m = cmd.replace('/model ', '').trim();
      setModel(m);
      log.log(`Model set to ${m}`);
    } else if (cmd.startsWith('/key ')) {
      const k = cmd.replace('/key ', '').trim();
      setApiKey(k);
      log.log('API key updated');
    } else if (cmd.startsWith('/open ')) {
      const url = cmd.replace('/open ', '').trim();
      await openCmd(url, { debug: true });
      log.log(`Opened ${url}`);
    } else if (cmd.startsWith('/goto ')) {
      const url = cmd.replace('/goto ', '').trim();
      await withPage((page) => gotoCmd(page, url));
      log.log(`Goto ${url}`);
    } else if (cmd.startsWith('/click ')) {
      const sel = cmd.replace('/click ', '').trim();
      await withPage((page) => clickCmd(page, sel));
      log.log(`Clicked ${sel}`);
    } else if (cmd.startsWith('/type ')) {
      const rest = cmd.replace('/type ', '');
      const space = rest.indexOf(' ');
      if (space === -1) return log.log('Usage: /type <selector> <text>');
      const sel = rest.slice(0, space);
      const text = rest.slice(space + 1);
      await withPage((page) => typeCmd(page, sel, text));
      log.log(`Typed into ${sel}`);
    } else if (cmd === '/help') {
      log.log('Commands: /model <id>, /key <apiKey>, /open <url>, /goto <url>, /click <selector>, /type <selector> <text>');
    } else if (cmd === '/quit') {
      return process.exit(0);
    } else {
      log.log('Unknown command. Try /help');
    }
  }

  input.key('enter', async () => {
    input.readInput((err, value) => {
      const line = value || input.getValue();
      input.clearValue();
      screen.render();
      handle(line).catch((e) => log.log(`Error: ${e.message}`));
    });
  });

  screen.key(['C-c', 'q'], () => process.exit(0));

  screen.render();
}

