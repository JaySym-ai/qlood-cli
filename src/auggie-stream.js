import { executeCustomPromptStream } from './auggie-integration.js';
import { extractCleanMarkdown } from './project.js';

/**
 * Unified Auggie streaming helper.
 * - Forces usePrintFormat: true and pty: true for consistent line-buffered streaming
 * - Accumulates stdout and returns both raw and cleaned versions
 *
 * @param {string} prompt
 * @param {{ cwd?: string }} options
 * @param {{ onStdout?: (chunk: string) => void, onStderr?: (chunk: string) => void }} handlers
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, cleaned: string }>} 
 */
export async function runAuggieStream(prompt, options = {}, handlers = {}) {
  let live = '';
  const res = await executeCustomPromptStream(
    prompt,
    { cwd: options.cwd || process.cwd(), usePrintFormat: true, pty: true },
    {
      onStdout: (chunk) => {
        const text = typeof chunk === 'string' ? chunk : String(chunk || '');
        live += text;
        try { handlers.onStdout && handlers.onStdout(text); } catch {}
      },
      onStderr: (chunk) => {
        try { handlers.onStderr && handlers.onStderr(typeof chunk === 'string' ? chunk : String(chunk || '')); } catch {}
      }
    }
  );
  const raw = (res?.stdout || live || '').trim();
  const cleaned = extractCleanMarkdown(raw) || '';
  return { success: !!res?.success, stdout: raw, stderr: res?.stderr || '', cleaned };
}

