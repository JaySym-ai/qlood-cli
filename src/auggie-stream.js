import { executeCustomPromptStream } from './auggie-integration.js';
import { extractCleanMarkdown } from './project.js';

// Sanitize streamed text to avoid control-char artifacts (e.g., caret-coded ^D)
function sanitizeStreamText(chunk) {
  const raw = typeof chunk === 'string' ? chunk : String(chunk || '');
  // Remove carriage returns and control chars except tab/newline
  const stripped = raw
    .replace(/\r/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Drop lines that are just caret-coded control markers
  const filtered = stripped
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t === '^D' || t === '^C') return false;
      if (/^script:.*(done|exiting)/i.test(t)) return false;
      return true;
    })
    .join('\n');
  return filtered;
}

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
        const clean = sanitizeStreamText(text);
        live += clean;
        try { handlers.onStdout && handlers.onStdout(clean); } catch {}
      },
      onStderr: (chunk) => {
        const text = typeof chunk === 'string' ? chunk : String(chunk || '');
        const clean = sanitizeStreamText(text);
        try { handlers.onStderr && handlers.onStderr(clean); } catch {}
      }
    }
  );
  const raw = (res?.stdout || live || '').trim();
  const cleaned = extractCleanMarkdown(raw) || '';
  return { success: !!res?.success, stdout: raw, stderr: res?.stderr || '', cleaned };
}
