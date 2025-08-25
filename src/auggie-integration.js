import { spawn, exec } from 'child_process';

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
   * Checks if the user is authenticated with Auggie
   * @returns {Promise<{success: boolean, authenticated: boolean, error?: string}>}
   */
  async checkAuthentication() {
    try {
      // Try to run a simple command that requires authentication
      const result = await this._executeCommand('auggie', ['--print-augment-token'], {
        timeout: 5000 // Short timeout for auth check
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
      const interactiveCommands = ['--login', '--logout', '--compact'];
      const isInteractive = args.some(arg => interactiveCommands.includes(arg));

      if (isInteractive) {
        // For interactive commands, use spawn to preserve TTY interaction
        return await this._executeInteractiveCommand(args, options);
      }

      const result = await this._executeCommand(this.auggieCommand, args, {
        timeout: options.timeout || this.timeout,
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

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => {
          if (childProcess) {
            childProcess.kill('SIGTERM');
            // Give it a moment to clean up, then force kill
            setTimeout(() => {
              if (childProcess && !childProcess.killed) {
                childProcess.kill('SIGKILL');
              }
            }, 1000);
          }
          reject(new Error('Command timeout'));
        }, timeout)
      );

      const { stdout, stderr } = await Promise.race([execPromise, timeoutPromise]);

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (error) {
      // Ensure child process is cleaned up
      if (childProcess && !childProcess.killed) {
        try {
          childProcess.kill('SIGKILL');
        } catch (killError) {
          // Ignore kill errors
        }
      }

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
export const checkAuthentication = () => defaultAuggie.checkAuthentication();
export const executeRawCommand = (args, options) => defaultAuggie.executeRawCommand(args, options);

// Export the class as default
export default AuggieIntegration;
