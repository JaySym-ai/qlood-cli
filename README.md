## qlood-cli

Open-source CLI to help you test your own app. qlood initializes a project-local `./.qlood/` folder, then uses AI-driven browser automation (Chromium via Puppeteer + OpenRouter LLMs) to explore and find bugs in your web app. Mobile emulators (Android/iOS) are on the roadmap.

- One-package install with bundled Chromium
- Project-local state in `./.qlood` (config, runs, screenshots, notes)
- AI-assisted testing flows; will open your app and drive interactions
- Low-level browser commands still available for power users

### Why qlood
- Fast local setup: `qlood` prompts to create `./.qlood` in your repo.
- Reproducible runs: artifacts saved under `./.qlood/runs/` and `./.qlood/screenshots/`.
- Adaptable: define your dev server URL and start command; the tool can launch it if needed.

### Install
- Prerequisites: Node.js 18+
- Local development:
  1) npm install
  2) npm link
  3) Set API key: export `OPENROUTER_API_KEY=...` (or use TUI `/key`)

- As a global package (when published):
  `npm i -g qlood-cli`

### Quick Start
- In your project root:
  - Run `qlood` — if not initialized, you’ll be prompted to create `./.qlood` and auto-detect sensible defaults
  - Edit `./.qlood/qlood.json` if needed (URL/start command/healthcheck)
  - Run `qlood test "Sign in and create a post"` — runs an AI-driven scenario against your app

### Usage
`qlood [command] [options]`

Core testing commands
- `test <scenario>`                   Run an AI-driven test scenario against your app

Global options
- `--headless`                        Run headless Chromium
- `--debug`                           Visible browser with slowMo for steps


Examples
- `qlood test "Create an account, log out, log back in" --debug`
- `qlood test "Try invalid passwords and report validation"`

Project config (`./.qlood/qlood.json`)
- `devServer.url`: Base URL of your app (e.g., `http://localhost:5173`)
- `devServer.start`: Command to start your dev server (e.g., `npm run dev`)
- `devServer.healthcheckPath`: Path to poll for readiness (default `/`)
- `devServer.waitTimeoutMs`: Max wait for server readiness (default `60000`)
- `devServer.waitIntervalMs`: Poll interval for readiness (default `1000`)
- `browser.headless`: Default headless mode for tests (default `false`)

Artifacts
- `./.qlood/runs/<timestamp>/agent.log` — AI agent logs for the run
- `./.qlood/runs/<timestamp>/browser.log` — page console and errors
- `./.qlood/runs/<timestamp>/network.log` — request/response summary
- `./.qlood/runs/<timestamp>/report.html` — minimal HTML report linking artifacts
- `./.qlood/screenshots/<timestamp>-initial.png` — before test
- `./.qlood/screenshots/<timestamp>-final.png` — after test
- `./.qlood/notes/` — free-form notes you keep

Interactive TUI
- `qlood` or `qlood tui`              Launches the TUI (prompts to init if needed)
- Slash commands: `/test <scenario>`, `/key <apiKey>`, `/open <url>`, `/goto <url>`, `/click <selector>`, `/type <selector> <text>`, `/tools`, `/quit`
- Free text: type natural language without `/` to drive the AI agent
- Ctrl+C: first press cancels current action, second within 1.5s exits

Low-level browser commands (optional)
- `open <url>`                        Open a new Chromium window to URL
- `goto <url>`                        Navigate current tab to URL
- `click <selector>`                  Click by CSS selector
- `type <selector> <text>`            Type into element by selector
- `screenshot [path]`                 Save screenshot (default `screenshot.png`)

### Environment
- `OPENROUTER_API_KEY`: your OpenRouter API key


Security note
- Prefer setting your API key via the TUI (`/key <apiKey>`) to avoid shell history capturing secrets.
- CLI alternative: `qlood config key <apiKey>` stores it in `~/.qlood/config.json` (never committed).

### Architecture
- `bin/qlood.js`: CLI entrypoint (Commander)
- `src/chrome.js`: Browser lifecycle and page helpers
- `src/commands.js`: Low-level page actions (open/goto/click/type)
- `src/agent.js`: AI agent loop powered by OpenRouter
- `src/project.js`: Project `./.qlood` folder and config helpers
- `src/test.js`: Project-level test runner that opens your app and runs scenarios
- `src/tui.js`: Interactive TUI for quick testing

### Roadmap
- Android/iOS emulator automation
- Richer assertions and reporting
- Auto-discovery of routes/actions; script recording
- Persistent user-data-dir profiles and cookies management

### Development
- Run: `node bin/qlood.js --help`
- Tests: TODO (set up Vitest/Jest)

### License
MIT