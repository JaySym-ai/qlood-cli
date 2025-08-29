import fs from 'fs';
import path from 'path';
import { theme } from './layout.js';
import { getState, setState } from './state.js';
import {
  setMainPrompt,
  setSystemInstructions,
  ensureProjectInit,
  loadProjectConfig,
  getProjectDir,
  ensureProjectDirs,
  extractCleanMarkdown,
  runAuggieStream,
  checkAuthentication,
  cancelActiveAuggie,
  hasActiveAuggie,
  addWorkflow,
  updateWorkflow,
  deleteWorkflow,
  listWorkflows,
  runWorkflow,
  buildRefactorPrompt,
  buildReviewPrompt,
  getReviewCategories,
  buildDuplicateFinderPrompt,
} from './adapters/auggie.js';

export function registerEvents({ ui, renderer }) {
  const { addLog, showToast, startStream, stopStream, normalizeChunk, streamLog, scheduleRender, renderStatus } = renderer;

  function startLoadingAnimation(message) {
    addLog(`{cyan-fg}⠋ ${message}{/}`);
  }
  function stopLoadingAnimation(finalMessage, isSuccess = true) {
    const color = isSuccess ? 'green-fg' : 'yellow-fg';
    const icon = isSuccess ? '✓' : '⚠';
    addLog(`{${color}}${icon} ${finalMessage}{/}`);
  }

  async function checkAuggieAuth() {
    try {
      const authResult = await checkAuthentication();
      return !!(authResult.success && authResult.authenticated);
    } catch (error) {
      addLog(`{red-fg}Error checking Auggie authentication:{/} ${error.message}`);
      return false;
    }
  }

  function showAuthError(action = 'use AI features') {
    addLog(`{red-fg}❌ Authentication required to ${action}.{/}`);
    addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
    showToast('Login required', 'error');
  }

  async function bootstrap() {
    addLog('{bold}Welcome to QLOOD-CLI{/}');
    startLoadingAnimation('Checking Auggie authentication...');
    const isAuggieAuthenticated = await checkAuggieAuth();
    stopLoadingAnimation('Authentication check complete', true);
    if (!isAuggieAuthenticated) {
      addLog('{red-fg}❌ Authentication required for AI features.{/}');
      addLog('Run {bold}auggie --login{/} to authenticate with Augment.');
      showToast('Login required', 'error');
      addLog('{yellow-fg}Note:{/} This is an alpha, open-source project.');
      addLog('Bugs and PRs welcome: https://github.com/JaySym-ai/qlood-cli');
    } else {
      addLog('Type {bold}/help{/} for available commands.');
      addLog('Tip: Commands must start with {bold}/{/}.');
      try {
        const wfDir = path.join(getProjectDir(process.cwd()), 'workflows');
        const hasWfs = fs.existsSync(wfDir) && fs.readdirSync(wfDir).some(f => /^(\d+)[-_].+\.md$/.test(f));
        if (hasWfs) addLog('Tip: Use {bold}/wfls{/} to list workflows.');
        else addLog('Tip: Create your first workflow using {bold}/wfadd <description>{/}.');
      } catch {}
      addLog('{yellow-fg}Note:{/} This is an alpha, open-source project.');
      addLog('Bugs and PRs welcome: https://github.com/JaySym-ai/qlood-cli');
    }

    if (isAuggieAuthenticated) {
      const projectCfg = loadProjectConfig(process.cwd());
      if (!projectCfg) {
        setState({ expectingInitConfirm: true });
        addLog('{yellow-fg}This project is not initialized for QLOOD-CLI.{/}');
        addLog('We can create ./.qlood and scan your project to set sensible defaults (URL, start command).');
        addLog('This will also allow the {cyan-fg}www.augmentcode.com{/} Auggie CLI tool to index your codebase for faster retrieval.');
        addLog('Initialize now? {bold}y{/}/n');
      }
    }
  }

  async function handleCommand(rawLine) {
    const s = getState();
    const cmd = (rawLine || '').trim();
    if (!cmd) return;

    // Expecting project init confirmation
    if (s.expectingInitConfirm) {
      const ans = cmd.toLowerCase();
      if (ans === 'y' || ans === 'yes') {
        await ensureProjectInit();
        loadProjectConfig(process.cwd());
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
        setState({ expectingInitConfirm: false });
        return;
      } else if (ans === 'n' || ans === 'no') {
        addLog('{red-fg}Initialization declined. Exiting QLOOD-CLI...{/}');
        showToast('Initialization declined', 'warn');
        // Exit is handled by keymap consumer
        throw new Error('__EXIT__');
      } else {
        addLog('Please answer with y or n.');
        return;
      }
    }

    // Commands
    if (cmd.startsWith('/prompt ')) {
      const p = cmd.replace('/prompt ', '').trim();
      if (!p) return addLog('Usage: /prompt <main prompt>');
      setMainPrompt(p);
      addLog('Main prompt updated');
      showToast('Main prompt updated', 'success');
      return;
    }
    if (cmd.startsWith('/instructions ')) {
      const i = cmd.replace('/instructions ', '').trim();
      if (!i) return addLog('Usage: /instructions <system instructions>');
      setSystemInstructions(i);
      addLog('System instructions updated');
      showToast('System instructions updated', 'success');
      return;
    }
    if (cmd.startsWith('/open ') || cmd.startsWith('/goto ') || cmd.startsWith('/click ') || cmd.startsWith('/type ')) {
      addLog('{yellow-fg}Low-level browser commands are removed. Use Auggie via `qlood agent`.{/}');
      return;
    }
    if (cmd.startsWith('/wfadd ')) {
      const desc = cmd.replace('/wfadd ', '').trim();
      if (!desc) return addLog('Usage: /wfadd <description>');
      const authResult = await checkAuthentication();
      if (!authResult.success || !authResult.authenticated) return showAuthError('create workflows');
      addLog('{cyan-fg}Starting: Create workflow...{/}');
      startStream();
      try {
        const streamHandlers = {
          onStdout: (chunk) => {
            setState({ lastStreamChunkAt: Date.now() });
            const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
            if (text.trim().length === 0) return;
            streamLog(text + "\n");
            scheduleRender();
          },
          onStderr: (chunk) => {
            setState({ lastStreamChunkAt: Date.now() });
            const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
            if (text.trim().length === 0) return;
            streamLog(`{yellow-fg}${text}{/}\n`);
            scheduleRender();
          },
        };
        const { id, file } = await addWorkflow(desc, { streamHandlers });
        stopStream();
        addLog(`{green-fg}✓ Completed:{/} Create workflow`);
        addLog(`Saved: ${file} (id: ${id})`);
      } catch (e) {
        stopStream();
        stopLoadingAnimation(`wfadd error: ${e?.message || e}`, false);
        addLog(`{red-fg}wfadd error:{/} ${e?.message || e}`);
      }
      return;
    }
    if (cmd.startsWith('/wfdel ')) {
      const id = Number(cmd.replace('/wfdel ', '').trim());
      if (!id) return addLog('Usage: /wfdel <id>');
      try {
        const { file } = deleteWorkflow(id);
        addLog(`{yellow-fg}Workflow deleted{/}: ${file}`);
      } catch (e) {
        addLog(`{red-fg}wfdel error:{/} ${e?.message || e}`);
      }
      return;
    }
    if (cmd.startsWith('/wfupdate ')) {
      const id = Number(cmd.replace('/wfupdate ', '').trim());
      if (!id) return addLog('Usage: /wfupdate <id>');
      const authResult = await checkAuthentication();
      if (!authResult.success || !authResult.authenticated) return showAuthError('update workflows');
      addLog('{cyan-fg}Starting: Update workflow...{/}');
      startStream();
      try {
        const streamHandlers = {
          onStdout: (chunk) => {
            setState({ lastStreamChunkAt: Date.now() });
            const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
            if (text.trim().length === 0) return;
            streamLog(text + "\n");
            scheduleRender();
          },
          onStderr: (chunk) => {
            setState({ lastStreamChunkAt: Date.now() });
            const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
            if (text.trim().length === 0) return;
            streamLog(`{yellow-fg}${text}{/}\n`);
            scheduleRender();
          },
        };
        const res = await updateWorkflow(id, { streamHandlers });
        stopStream();
        if (res.updated) addLog(`{green-fg}✓ Completed:{/} Update workflow`);
        else addLog(`{yellow-fg}No changes applied{/}`);
        addLog(`Saved: ${res.file}`);
      } catch (e) {
        stopStream();
        stopLoadingAnimation(`wfupdate error: ${e?.message || e}`, false);
        addLog(`{red-fg}wfupdate error:{/} ${e?.message || e}`);
      }
      return;
    }
    if (cmd === '/wfls') {
      const items = listWorkflows();
      if (!items.length) addLog('No workflows found. Use /wfadd to create one.');
      for (const it of items) addLog(`- ${it.id}: ${it.name} (${it.file})`);
      return;
    }
    if (cmd === '/wf') {
      const items = listWorkflows();
      if (!items.length) {
        addLog('{yellow-fg}No workflows found in ./.qlood/workflows.{/}');
        addLog('Create one with: {bold}/wfadd <short description>{/}');
        addLog('Example: {cyan-fg}/wfadd User signup and login{/}');
        addLog('{yellow-fg}Run functionality removed. Use `qlood agent` for goals.{/}');
        return;
      }
      addLog('Multiple workflows found. Use {bold}/wfls{/} to list.');
      return;
    }
    if (cmd.startsWith('/wf ')) {
      const idText = cmd.replace('/wf ', '').trim();
      const id = Number(idText);
      if (!id) { addLog('Usage: /wf <id>'); return; }
      const items = listWorkflows();
      if (!items.length) {
        addLog('{yellow-fg}No workflows found in ./.qlood/workflows.{/}');
        addLog('Create one with: {bold}/wfadd <short description>{/}');
        addLog('Example: {cyan-fg}/wfadd User signup and login{/}');
        return;
      }
      const authResult = await checkAuthentication();
      if (!authResult.success || !authResult.authenticated) return showAuthError('run workflows');
      addLog(`{cyan-fg}Starting: Run workflow ${id}...{/}`);
      startStream();
      try {
        const streamHandlers = {
          onStdout: (chunk) => {
            setState({ lastStreamChunkAt: Date.now() });
            const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
            if (text.trim().length === 0) return;
            streamLog(text + "\n");
            scheduleRender();
          },
          onStderr: (chunk) => {
            setState({ lastStreamChunkAt: Date.now() });
            const text = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, '');
            if (text.trim().length === 0) return;
            streamLog(`{yellow-fg}${text}{/}\n`);
            scheduleRender();
          },
        };
        const res = await runWorkflow(id, { streamHandlers });
        stopStream();
        if (res.success) {
          addLog(`{green-fg}✓ Completed:{/} Run workflow ${id}`);
          addLog(`Results: ${res.resultsDir}`);
          showToast('Workflow complete', 'success');
        } else {
          addLog(`{red-fg}✗ Failed:{/} Run workflow ${id}`);
          addLog(`Results: ${res.resultsDir}`);
          showToast('Workflow failed', 'error');
        }
      } catch (e) {
        stopStream();
        addLog(`{red-fg}wf error:{/} ${e?.message || e}`);
        showToast('Workflow error', 'error');
      }
      return;
    }
    if (cmd === '/clean') {
      try {
        const base = getProjectDir(process.cwd());
        const targets = ['debug', 'results'].map(d => path.join(base, d));
        let removed = 0;
        for (const dir of targets) {
          if (!fs.existsSync(dir)) continue;
          const entries = fs.readdirSync(dir);
          for (const name of entries) {
            const p = path.join(dir, name);
            try { fs.rmSync(p, { recursive: true, force: true }); removed++; }
            catch (e) { addLog(`{yellow-fg}Warning{/}: failed to remove ${path.relative(process.cwd(), p)} - ${e.message}`); }
          }
        }
        addLog(`{green-fg}Cleaned{/} ${removed} item(s) from {bold}.qlood/debug{/} and {bold}.qlood/results{/}.`);
        showToast('Workspace cleaned', 'success');
      } catch (e) {
        addLog(`{red-fg}clean error:{/} ${e?.message || e}`);
        showToast('Clean failed', 'error');
      }
      return;
    }
    if (cmd === '/help') {
      addLog('{yellow-fg}We now have many commands; they are organized in our docs:{/}');
      addLog('  https://qlood.com/docs');
      addLog("Don't be afraid to click the link!");
      addLog('  - Avoid passing secrets on the command line; typed text is masked in logs.');
      return;
    }
    if (cmd === '/auggie-login' || cmd === '/login') {
      addLog('{cyan-fg}To authenticate with Auggie:{/}');
      addLog('1. Open a new terminal window');
      addLog('2. Run: {bold}auggie --login{/}');
      addLog('3. Follow the authentication prompts');
      addLog('4. Once authenticated, restart QLOOD-CLI to use AI features');
      addLog('');
      addLog('If Auggie is not installed, run: {bold}qlood auggie-check{/}');
      addLog('');
      return;
    }
    if (cmd === '/review') {
      const authResult = await checkAuthentication();
      if (!authResult.success || !authResult.authenticated) return showAuthError('run reviews');
      const cwd = process.cwd();
      try {
        const categories = getReviewCategories();
        if (!categories || !categories.length) { addLog('{red-fg}No review categories available.{/}'); return; }
        addLog('{cyan-fg}Starting: Full review...{/}');
        startStream();
        const saved = [];
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const baseDir = path.join(getProjectDir(cwd), 'results', `review-${ts}`);
        fs.mkdirSync(baseDir, { recursive: true });
        for (const cat of categories) {
          addLog(`{cyan-fg}Category: ${cat.title}{/}`);
          ensureProjectDirs(cwd);
          const catDir = path.join(baseDir, cat.key);
          fs.mkdirSync(catDir, { recursive: true });
          const prompt = buildReviewPrompt(cat.title, cat.checklist);
          const handlers = {
            onStdout: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(t + '\n'); scheduleRender(); },
            onStderr: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(`{yellow-fg}${t}{/}\n`); scheduleRender(); },
          };
          const { success, stdout } = await runAuggieStream(prompt, { cwd }, handlers);
          let content = success ? extractCleanMarkdown(stdout) : `# ${cat.title} Review\n\n❌ Failed to run analysis.\n\nUnknown error`;
          if (!content || content.trim().length < 20) content = (stdout || content || '');
          const outPath = path.join(catDir, 'review.md');
          fs.writeFileSync(outPath, content, 'utf-8');
          const rel = path.relative(cwd, outPath);
          addLog(`{green-fg}✓ Completed:{/} ${cat.title}`);
          addLog(`Saved: ${rel}`);
          saved.push({ title: cat.title, path: rel });
        }
        stopStream();
        addLog('');
        addLog('{bold}All reviews saved:{/}');
        for (const s of saved) addLog(`- ${s.title}: ${s.path}`);
        showToast('Reviews complete', 'success');
      } catch (e) {
        stopStream();
        addLog(`{red-fg}review error:{/} ${e?.message || e}`);
        showToast('Review failed', 'error');
      }
      return;
    }
    if (cmd === '/reviewrepo' || cmd === '/reviewapp' || cmd === '/reviewbuild') {
      const authResult = await checkAuthentication();
      if (!authResult.success || !authResult.authenticated) return showAuthError('run reviews');
      const key = cmd === '/reviewrepo' ? 'repository-supply-chain' : (cmd === '/reviewapp' ? 'application-code-config' : 'build-ci-iac');
      const cat = getReviewCategories().find(c => c.key === key);
      if (!cat) { addLog('{red-fg}Unknown review category.{/}'); return; }
      addLog(`{cyan-fg}Starting: ${cat.title}...{/}`);
      startStream();
      const cwd = process.cwd();
      try {
        ensureProjectDirs(cwd);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const baseDir = path.join(getProjectDir(cwd), 'results', `review-${ts}`);
        fs.mkdirSync(baseDir, { recursive: true });
        const catDir = path.join(baseDir, cat.key);
        fs.mkdirSync(catDir, { recursive: true });
        const prompt = buildReviewPrompt(cat.title, cat.checklist);
        const handlers = {
          onStdout: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(t + '\n'); scheduleRender(); },
          onStderr: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(`{yellow-fg}${t}{/}\n`); scheduleRender(); },
        };
        const { success, stdout } = await runAuggieStream(prompt, { cwd }, handlers);
        let content = success ? extractCleanMarkdown(stdout) : `# ${cat.title} Review\n\n❌ Failed to run analysis.\n\nUnknown error`;
        if (!content || content.trim().length < 20) content = (stdout || content || '');
        const outPath = path.join(catDir, 'review.md');
        fs.writeFileSync(outPath, content, 'utf-8');
        const rel = path.relative(cwd, outPath);
        stopStream();
        addLog(`{green-fg}✓ Completed:{/} ${cat.title}`);
        addLog(`Saved: ${rel}`);
        showToast(`${cat.title} review complete`, 'success');
      } catch (e) {
        stopStream();
        addLog(`{red-fg}review error:{/} ${e?.message || e}`);
        showToast('Review failed', 'error');
      }
      return;
    }
    if (cmd === '/refactor') {
      const authResult = await checkAuthentication();
      if (!authResult.success || !authResult.authenticated) return showAuthError('run refactor analysis');
      addLog('{cyan-fg}Starting: Refactor analysis...{/}');
      startStream();
      const cwd = process.cwd();
      try {
        ensureProjectDirs(cwd);
        const prompt = buildRefactorPrompt();
        const handlers = {
          onStdout: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(t + '\n'); scheduleRender(); },
          onStderr: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(`{yellow-fg}${t}{/}\n`); scheduleRender(); },
        };
        const { success, stdout } = await runAuggieStream(prompt, { cwd }, handlers);
        let content = success ? extractCleanMarkdown(stdout) : '';
        if (!content || content.trim().length < 50) content = (stdout || '# Refactor Plan\n\nNo results.');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const baseDir = path.join(getProjectDir(cwd), 'results', `refactor-${ts}`);
        fs.mkdirSync(baseDir, { recursive: true });
        const outPath = path.join(baseDir, 'refactor.md');
        fs.writeFileSync(outPath, content, 'utf-8');
        stopStream();
        addLog(`{green-fg}✓ Completed:{/} Refactor analysis`);
        addLog(`Saved: ${path.relative(cwd, outPath)}`);
        showToast('Refactor plan saved', 'success');
      } catch (e) {
        stopStream();
        addLog(`{red-fg}refactor error:{/} ${e?.message || e}`);
        showToast('Refactor failed', 'error');
      }
      return;
    }
    if (cmd === '/duplicatefinder') {
      const authResult = await checkAuthentication();
      if (!authResult.success || !authResult.authenticated) return showAuthError('run duplicate finder');
      addLog('{cyan-fg}Starting: Duplicate & dead code analysis...{/}');
      startStream();
      const cwd = process.cwd();
      try {
        ensureProjectDirs(cwd);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const baseDir = path.join(getProjectDir(cwd), 'results', `duplicate_review_${ts}`);
        fs.mkdirSync(baseDir, { recursive: true });
        const prompt = buildDuplicateFinderPrompt();
        const handlers = {
          onStdout: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(t + '\n'); scheduleRender(); },
          onStderr: (chunk) => { const t = normalizeChunk(chunk).replace(/\x1b\[[0-9;]*m/g, ''); if (t.trim()) streamLog(`{yellow-fg}${t}{/}\n`); scheduleRender(); },
        };
        const { success, stdout, cleaned } = await runAuggieStream(prompt, { cwd }, handlers);
        let content = success ? (cleaned || '') : '';
        if (!content || content.trim().length < 50) content = (stdout || '# Duplicate & Dead Code Report\n\nNo results.');
        const outPath = path.join(baseDir, 'duplicate_review.md');
        fs.writeFileSync(outPath, content, 'utf-8');
        stopStream();
        addLog(`{green-fg}✓ Completed:{/} Duplicate & dead code analysis`);
        addLog(`Saved: ${path.relative(cwd, outPath)}`);
        showToast('Duplicate review saved', 'success');
      } catch (e) {
        stopStream();
        addLog(`{red-fg}duplicatefinder error:{/} ${e?.message || e}`);
        showToast('Duplicate finder failed', 'error');
      }
      return;
    }
    if (cmd === '/quit') {
      throw new Error('__EXIT__');
    }

    // Default: show help
    addLog('{yellow-fg}Commands must start with {/}{bold}/{/}{yellow-fg}. Showing help...{/}');
    await handleCommand('/help');
  }

  return { bootstrap, handleCommand };
}
