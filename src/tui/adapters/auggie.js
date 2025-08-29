// Thin adapter layer to isolate direct imports used by the TUI.
// Allows easier mocking and future replacement.

import { setMainPrompt, setSystemInstructions } from '../../config.js';
import { ensureProjectInit, loadProjectConfig, getProjectDir, ensureProjectDirs, extractCleanMarkdown } from '../../project.js';
import { runAuggieStream } from '../../auggie-stream.js';
import { checkAuthentication, executeCustomPromptStream, cancelActiveAuggie, hasActiveAuggie } from '../../auggie-integration.js';
import { addWorkflow, updateWorkflow, deleteWorkflow, listWorkflows, runWorkflow } from '../../workflows.js';
import { buildRefactorPrompt } from '../../prompts/prompt.refactor.js';
import { buildReviewPrompt } from '../../prompts/prompt.review.js';
import { getReviewCategories } from '../../commands/review.js';

export {
  setMainPrompt,
  setSystemInstructions,
  ensureProjectInit,
  loadProjectConfig,
  getProjectDir,
  ensureProjectDirs,
  extractCleanMarkdown,
  runAuggieStream,
  checkAuthentication,
  executeCustomPromptStream,
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
};

