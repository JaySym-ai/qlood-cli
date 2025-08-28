import fs from 'fs';
import path from 'path';

function cleanupOldDebugFiles(debugDir, maxSessions = 5) {
  try {
    if (!fs.existsSync(debugDir)) return;

    const entries = fs.readdirSync(debugDir)
      .map(name => ({ name, full: path.join(debugDir, name) }))
      .filter(e => {
        try { return fs.statSync(e.full).isDirectory() && e.name.startsWith('debug_session_'); } catch { return false; }
      })
      .map(e => ({ ...e, stat: fs.statSync(e.full) }))
      .sort((a, b) => b.stat.mtime - a.stat.mtime); // newest first

    if (entries.length > maxSessions) {
      const toDelete = entries.slice(maxSessions);
      for (const e of toDelete) {
        try {
          fs.rmSync(e.full, { recursive: true, force: true });
        } catch (err) {
          console.error(`Failed to delete old debug session ${e.name}:`, err.message);
        }
      }
    }

    // Backward-compat: also trim legacy root-level debug-*.txt files
    const legacyFiles = fs.readdirSync(debugDir)
      .filter(file => file.startsWith('debug-') && file.endsWith('.txt'))
      .map(file => ({
        name: file,
        full: path.join(debugDir, file),
        stat: fs.statSync(path.join(debugDir, file))
      }))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    if (legacyFiles.length > maxSessions) {
      const del = legacyFiles.slice(maxSessions);
      for (const f of del) {
        try { fs.unlinkSync(f.full); } catch (err) {
          console.error(`Failed to delete old debug file ${f.name}:`, err.message);
        }
      }
    }
  } catch (error) {
    console.error('Failed to cleanup old debug files:', error.message);
  }
}

export class DebugLogger {
  constructor() {
    this.debugEnabled = false;
    this.debugFile = null;
    this.sessionId = null;
    this.sessionDir = null;
    this.stepCounter = 0;
    this.autoEnabled = false;
    this.auggieCounter = 0;
  }

  enable(projectPath = process.cwd(), silent = false) {
    if (this.debugEnabled) return;

    this.debugEnabled = true;
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    this.stepCounter = 0;
    this.auggieCounter = 0;

    // Create debug root directory
    const debugRoot = path.join(projectPath, '.qlood', 'debug');
    if (!fs.existsSync(debugRoot)) {
      fs.mkdirSync(debugRoot, { recursive: true });
    }

    // Cleanup old debug sessions/files before creating new one
    cleanupOldDebugFiles(debugRoot, 5);

    // Create per-session directory: .qlood/debug/debug_session_<datetime>
    this.sessionDir = path.join(debugRoot, `debug_session_${this.sessionId}`);
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    // Create debug file inside the session folder, keeping same naming convention
    const debugFileName = `debug-${this.sessionId}.txt`;
    this.debugFile = path.join(this.sessionDir, debugFileName);

    // Initialize debug file (compact JSONL entries)
    this.writeDebug('SESSION_START', {
      timestamp: new Date().toISOString(),
      workingDirectory: projectPath,
      nodeVersion: process.version,
      platform: process.platform
    });

    if (!silent) {
      console.log(`🐛 Debug logging enabled.`);
    }
  }

  disable() {
    if (!this.debugEnabled) return;

    this.writeDebug('SESSION_END', {
      timestamp: new Date().toISOString(),
      totalSteps: this.stepCounter
    });

    this.debugEnabled = false;
    this.debugFile = null;
    this.sessionId = null;
    this.stepCounter = 0;
    this.autoEnabled = false;
  }

  autoEnable(projectPath = process.cwd()) {
    if (!this.autoEnabled) {
      this.enable(projectPath, true); // Enable silently
      this.autoEnabled = true;
    }
  }

  isEnabled() {
    return this.debugEnabled;
  }

  writeDebug(category, data) {
    if (!this.debugEnabled || !this.debugFile) return;

    const timestamp = new Date().toISOString();
    const step = ++this.stepCounter;

    // Compact JSONL entry: one line, minimal metadata
    const entry = {
      ts: timestamp,
      step,
      cat: category,
      ...(data || {})
    };

    try {
      fs.appendFileSync(this.debugFile, JSON.stringify(entry) + '\n');
    } catch (error) {
      console.error('Failed to write debug log:', error.message);
    }
  }

  logAgentRequest(goal, model, prompt, tools) {
    this.writeDebug('AGENT_REQUEST', {
      goal,
      model,
      promptLength: prompt.length,
      promptPreview: this.truncate(prompt, 500),
      toolsAvailable: tools.map(t => t.name)
    });
  }

  logAgentResponse(response, parsedPlan) {
    this.writeDebug('AGENT_RESPONSE', {
      rawResponseLength: response.length,
      responsePreview: this.truncate(response, 500),
      parseSuccess: !!parsedPlan,
      planSteps: parsedPlan ? parsedPlan.length : 0
    });
  }

  logLLMCall(model, messages, response, error = null) {
    this.writeDebug('LLM_CALL', {
      model,
      messageCount: messages ? messages.length : 0,
      messagesPreview: messages ? messages.map(m => ({
        role: m.role,
        contentLength: m.content ? m.content.length : 0,
        contentPreview: this.truncate(m.content, 200)
      })) : null,
      responseLength: response ? response.length : 0,
      responsePreview: response ? this.truncate(response, 300) : null,
      success: !error,
      error: error ? error.message : null,
      timestamp: new Date().toISOString()
    });
  }

  logAuggieRequest(command, args, options = {}) {
    this.writeDebug('AUGGIE_REQUEST', {
      command,
      args: args ? args.map(arg => this.truncate(String(arg), 300)) : [],
      options: {
        timeout: options.timeout,
        cwd: options.cwd,
        usePrintFormat: options.usePrintFormat,
        flags: options.flags
      },
      fullCommand: `${command} ${args ? args.map(arg => this.escapeArg(arg)).join(' ') : ''}`,
      timestamp: new Date().toISOString()
    });
  }

  logAuggieResponse(command, result, duration, error = null) {
    this.writeDebug('AUGGIE_RESPONSE', {
      command,
      success: result ? result.success : false,
      durationMs: duration,
      stdoutLength: result?.stdout ? result.stdout.length : 0,
      stderrLength: result?.stderr ? result.stderr.length : 0,
      stdoutPreview: result?.stdout ? this.truncate(result.stdout, 400) : null,
      stderrPreview: result?.stderr ? this.truncate(result.stderr, 400) : null,
      error: error ? error.message : null,
      timestamp: new Date().toISOString()
    });
  }

  escapeArg(arg) {
    // Simple arg escaping for display purposes
    const str = String(arg);
    if (str.includes(' ') || str.includes('"') || str.includes("'")) {
      return `"${str.replace(/"/g, '\\"')}"`;
    }
    return str;
  }

  logToolExecution(toolName, args, startTime) {
    // Shallow-truncate long string args to keep logs compact
    const safeArgs = {};
    try {
      for (const [k, v] of Object.entries(args || {})) {
        if (typeof v === 'string') {
          safeArgs[k] = this.truncate(v, 200);
        } else {
          safeArgs[k] = v;
        }
      }
    } catch (_) {}

    this.writeDebug('TOOL_EXECUTION_START', {
      tool: toolName,
      args: safeArgs,
      startTime: startTime.toISOString()
    });
  }

  logToolResult(toolName, result, startTime, error = null) {
    const endTime = new Date();
    const duration = endTime - startTime;

    // Summarize potentially large result payloads
    let summarized = null;
    if (result && typeof result === 'object') {
      const output = typeof result.output === 'string' ? result.output : '';
      const errText = typeof result.error === 'string' ? result.error : '';
      summarized = {
        success: result.success,
        exitCode: result.exitCode,
        processId: result.processId,
        outputLength: output ? output.length : undefined,
        errorLength: errText ? errText.length : undefined,
        outputPreview: output ? this.truncate(output, 200) : undefined,
        errorPreview: errText ? this.truncate(errText, 200) : undefined,
      };
      Object.keys(summarized).forEach(k => summarized[k] === undefined && delete summarized[k]);
    }

    this.writeDebug('TOOL_EXECUTION_END', {
      tool: toolName,
      durationMs: duration,
      success: !error && (result?.success !== false),
      result: error ? null : summarized,
      error: error ? error.message : null,
      endTime: endTime.toISOString()
    });
  }

  // Removed logPageState: depended on local Playwright page instance

  logError(context, error) {
    this.writeDebug('ERROR', {
      context,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      timestamp: new Date().toISOString()
    });
  }

  logUserInput(input, source = 'unknown') {
    this.writeDebug('USER_INPUT', {
      input,
      source,
      timestamp: new Date().toISOString()
    });
  }

  logSystemOutput(output, type = 'info') {
    const text = typeof output === 'string' ? output : String(output ?? '');
    this.writeDebug('SYSTEM_OUTPUT', {
      type,
      length: text.length,
      preview: this.truncate(text, 300),
      timestamp: new Date().toISOString()
    });
  }

  truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '... (truncated)';
  }

  getDebugFile() {
    return this.debugFile;
  }

  getSessionInfo() {
    return {
      enabled: this.debugEnabled,
      sessionId: this.sessionId,
      sessionDir: this.sessionDir,
      debugFile: this.debugFile,
      stepCounter: this.stepCounter
    };
  }

  nextAuggieIndex() {
    // 1-based counter for auggie call files within a session
    this.auggieCounter = (this.auggieCounter || 0) + 1;
    return this.auggieCounter;
  }
}

// Global debug logger instance
export const debugLogger = new DebugLogger();

// Auto-cleanup on process exit
process.on('exit', () => {
  debugLogger.disable();
});

// Avoid installing SIGINT/SIGTERM handlers here because any listener
// prevents Node's default behavior of exiting on Ctrl+C. Let callers
// (like the TUI) manage signals and rely on 'exit' for cleanup.
