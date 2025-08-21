## qlood-cli

An all-in-one Node.js CLI to automate Google Chrome via the Chrome DevTools Protocol (CDP) and drive actions with an LLM using OpenRouter models.

- One-package install with bundled Chromium via Puppeteer
- High-level tools: open pages, navigate, click, type, tabs, clipboard, screenshots, and debug
- Direct CDP access available when needed
- Optional LLM agent mode to plan actions

### Why this approach
- Puppeteer bundles a compatible Chromium on install and speaks CDP natively, giving a reliable, single-package experience across platforms.
- We still expose low-level CDP when you need advanced control (via page.target().createCDPSession()).
- OpenRouter gives a single API for many top models; users provide OPENROUTER_API_KEY.

### Install
- Prerequisites: Node.js 18+
- Local development:
  1) In this repo run: npm install
  2) Link the CLI: npm link
  3) Set API key: export OPENROUTER_API_KEY=... (or use a .env file)

- As a global package (later, when published):
  npm i -g qlood-cli

### Usage
qlood [command] [options]

Core commands
- open <url>                         Open a new Chromium window and navigate to URL
- goto <url>                         Navigate current tab to URL
- click <selector>                   Click element matching CSS selector
- type <selector> <text>             Type text into element matching selector
- tabs new                           Open new tab
- tabs list                          List tabs
- tabs switch <index>                Switch to tab by index (0-based)
- screenshot [path]                  Save screenshot (default: screenshot.png)
- clipboard copy <text>              Copy text to OS clipboard
- clipboard paste                    Print text from OS clipboard
- agent <goal>                       Run an LLM-driven loop to achieve a goal (experimental)

Global options
- --headless                         Run headless (default true in CI; false if you pass --debug)
- --debug                            Open Chrome with devtools, slowMo for visible steps
- --model <id>                       OpenRouter model for agent (default: moonshotai/kimi-k2)

Examples
- qlood open https://news.ycombinator.com --debug
- qlood click 'a.storylink'
- qlood type 'input[name=q]' 'puppeteer cdp'
- qlood tabs new && qlood goto https://example.com
- qlood screenshot ./hn.png
- qlood agent "Find the latest post about CDP on HN and open it"

Config commands
- qlood config model <id>            Persist default model (also usable via TUI /model)
- qlood config key <apiKey>          Persist OpenRouter API key (also usable via TUI /key)

TUI (Text UI)
- `qlood`                            Launches the TUI by default (no arguments)
- `qlood tui`                        Explicitly launch the interactive interface
- Slash commands: `/model <id>`, `/key <apiKey>`, `/open <url>`, `/goto <url>`, `/click <selector>`, `/type <selector> <text>`, `/quit`
- Free text: type natural language without `/` to invoke the AI agent which will use tools to act on the browser.
- Agent tools: `goto(url)`, `click(selector)`, `type(selector,text)`, `screenshot(path?)`, `scroll(y)`, `done(result)`
- Ctrl+C: first press cancels the current action (closes browser), second within 1.5s exits
- Built with blessed for a richer interactive experience than raw CLI

### Environment
- OPENROUTER_API_KEY: your OpenRouter API key

Security note
- Prefer setting your API key via the TUI (/key <apiKey>) to avoid shell history capturing secrets.
- If using CLI: qlood config key <apiKey> will store it in ~/.qlood/config.json (never committed).
- Alternatively, set an environment variable OPENROUTER_API_KEY before running.

- Optional: QLOOD_DEFAULT_MODEL (e.g., anthropic/claude-3.5-sonnet)

### Architecture
- bin/qlood.js: CLI entrypoint (Commander)
- src/chrome.js: Launch/connect browser, manage pages/tabs, shared helpers
- src/commands.js: Command implementations for open/goto/click/type/etc.
- src/agent.js: Minimal agent loop powered by OpenRouter, calling CLI tools programmatically

### CDP Access
If you need raw CDP:
- const client = await page.target().createCDPSession();
- await client.send('Network.enable');
- await client.send('Runtime.evaluate', { expression: '...' });

### Roadmap
- Add robust element finding (text-based, role-based), retries, and fallbacks
- Recording and script generation
- Persistent user-data-dir profiles and cookies management
- File upload/download helpers
- Playwright adapter (optional) if needed later

### Development
- Run: node bin/qlood.js --help
- Tests: TODO (set up Vitest/Jest)

### License
MIT
