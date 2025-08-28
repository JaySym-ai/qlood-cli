## QLOOD-CLI — Next‑Generation AI Testing Superpower

> Supercharge your website and app testing with next‑generation AI automation.
> QLOOD‑CLI is a preconfigured wrapper around the AugmentCode (Auggie) CLI that thinks like a user, tests like a pro, and catches what humans miss.

[AI] AI_SUPERPOWER — intelligent, context‑aware testing
[⚡] LIGHTNING_FAST — built for CI/CD and rapid iteration
[✓] BULLETPROOF — comprehensive analysis to keep your app production‑ready

---

### How it works (behind the scenes)
1. QLOOD‑CLI is pre‑prompted to run specific tests for your app
2. Orchestrates multiple Auggie CLI runs
3. Executes tasks with `auggie --print "Our prompt"`
4. Launches Playwright (non‑interactive) to test your app and capture screenshots
5. Auggie drafts results: Errors, Warnings, Success
6. Auggie analyzes your project and generates a fix prompt automatically

In short: a streamlined `auggie --print "Our prompt"` wrapper with pre‑made prompts that achieve your goal.

Learn more: https://www.augmentcode.com/

> Disclaimer: Using QLOOD‑CLI may require an AI provider API key and an AugmentCode.com account. Running the tool may use your real credits on connected services.

---

### Quick Start

- Install (global):

  ```bash
  npm install -g qlood-cli
  ```

- Launch the CLI:

  ```bash
  qlood
  ```

- Show all commands (inside the TUI):

  ```bash
  /help
  ```

- Create a workflow (auto‑analyzed and saved to `./.qlood/workflows`):

  ```bash
  /wfadd I need a workflow that test the user signup and login
  ```

- List workflows:

  ```bash
  /wfls
  ```

- Run workflow #1:

  ```bash
  /wf 1
  ```

- Run all workflows (great for PR checks):

  ```bash
  /wfall
  ```

- Update workflow #1 based on code changes:

  ```bash
  /wdupdate 1
  ```

- Delete workflow #1:

  ```bash
  /wfdel 1
  ```

Results are saved under `./.qlood/results/wf#-%datetime%/` with subfolders:
- `/success` — what passed
- `/warning` — potential issues (with screenshots) + `fix-prompt.md`
- `/error` — errors (with screenshots) + `fix-prompt.md`

What QLOOD tests (automatically):
- End‑to‑end, user‑like flows
- UI/UX checks and obvious anti‑patterns
- Console log auditing
- Network performance signals and failures
- Security/vulnerability scans (basic heuristics)
- Auth flow validation
- Dead link detection and navigation problems
- API key exposure hints and URL rewrite safety

---

### Requirements
- Node.js 18+
- Auggie CLI installed and authenticated: `auggie --login`

### Notes
- QLOOD initializes a project‑local `./.qlood/` folder and uses Auggie (via MCP Playwright) to drive a headless browser.
- You’ll be prompted to initialize on first run. Accepting allows Auggie to index your project for context‑aware testing.

### Security
- Prefer setting secrets via the TUI (e.g. `/key <apiKey>`) to avoid shell history capturing secrets.
- Credentials should be provided via environment variables or a gitignored `.env` file.

### Open Source
- Repo: https://github.com/JaySym-ai/qlood-cli

### License
MIT
