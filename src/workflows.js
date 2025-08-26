import fs from 'fs';
import path from 'path';
import { ensureProjectDirs, getProjectDir } from './project.js';
import { executeCustomPrompt, checkAuthentication } from './auggie-integration.js';
import { runProjectTest } from './test.js';

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60) || 'workflow';
}

export function getWorkflowsDir(cwd = process.cwd()) {
  const base = ensureProjectDirs(cwd);
  const dir = path.join(base, 'workflows');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listWorkflows(cwd = process.cwd()) {
  const dir = getWorkflowsDir(cwd);
  const files = fs.readdirSync(dir).filter(f => /^(\d+)-.+\.md$/.test(f));
  const items = files.map(f => {
    const m = f.match(/^(\d+)-(.+)\.md$/);
    return { id: Number(m[1]), file: f, name: m[2].replace(/-/g, ' ') };
  }).sort((a, b) => a.id - b.id);
  return items;
}

function nextWorkflowId(cwd = process.cwd()) {
  const items = listWorkflows(cwd);
  const max = items.reduce((acc, it) => Math.max(acc, it.id), 0);
  return max + 1;
}

export async function addWorkflow(description, { cwd = process.cwd() } = {}) {
  if (!description || !description.trim()) throw new Error('Description required');
  // Require Auggie auth
  const auth = await checkAuthentication();
  if (!auth.success || !auth.authenticated) {
    throw new Error('Auggie authentication required. Run `auggie --login`.');
  }

  const id = nextWorkflowId(cwd);
  const name = slugify(description);
  const file = `${id}-${name}.md`;
  const outPath = path.join(getWorkflowsDir(cwd), file);

  const prompt = `You are generating an end-to-end web testing workflow for Qlood.
Project context: The assistant will use a headless browser to execute steps.
Task: Create a clear, step-by-step test plan to accomplish: "${description}".
Guidelines:
- Use concise Markdown with numbered steps and clear assertions.
- Include preconditions if needed and expected results where useful.
- Prefer user-visible actions (clicks, typing, navigation).
- Avoid environment-specific values when possible.
- Title with a concise H1.
Output: Markdown only.`;

  const res = await executeCustomPrompt(prompt, { usePrintFormat: true, timeout: 120000 });
  const content = (res.success ? res.stdout : '').trim();
  const final = content && content.length > 50 ? content : `# ${description}\n\n1. Open the app homepage.\n2. Describe the steps to accomplish: ${description}.\n3. Assert expected UI and network results.\n`;
  fs.writeFileSync(outPath, final);
  return { id, file, path: outPath };
}

export async function updateWorkflow(id, { cwd = process.cwd() } = {}) {
  const wf = listWorkflows(cwd).find(w => w.id === Number(id));
  if (!wf) throw new Error(`Workflow ${id} not found`);
  const p = path.join(getWorkflowsDir(cwd), wf.file);

  const auth = await checkAuthentication();
  if (!auth.success || !auth.authenticated) {
    throw new Error('Auggie authentication required. Run `auggie --login`.');
  }

  const prev = fs.readFileSync(p, 'utf-8');
  const prompt = `Update the following end-to-end testing workflow to reflect recent code changes in the project. Keep steps concise and actionable. Maintain Markdown format.\n\n--- Existing Workflow ---\n\n${prev}`;
  const res = await executeCustomPrompt(prompt, { usePrintFormat: true, timeout: 120000 });
  const next = (res.success ? res.stdout : '').trim();
  if (next && next.length > 20) {
    fs.writeFileSync(p, next);
    return { file: wf.file, updated: true };
  }
  return { file: wf.file, updated: false };
}

export function deleteWorkflow(id, { cwd = process.cwd() } = {}) {
  const wf = listWorkflows(cwd).find(w => w.id === Number(id));
  if (!wf) throw new Error(`Workflow ${id} not found`);
  const p = path.join(getWorkflowsDir(cwd), wf.file);
  fs.rmSync(p, { force: true });
  return { file: wf.file };
}

function ensureResultsBase(cwd = process.cwd()) {
  const base = path.join(getProjectDir(cwd), 'result');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return base;
}

function createResultStructure(wfId, cwd = process.cwd()) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = ensureResultsBase(cwd);
  const dir = path.join(base, `wf${wfId}-${ts}`);
  const success = path.join(dir, 'success');
  const warning = path.join(dir, 'warning');
  const error = path.join(dir, 'error');
  fs.mkdirSync(success, { recursive: true });
  fs.mkdirSync(warning, { recursive: true });
  fs.mkdirSync(error, { recursive: true });
  const fix = `# Fix Prompt\n\nDescribe the problem and desired fix. Paste this into Auggie or the AugmentCode extension.\n`;
  fs.writeFileSync(path.join(warning, 'fix-prompt.md'), fix);
  fs.writeFileSync(path.join(error, 'fix-prompt.md'), fix);
  return { dir, success, warning, error };
}

export async function runWorkflow(id, { headless, debug, onLog } = {}) {
  const cwd = process.cwd();
  const wf = listWorkflows(cwd).find(w => w.id === Number(id));
  if (!wf) throw new Error(`Workflow ${id} not found`);
  const p = path.join(getWorkflowsDir(cwd), wf.file);
  const scenario = fs.readFileSync(p, 'utf-8');

  const { dir, success } = createResultStructure(id, cwd);
  // Delegate to project test runner; it will create artifacts under ./.qlood/runs/<ts>
  await runProjectTest(scenario, { headless, debug, onLog });

  // Save a minimal success report referencing artifacts
  const report = `# Workflow ${id} Result\n\n- Workflow file: ${wf.file}\n- Timestamp dir: ${path.basename(dir)}\n- See ./.qlood/runs for detailed artifacts.\n`;
  fs.writeFileSync(path.join(success, 'report.md'), report);
  return { resultDir: dir };
}

export async function runAllWorkflows({ headless, debug, onLog } = {}) {
  const items = listWorkflows(process.cwd());
  const results = [];
  for (const it of items) {
    if (onLog) onLog(`Running workflow ${it.id} - ${it.name}`);
    const r = await runWorkflow(it.id, { headless, debug, onLog });
    results.push({ id: it.id, dir: r.resultDir });
  }
  return results;
}
