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

    // Initialize debug file
    this.writeDebug('DEBUG SESSION STARTED', {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      workingDirectory: projectPath,
      nodeVersion: process.version,
      platform: process.platform
    });

    if (!silent) {
      console.log(`🐛 Debug logging enabled. Session: ${this.sessionId}`);
    }
  }

  disable() {
    if (!this.debugEnabled) return;

    this.writeDebug('DEBUG SESSION ENDED', {
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

    const logLine = `\n${'='.repeat(80)}\nSTEP ${step} | ${timestamp} | ${category}\n${'='.repeat(80)}\n${JSON.stringify(data, null, 2)}\n`;

    try {
      fs.appendFileSync(this.debugFile, logLine);
    } catch (error) {
      console.error('Failed to write debug log:', error.message);
    }
  }

  logAgentRequest(goal, model, prompt, tools) {
    this.writeDebug('AGENT_REQUEST', {
      goal,
      model,
      promptLength: prompt.length,
      toolsAvailable: tools.map(t => t.name),
      sanitizedPrompt: this.truncate(prompt, 1000)
    });
  }

  logAgentResponse(response, parsedPlan) {
    this.writeDebug('AGENT_RESPONSE', {
      rawResponseLength: response.length,
      rawResponse: this.truncate(response, 500),
      parsedPlan,
      parseSuccess: !!parsedPlan
    });
  }

  logToolExecution(toolName, args, startTime) {
    this.writeDebug('TOOL_EXECUTION_START', {
      tool: toolName,
      args,
      startTime: startTime.toISOString()
    });
  }

  logToolResult(toolName, result, startTime, error = null) {
    const endTime = new Date();
    const duration = endTime - startTime;

    this.writeDebug('TOOL_EXECUTION_END', {
      tool: toolName,
      duration: `${duration}ms`,
      success: !error,
      result: error ? null : result,
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
    this.writeDebug('SYSTEM_OUTPUT', {
      output,
      type,
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