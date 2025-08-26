import fs from 'fs';
import path from 'path';

function cleanupOldDebugFiles(debugDir, maxFiles = 5) {
  try {
    if (!fs.existsSync(debugDir)) return;
    
    // Get all debug files
    const files = fs.readdirSync(debugDir)
      .filter(file => file.startsWith('debug-') && file.endsWith('.txt'))
      .map(file => ({
        name: file,
        path: path.join(debugDir, file),
        stat: fs.statSync(path.join(debugDir, file))
      }))
      .sort((a, b) => b.stat.mtime - a.stat.mtime); // Sort by modification time, newest first
    
    // Remove files beyond maxFiles limit
    if (files.length > maxFiles) {
      const filesToDelete = files.slice(maxFiles);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error(`Failed to delete old debug file ${file.name}:`, err.message);
        }
      });
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
    this.stepCounter = 0;
    this.autoEnabled = false;
  }

  enable(projectPath = process.cwd(), silent = false) {
    if (this.debugEnabled) return;

    this.debugEnabled = true;
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    this.stepCounter = 0;

    // Create debug directory
    const debugDir = path.join(projectPath, '.qlood', 'debug');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    // Cleanup old debug files before creating new one
    cleanupOldDebugFiles(debugDir, 5);

    // Create debug file
    const debugFileName = `debug-${this.sessionId}.txt`;
    this.debugFile = path.join(debugDir, debugFileName);

    // Initialize debug file (compact, no session id)
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
      toolsAvailable: tools.map(t => t.name)
    });
  }

  logAgentResponse(response, parsedPlan) {
    this.writeDebug('AGENT_RESPONSE', {
      rawResponseLength: response.length,
      parseSuccess: !!parsedPlan
    });
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

  logPageState(page) {
    if (!page) {
      this.writeDebug('PAGE_STATE', { status: 'No page available' });
      return;
    }

    // Safely get page info
    Promise.resolve().then(async () => {
      try {
        const url = page.url();
        const title = await page.title().catch(() => 'Unknown');
        
        this.writeDebug('PAGE_STATE', {
          url,
          title,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.writeDebug('PAGE_STATE', {
          error: error.message,
          status: 'Failed to get page info'
        });
      }
    }).catch(() => {}); // Silent catch for async operation
  }

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
      debugFile: this.debugFile,
      stepCounter: this.stepCounter
    };
  }
}

// Global debug logger instance
export const debugLogger = new DebugLogger();

// Auto-cleanup on process exit
process.on('exit', () => {
  debugLogger.disable();
});

process.on('SIGINT', () => {
  debugLogger.disable();
  process.exit(0);
});

process.on('SIGTERM', () => {
  debugLogger.disable();
  process.exit(0);
});