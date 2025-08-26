import fs from 'fs';
import path from 'path';
import { ensureProjectDirs, getProjectDir } from './project.js';
import { executeCustomPrompt, checkAuthentication } from './auggie-integration.js';
import { runProjectTest } from './test.js';
import { buildWorkflowPrompt } from './prompts/prompt.workflow.js';

// Import the getProjectContext function from the prompt file
function getProjectContext(cwd = process.cwd()) {
  const base = ensureProjectDirs(cwd);
  const contextPath = path.join(base, 'notes', 'context.md');
  const structurePath = path.join(base, 'project-structure.json');
  const configPath = path.join(base, 'qlood.json');
  
  let context = '';
  let structure = '';
  let config = '';
  
  try {
    if (fs.existsSync(contextPath)) {
      context = fs.readFileSync(contextPath, 'utf-8');
    }
  } catch (e) {
    // ignore
  }
  
  try {
    if (fs.existsSync(structurePath)) {
      structure = fs.readFileSync(structurePath, 'utf-8');
    }
  } catch (e) {
    // ignore
  }
  
  try {
    if (fs.existsSync(configPath)) {
      config = fs.readFileSync(configPath, 'utf-8');
    }
  } catch (e) {
    // ignore
  }
  
  return { context, structure, config };
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60) || 'workflow';
}

export function getWorkflowsDir(cwd = process.cwd()) {
  // Primary directory (plural)
  const base = ensureProjectDirs(cwd);
  const dir = path.join(base, 'workflows');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}


export function listWorkflows(cwd = process.cwd()) {
  const dir = getWorkflowsDir(cwd);
  const items = [];
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => /^(\d+)[-_].+\.md$/.test(f));
    for (const f of files) {
      const m = f.match(/^(\d+)[-_](.+)\.md$/);
      const id = Number(m[1]);
      const name = m[2].replace(/-/g, ' ');
      items.push({ id, file: f, name, dir });
    }
  }
  // Sort by id, then filename
  items.sort((a, b) => (a.id - b.id) || a.file.localeCompare(b.file));
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
  const file = `${id}_${name}.md`;
  const outDir = getWorkflowsDir(cwd);
  const outPath = path.join(outDir, file);

  // Compose a workflow-specific prompt oriented for Playwright with project context
  const prompt = buildWorkflowPrompt(description, cwd);

  const res = await executeCustomPrompt(prompt, { usePrintFormat: true });
  const content = (res.success ? res.stdout : '').trim();
  const final = content && content.length > 50 ? content : `# ${description}\n\n1. Open the app homepage.\n2. Describe the steps to accomplish: ${description}.\n3. Assert expected UI and network results.\n`;
  fs.writeFileSync(outPath, final);
  return { id, file, path: outPath };
}

export async function updateWorkflow(id, { cwd = process.cwd() } = {}) {
  const wf = listWorkflows(cwd).find(w => w.id === Number(id));
  if (!wf) throw new Error(`Workflow ${id} not found`);
  const p = path.join(wf.dir, wf.file);

  const auth = await checkAuthentication();
  if (!auth.success || !auth.authenticated) {
    throw new Error('Auggie authentication required. Run `auggie --login`.');
  }

  const prev = fs.readFileSync(p, 'utf-8');
  const { context, structure, config } = getProjectContext(cwd);
  
  const contextSection = context ? `\n=== Current Project Context ===\n${context}` : '';
  const structureSection = structure ? `\n=== Project Structure ===\n${structure}` : '';
  const configSection = config ? `\n=== Configuration ===\n${config}` : '';
  
  const prompt = `Update the following end-to-end testing workflow to reflect recent code changes in the project.

INSTRUCTIONS:
- Analyze the current codebase and project structure
- Update selectors, routes, and UI elements based on actual code
- Ensure steps are specific and actionable for Playwright
- Keep the same scenario but make it more detailed and accurate
- Include specific data-testid, button text, form fields, and navigation paths
- Maintain comprehensive Markdown format

Current Project Information:${contextSection}${structureSection}${configSection}

--- Existing Workflow to Update ---
${prev}`;
  
  const res = await executeCustomPrompt(prompt, { usePrintFormat: true });
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
  const p = path.join(wf.dir, wf.file);
  fs.rmSync(p, { force: true });
  return { file: wf.file };
}

function ensureResultsBase(cwd = process.cwd()) {
  const base = path.join(getProjectDir(cwd), 'results');
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

function copyIfExists(src, dest) {
  try { if (fs.existsSync(src)) fs.copyFileSync(src, dest); } catch {}
}



function readContains(p, substr) {
  try {
    if (!fs.existsSync(p)) return false;
    const txt = fs.readFileSync(p, 'utf8');
    return txt.includes(substr);
  } catch {
    return false;
  }
}


export async function runWorkflow(id, { headless, debug, onLog } = {}) {
  const cwd = process.cwd();
  const wf = listWorkflows(cwd).find(w => w.id === Number(id));
  if (!wf) throw new Error(`Workflow ${id} not found`);
  const p = path.join(wf.dir, wf.file);
  const scenario = fs.readFileSync(p, 'utf-8');

  const { dir, success, warning, error } = createResultStructure(id, cwd);

  // Delegate to project test runner; use our pre-created directory structure
  await runProjectTest(scenario, { headless, debug, onLog, artifactsDir: dir });

  // Use the controlled directory structure
  const runDir = dir;
  const latest = path.basename(dir);

  // Use audits.json to categorize result when available
  let category = 'success';
  if (runDir) {
    const auditsPath = path.join(runDir, 'audits.json');
    try {
      if (fs.existsSync(auditsPath)) {
        const audits = JSON.parse(fs.readFileSync(auditsPath, 'utf8'));
        category = audits.overall || 'success';
      }
    } catch {}
  }

  const targetFolder = category === 'success' ? success : category === 'warning' ? warning : error;

  // Copy artifacts into the categorized folder
  if (runDir) {
    // Copy logs
    copyIfExists(path.join(runDir, 'agent.log'), path.join(targetFolder, 'agent.log'));
    copyIfExists(path.join(runDir, 'browser.log'), path.join(targetFolder, 'browser.log'));
    copyIfExists(path.join(runDir, 'network.log'), path.join(targetFolder, 'network.log'));

    // Screenshots are now saved directly in each run directory, no need to copy from separate location
  }


  const report = `# Workflow ${id} Result\n\n- Workflow file: ${wf.file}\n- Run: ${latest || 'n/a'}\n- Category: ${category}\n- Artifacts: ./.qlood/results/${latest || ''}\n`;
  fs.writeFileSync(path.join(targetFolder, 'report.md'), report);

  return { resultDir: dir, category, runDir };
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
