import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

import { incAuggieCalls } from './metrics.js';
import { debugLogger } from './debug.js';
/**
 * Auggie CLI Integration Module
 * Provides functions for file operations using the Auggie CLI tool
 */
export class AuggieIntegration {
  constructor(options = {}) {
    this.auggieCommand = options.auggieCommand || 'auggie';
    // By default, do not enforce a timeout for Auggie commands. Use null to mean "no timeout".
    this.timeout = options.timeout ?? null;
    this.maxBuffer = options.maxBuffer || 1024 * 1024 * 10; // 10MB
    // Track active spawned process for streaming so the TUI can cancel it
    this.activeChild = null;
  }

  /**
   * Ensures Auggie CLI is installed and up-to-date
   * @returns {Promise<{success: boolean, message: string, version?: string}>}
   */
  async ensureAuggieUpToDate() {
    try {
      // First check if auggie is installed
      const checkResult = await this._executeCommand('which', ['auggie']);
      if (!checkResult.success) {
        // Try to install auggie globally
        const installResult = await this._executeCommand('npm', ['install', '-g', '@augmentcode/auggie'], {
          timeout: 120000 // 2 minutes for npm install
        });

        if (!installResult.success) {
          return {
            success: false,
            message: `Failed to install Auggie CLI: ${installResult.stderr}`
          };
        }
      }

      // Update to latest version
      const updateResult = await this._executeCommand('npm', ['install', '-g', '@augmentcode/auggie@latest'], {
        timeout: 120000
      });

      if (!updateResult.success) {
        return {
          success: false,
          message: `Failed to update Auggie CLI: ${updateResult.stderr}`
        };
      }

      // Get version info
      const versionResult = await this._executeCommand('auggie', ['--version']);
      const version = versionResult.success ? versionResult.stdout.trim() : 'unknown';

      return {
        success: true,
        message: 'Auggie CLI is up-to-date',
        version
      };
    } catch (error) {
      return {
        success: false,
        message: `Error ensuring Auggie is up-to-date: ${error.message}`
      };
    }
  }



  /**
   * Executes a custom Auggie command with a specific prompt
   * @param {string} prompt - The prompt to send to Auggie
   * @param {Object} options - Additional options
   * @returns {Promise<{success: boolean, stdout?: string, stderr?: string}>}
   */
  async executeCustomPrompt(prompt, options = {}) {
    try {
      return await this._executeAuggieCommand(prompt, options);
    } catch (error) {
      return {
        success: false,
        stderr: `Error executing custom prompt: ${error.message}`
      };
    }
  }

  /**
   * Executes a custom Auggie command with streaming stdout/stderr
   * @param {string} prompt
   * @param {Object} options
   * @param {Object} handlers { onStdout?: (chunk: string) => void, onStderr?: (chunk: string) => void }
   * @returns {Promise<{success: boolean, stdout: string, stderr: string, exitCode: number | null}>}
   */
  async executeCustomPromptStream(prompt, options = {}, handlers = {}) {
    const args = [];
    const mcpConfigRel = path.join('.qlood', 'mcp-config.json');
    args.push('--mcp-config', mcpConfigRel);

    const usePrint = options.usePrintFormat !== false;
    if (usePrint) {
      // Prefer compact output for all Auggie runs
      args.push('--compact');
      args.push('--print', prompt);
    } else {
      if (options.flags) args.push(...options.flags);
      // Prefer compact output for all Auggie runs
      if (!args.includes('--compact')) args.push('--compact');
      args.push(prompt);
    }

    return this._spawnAndStream(this.auggieCommand, args, options, handlers);
  }


  /**
   * Checks if the user is authenticated with Auggie
   * @returns {Promise<{success: boolean, authenticated: boolean, error?: string}>}
   */
  async checkAuthentication() {
    try {
      // Try to run a simple command that requires authentication
      const result = await this._executeCommand('auggie', ['--compact', '--print-augment-token'], {
        skipMetrics: true
      });

      // If the command succeeds and returns a token, user is authenticated
      if (result.success && result.stdout && result.stdout.trim().length > 0) {
        return {
          success: true,
          authenticated: true
        };
      }

      // Check for the specific "API URL not specified" error
      if (result.stderr.includes('API URL not specified') || result.stderr.includes('❌ API URL not specified')) {
        return {
          success: true,
          authenticated: false
        };
      }

      // If command failed for other reasons, assume not authenticated
      return {
        success: true,
        authenticated: false
      };
    } catch (error) {
      return {
        success: false,
        authenticated: false,
        error: `Error checking authentication: ${error.message}`
      };
    }
  }

  /**
   * Executes a raw Auggie command with arguments
   * @param {string[]} args - Arguments to pass to Auggie
   * @param {Object} options - Additional options
   * @returns {Promise<{success: boolean, stdout?: string, stderr?: string}>}
   */
  async executeRawCommand(args = [], options = {}) {
    try {
      // Check if this is an interactive command that should be run directly
      const interactiveCommands = ['--login', '--logout'];
      const isInteractive = args.some(arg => interactiveCommands.includes(arg));

      if (isInteractive) {
        // For interactive commands, use spawn to preserve TTY interaction
        return await this._executeInteractiveCommand(args, options);
      }

      // Ensure compact mode for non-interactive calls
      const finalArgs = args.includes('--compact') ? args : ['--compact', ...args];

      const result = await this._executeCommand(this.auggieCommand, finalArgs, {
        timeout: (options.timeout ?? this.timeout),
        cwd: options.cwd || process.cwd()
      });

      return {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (error) {
      return {
        success: false,
        stderr: `Error executing Auggie command: ${error.message}`
      };
    }
  }

  /**
   * Streaming variant of executeRawCommand
   * @param {string[]} args
   * @param {Object} options
   * @param {Object} handlers
   */
  async executeRawCommandStream(args = [], options = {}, handlers = {}) {
    // Interactive commands should still inherit TTY and not be streamed into TUI
    const interactiveCommands = ['--login', '--logout'];
    const isInteractive = args.some(arg => interactiveCommands.includes(arg));
    if (isInteractive) {
      return this._executeInteractiveCommand(args, options);
    }
    // Ensure compact mode for non-interactive calls
    const finalArgs = args.includes('--compact') ? args : ['--compact', ...args];
    return this._spawnAndStream(this.auggieCommand, finalArgs, options, handlers);
  }

  /**
   * Executes an interactive Auggie command using spawn
   * @private
   */
  async _executeInteractiveCommand(args, options = {}) {
    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
      const child = spawn(this.auggieCommand, args, {
        stdio: 'inherit', // This preserves TTY interaction
        cwd: options.cwd || process.cwd(),
        env: process.env
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout: '', // stdout is handled by inherit
          stderr: ''
        });
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          stdout: '',
          stderr: `Error executing interactive command: ${error.message}`
        });
      });
    });
  }

  /**
   * Private method to execute Auggie CLI commands
   * @private
   */
  async _executeAuggieCommand(prompt, options = {}) {
    const args = [];

    // Always include MCP config for non-interactive calls
    const mcpConfigRel = path.join('.qlood', 'mcp-config.json');
    args.push('--mcp-config', mcpConfigRel);

    // Default to print mode unless explicitly disabled
    const usePrint = options.usePrintFormat !== false;
    if (usePrint) {
      // Prefer compact output for all Auggie runs
      args.push('--compact');
      args.push('--print', prompt);
    } else {
      // Add any additional flags
      if (options.flags) {
        args.push(...options.flags);
      }
      if (!args.includes('--compact')) args.push('--compact');
      // Add the prompt as the last argument
      args.push(prompt);
    }

    return await this._executeCommand(this.auggieCommand, args, {
      timeout: (options.timeout ?? this.timeout),
      cwd: options.cwd || process.cwd()
    });
  }

  /**
   * Private method to execute shell commands
   * @private
   */
  async _executeCommand(command, args = [], options = {}) {
    const {
      cwd = process.cwd(),
      timeout = this.timeout,
      env = process.env,
      skipMetrics = false,
    } = options;

    // Count Auggie invocations for live metrics (skip for auth checks or internal calls)
    try { if (!skipMetrics && command === this.auggieCommand) incAuggieCalls(); } catch {}

    // Log Auggie request (only for Auggie commands, not other shell commands)
    const startTime = new Date();
    if (command === this.auggieCommand) {
      debugLogger.logAuggieRequest(command, args, options);
    }

    let childProcess = null;

    try {
      const fullCommand = `${command} ${args.map(arg => this._escapeArg(arg)).join(' ')}`;

      // Create a promise that can be cancelled
      const execPromise = new Promise((resolve, reject) => {
        childProcess = exec(fullCommand, {
          cwd,
          env,
          maxBuffer: this.maxBuffer
        }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });



      const { stdout, stderr } = await execPromise;

      const result = {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };

      // Persist full outputs to per-session folder (non-streaming)
      try {
        if (command === this.auggieCommand && debugLogger.isEnabled()) {
          const info = debugLogger.getSessionInfo();
          const dir = info.sessionDir;
          if (dir) {
            const idx = debugLogger.nextAuggieIndex();
            const base = `auggie_call_${String(idx).padStart(3, '0')}`;
            fs.writeFileSync(path.join(dir, `${base}_stdout.txt`), result.stdout || '');
            fs.writeFileSync(path.join(dir, `${base}_stderr.txt`), result.stderr || '');
          }
        }
      } catch {}

      // Log Auggie response (only for Auggie commands)
      if (command === this.auggieCommand) {
        const duration = new Date() - startTime;
        debugLogger.logAuggieResponse(command, result, duration);
      }

      return result;
    } catch (error) {
      // Ensure child process is cleaned up
      if (childProcess && !childProcess.killed) {
        try {
          childProcess.kill('SIGKILL');
        } catch (killError) {
          // Ignore kill errors
        }
      }

      const result = {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message
      };

      // Log Auggie response error (only for Auggie commands)
      if (command === this.auggieCommand) {
        const duration = new Date() - startTime;
        debugLogger.logAuggieResponse(command, result, duration, error);
      }

      return result;
    }
  }


  /**
   * Spawn and stream a command, accumulating output while emitting chunks.
   * Supports optional pseudo-TTY via 'script' to encourage line-buffered output.
   * @private
   */
  async _spawnAndStream(command, args = [], options = {}, handlers = {}) {
    const { cwd = process.cwd(), env = process.env, skipMetrics = false, pty = false } = options;

    // Metrics + request log for Auggie commands
    try { if (!skipMetrics && command === this.auggieCommand) incAuggieCalls(); } catch {}
    if (command === this.auggieCommand) {
      debugLogger.logAuggieRequest(command, args, { cwd, pty });
    }

    // Wrap with 'script' to allocate a PTY when requested (macOS compatible)
    let cmd = command;
    let cmdArgs = args;
    if (pty) {
      cmd = 'script';
      cmdArgs = ['-q', '/dev/null', command, ...args];
    }

    return new Promise((resolve) => {
      const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      // Register as active child so callers can cancel via exported helper
      try { this.activeChild = child; } catch {}
      child.stdout.setEncoding && child.stdout.setEncoding('utf8');
      child.stderr.setEncoding && child.stderr.setEncoding('utf8');
      let stdout = '';
      let stderr = '';

      // Optional per-call streaming capture into session folder
      let streamFiles = null;
      try {
        if (command === this.auggieCommand && debugLogger.isEnabled()) {
          const info = debugLogger.getSessionInfo();
          if (info.sessionDir) {
            const idx = debugLogger.nextAuggieIndex();
            const base = `auggie_call_${String(idx).padStart(3, '0')}`;
            streamFiles = {
              out: path.join(info.sessionDir, `${base}_stdout.txt`),
              err: path.join(info.sessionDir, `${base}_stderr.txt`)
            };
            // Touch files so they exist immediately
            try { fs.writeFileSync(streamFiles.out, ''); } catch {}
            try { fs.writeFileSync(streamFiles.err, ''); } catch {}
          }
        }
      } catch {}

      child.stdout.on('data', (chunk) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString();
        stdout += text;
        try { if (streamFiles?.out) fs.appendFileSync(streamFiles.out, text); } catch {}
        try { handlers.onStdout && handlers.onStdout(text); } catch {}
      });

      child.stderr.on('data', (chunk) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString();
        stderr += text;
        try { if (streamFiles?.err) fs.appendFileSync(streamFiles.err, text); } catch {}
        try { handlers.onStderr && handlers.onStderr(text); } catch {}
      });

      child.on('close', (code) => {
        const result = { success: code === 0, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), exitCode: code };
        if (command === this.auggieCommand) {
          const duration = 0; // duration not tracked here for simplicity
          debugLogger.logAuggieResponse(command, result, duration);
        }
        try { if (this.activeChild === child) this.activeChild = null; } catch {}
        resolve(result);
      });

      child.on('error', (error) => {
        const result = { success: false, stdout: (stdout || '').trim(), stderr: ((stderr || `Error: ${error.message}`) || '').trim(), exitCode: null };
        if (command === this.auggieCommand) {
          debugLogger.logAuggieResponse(command, result, 0, error);
        }
        try { if (this.activeChild === child) this.activeChild = null; } catch {}
        resolve(result);
      });
    });
  }

  /**
   * Private method to escape shell arguments
   * @private
   */
  _escapeArg(arg) {
    if (/[|()[\{};'"\\` $<>&*?\s]/.test(arg)) {
      const escaped = String(arg).replace(/'/g, "'\\''");
      return "'" + escaped + "'";
    }
    return arg;
  }

  // Expose cancellation helpers
  hasActiveAuggie() {
    try { return !!(this.activeChild && !this.activeChild.killed); } catch { return false; }
  }

  cancelActiveAuggie({ force = false, signal } = {}) {
    const child = this.activeChild;
    if (!child) return false;
    const sig = signal || (force ? 'SIGKILL' : 'SIGINT');
    try {
      child.kill(sig);
      return true;
    } catch {
      return false;
    }
  }
}

// Convenience functions for direct use
const defaultAuggie = new AuggieIntegration();

export const ensureAuggieUpToDate = () => defaultAuggie.ensureAuggieUpToDate();

export const executeCustomPrompt = (prompt, options) => defaultAuggie.executeCustomPrompt(prompt, options);
export const executeCustomPromptStream = (prompt, options, handlers) => defaultAuggie.executeCustomPromptStream(prompt, options, handlers);
export const checkAuthentication = () => defaultAuggie.checkAuthentication();
export const executeRawCommand = (args, options) => defaultAuggie.executeRawCommand(args, options);
export const cancelActiveAuggie = (opts) => defaultAuggie.cancelActiveAuggie(opts);
export const hasActiveAuggie = () => defaultAuggie.hasActiveAuggie();
