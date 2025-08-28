import fs from 'fs';
import path from 'path';
import { ensureProjectDirs, getProjectDir, loadProjectConfig } from './project.js';
import { executeCustomPrompt, executeCustomPromptStream, checkAuthentication } from './auggie-integration.js';
import { debugLogger } from './debug.js';

import { buildWorkflowPrompt } from './prompts/prompt.workflow.js';
// Safeguards to prevent E2BIG when building /wfupdate prompt
const MAX_WFUP_CONTEXT = Number(process.env.QLOOD_MAX_WFUP_CONTEXT || process.env.QLOOD_MAX_WF_CONTEXT || 8000);
const MAX_WFUP_STRUCTURE = Number(process.env.QLOOD_MAX_WFUP_STRUCTURE || process.env.QLOOD_MAX_WF_STRUCTURE || 8000);
const MAX_WFUP_CONFIG = Number(process.env.QLOOD_MAX_WFUP_CONFIG || process.env.QLOOD_MAX_WF_CONFIG || 4000);
const MAX_WFUP_PREV = Number(process.env.QLOOD_MAX_WFUP_PREV || 12000);

function truncateSection(text = '', limit = 20000, label = 'section') {
  const str = String(text || '');
  if (str.length <= limit) return str;
  const truncated = str.slice(0, limit);
  const omitted = str.length - limit;
  try { debugLogger.writeDebug && debugLogger.writeDebug('TRUNCATE', { label, originalLength: str.length, limit, omitted }); } catch {}
  return `${truncated}\n\n...[truncated ${omitted} chars from ${label}]`;
}


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

export async function addWorkflow(description, { cwd = process.cwd(), streamHandlers = null } = {}) {
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

  // Compose workflow prompt and instruct Auggie to write the file itself
  const basePrompt = buildWorkflowPrompt(description, cwd);
  const relOutPath = path.relative(cwd, outPath);
  const writeInstruction = `\n\nACTION:\n- Write the full Markdown workflow to \"${relOutPath}\" (overwrite if it exists)\n- Use UTF-8 encoding\n- Do not ask for confirmation`;
  const prompt = `${basePrompt}${writeInstruction}`;

  if (streamHandlers) {
    await executeCustomPromptStream(prompt, { usePrintFormat: false, pty: true }, streamHandlers);
  } else {
    await executeCustomPrompt(prompt, { usePrintFormat: true });
  }

  // Verify file was created by Auggie; minimal fallback if not
  if (!fs.existsSync(outPath)) {
    const fallback = `# ${description}\n\n1. Open the app homepage.\n2. Describe the steps to accomplish: ${description}.\n3. Assert expected UI and network results.\n`;
    try { fs.writeFileSync(outPath, fallback); } catch {}
  }
  return { id, file, path: outPath };
}

export async function updateWorkflow(id, { cwd = process.cwd(), streamHandlers = null } = {}) {
  const wf = listWorkflows(cwd).find(w => w.id === Number(id));
  if (!wf) throw new Error(`Workflow ${id} not found`);
  const p = path.join(wf.dir, wf.file);

  const auth = await checkAuthentication();
  if (!auth.success || !auth.authenticated) {
    throw new Error('Auggie authentication required. Run `auggie --login`.');
  }

  // Read and truncate previous workflow and project context to avoid E2BIG
  const prevRaw = fs.readFileSync(p, 'utf-8');
  const prev = truncateSection(prevRaw, MAX_WFUP_PREV, 'existing-workflow');
  let { context, structure, config } = getProjectContext(cwd);
  context = truncateSection(context, MAX_WFUP_CONTEXT, 'context');
  structure = truncateSection(structure, MAX_WFUP_STRUCTURE, 'structure');
  config = truncateSection(config, MAX_WFUP_CONFIG, 'config');

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

  const relPath = path.relative(cwd, p);
  const writeInstruction = `\n\nACTION:\n- Write the updated Markdown workflow to \"${relPath}\" (overwrite)\n- Use UTF-8 encoding\n- Do not ask for confirmation`;
  const finalPrompt = `${prompt}${writeInstruction}`;

  let stdout = '';
  if (streamHandlers) {
    const res = await executeCustomPromptStream(finalPrompt, { usePrintFormat: false, pty: true }, {
      onStdout: (chunk) => { stdout += chunk; try { streamHandlers.onStdout?.(chunk); } catch {} },
      onStderr: (chunk) => { try { streamHandlers.onStderr?.(chunk); } catch {} }
    });
    const next = extractCleanMarkdown((res.success ? (res.stdout || stdout) : '').trim());
    if (next && next.length > 20) {
      fs.writeFileSync(p, next);
      return { file: wf.file, updated: true };
    }
    return { file: wf.file, updated: false };
  } else {
    const res = await executeCustomPrompt(finalPrompt, { usePrintFormat: true });
    const next = extractCleanMarkdown((res.success ? res.stdout : '').trim());
    if (next && next.length > 20) {
      fs.writeFileSync(p, next);
      return { file: wf.file, updated: true };
    }
    return { file: wf.file, updated: false };
  }
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
  const ts = new Date().toISOString().replace(/[:.]/g, '-') ;
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


export async function runWorkflow(id, { cwd = process.cwd(), streamHandlers = null } = {}) {
  const wf = listWorkflows(cwd).find(w => w.id === Number(id));
  if (!wf) throw new Error(`Workflow ${id} not found`);
  const wfPath = path.join(wf.dir, wf.file);

  const auth = await checkAuthentication();
  if (!auth.success || !auth.authenticated) {
    throw new Error('Auggie authentication required. Run `auggie --login`.');
  }

  // Prepare result directory structure for this run
  const results = createResultStructure(wf.id, cwd);
  const relResultsDir = path.relative(cwd, results.dir);
  const relWfPath = path.relative(cwd, wfPath);

  // Build an execution prompt for Auggie using MCP Playwright
  const cfg = loadProjectConfig(cwd) || {};
  const baseUrl = cfg?.devServer?.url || '';
  const guidance = `You are an automated QA agent with access to the Playwright MCP server.
Goal: Execute the end-to-end testing workflow described in the Markdown file at "${relWfPath}".

Instructions:
- Read the workflow steps and follow them precisely with Playwright.
- Use headless browser.
- If a base URL is needed, use: ${baseUrl || '(no base URL provided; infer from the workflow)'}
- Stream concise progress logs to stdout in near real-time (flush frequently). Use the following markers on their own lines to structure output:
  - 📋 Step: <short step title>
  - 🔧 Action: <what you are doing>
  - ✅/⚠️/❌ Result: <brief result>
  - ---- as a boundary between steps
- Keep lines short; avoid ANSI color codes.
- Save a final Markdown run report to "${relResultsDir}/success/report.md" describing what was done and key outcomes.
- If you encounter issues, still write a report and clearly mark failures; you may also write additional notes to "${relResultsDir}/warning/report.md".
- Do not ask for confirmation. Execute autonomously.`;

  // Stream execution so TUI can show live logs
  if (streamHandlers) {
    const res = await executeCustomPromptStream(guidance, { usePrintFormat: false, pty: true, cwd }, streamHandlers);
    return { success: !!res.success, resultsDir: results.dir };
  } else {
    const res = await executeCustomPrompt(guidance, { usePrintFormat: true, cwd });
    return { success: !!res.success, resultsDir: results.dir };
  }
}

// Removed runWorkflow and runAllWorkflows: local Playwright runner deprecated.
