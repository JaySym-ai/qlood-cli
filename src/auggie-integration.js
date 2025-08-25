import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * Auggie CLI Integration Module
 * Provides functions for file operations using the Auggie CLI tool
 */
export class AuggieIntegration {
  constructor(options = {}) {
    this.auggieCommand = options.auggieCommand || 'auggie';
    this.timeout = options.timeout || 30000;
    this.maxBuffer = options.maxBuffer || 1024 * 1024 * 10; // 10MB
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
   * Reads a file using Auggie CLI
   * @param {string} filePath - Path to the file to read
   * @param {Object} options - Additional options
   * @returns {Promise<{success: boolean, content?: string, error?: string}>}
   */
  async readFile(filePath, options = {}) {
    try {
      const prompt = options.prompt || `Read the contents of the file: ${filePath}`;
      const result = await this._executeAuggieCommand(prompt, {
        context: `File operation: read ${filePath}`,
        ...options
      });

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || 'Failed to read file with Auggie'
        };
      }

      return {
        success: true,
        content: result.stdout
      };
    } catch (error) {
      return {
        success: false,
        error: `Error reading file: ${error.message}`
      };
    }
  }

  /**
   * Writes content to a file using Auggie CLI
   * @param {string} filePath - Path to the file to write
   * @param {string} content - Content to write
   * @param {Object} options - Additional options
   * @returns {Promise<{success: boolean, message?: string, error?: string}>}
   */
  async writeFile(filePath, content, options = {}) {
    try {
      const prompt = options.prompt || 
        `Write the following content to the file ${filePath}:\n\n${content}`;
      
      const result = await this._executeAuggieCommand(prompt, {
        context: `File operation: write ${filePath}`,
        ...options
      });

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || 'Failed to write file with Auggie'
        };
      }

      return {
        success: true,
        message: `Successfully wrote content to ${filePath}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Error writing file: ${error.message}`
      };
    }
  }

  /**
   * Updates an existing file using Auggie CLI
   * @param {string} filePath - Path to the file to update
   * @param {string} instructions - Instructions for how to update the file
   * @param {Object} options - Additional options
   * @returns {Promise<{success: boolean, message?: string, error?: string}>}
   */
  async updateFile(filePath, instructions, options = {}) {
    try {
      const prompt = options.prompt || 
        `Update the file ${filePath} with the following instructions:\n\n${instructions}`;
      
      const result = await this._executeAuggieCommand(prompt, {
        context: `File operation: update ${filePath}`,
        ...options
      });

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || 'Failed to update file with Auggie'
        };
      }

      return {
        success: true,
        message: `Successfully updated ${filePath}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Error updating file: ${error.message}`
      };
    }
  }

  /**
   * Gets project context using Auggie CLI
   * @param {Object} options - Additional options
   * @returns {Promise<{success: boolean, context?: string, error?: string}>}
   */
  async getProjectContext(options = {}) {
    try {
      const prompt = options.prompt ||
        'Analyze the project structure and provide a comprehensive overview of the codebase including main files, dependencies, and project purpose';

      const result = await this._executeAuggieCommand(prompt, {
        usePrintFormat: true,
        timeout: 120000, // 2 minutes timeout for project analysis
        ...options
      });

      if (!result.success) {
        return {
          success: false,
          error: result.stderr || 'Failed to get project context with Auggie'
        };
      }

      return {
        success: true,
        context: result.stdout
      };
    } catch (error) {
      return {
        success: false,
        error: `Error getting project context: ${error.message}`
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
   * Private method to execute Auggie CLI commands
   * @private
   */
  async _executeAuggieCommand(prompt, options = {}) {
    const args = [];

    // Use --print format if specified
    if (options.usePrintFormat) {
      args.push('--print', prompt);
    } else {
      // Add context if provided (legacy format)
      if (options.context) {
        args.push('--context', options.context);
      }

      // Add any additional flags
      if (options.flags) {
        args.push(...options.flags);
      }

      // Add the prompt as the last argument
      args.push(prompt);
    }

    return await this._executeCommand(this.auggieCommand, args, {
      timeout: options.timeout || this.timeout,
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
      env = process.env
    } = options;

    try {
      const fullCommand = `${command} ${args.map(arg => this._escapeArg(arg)).join(' ')}`;
      
      const { stdout, stderr } = await Promise.race([
        execAsync(fullCommand, { 
          cwd, 
          env, 
          maxBuffer: this.maxBuffer 
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Command timeout')), timeout)
        )
      ]);

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (error) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message
      };
    }
  }

  /**
   * Private method to escape shell arguments
   * @private
   */
  _escapeArg(arg) {
    if (/[|()\[\]{};'"\\$`<>&*?\s]/.test(arg)) {
      return `'${arg.replace(/'/g, "'\"'\"'")}'`;
    }
    return arg;
  }
}

// Convenience functions for direct use
const defaultAuggie = new AuggieIntegration();

export const ensureAuggieUpToDate = () => defaultAuggie.ensureAuggieUpToDate();
export const readFile = (filePath, options) => defaultAuggie.readFile(filePath, options);
export const writeFile = (filePath, content, options) => defaultAuggie.writeFile(filePath, content, options);
export const updateFile = (filePath, instructions, options) => defaultAuggie.updateFile(filePath, instructions, options);
export const getProjectContext = (options) => defaultAuggie.getProjectContext(options);
export const executeCustomPrompt = (prompt, options) => defaultAuggie.executeCustomPrompt(prompt, options);

// Export the class as default
export default AuggieIntegration;
