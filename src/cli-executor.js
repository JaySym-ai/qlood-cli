import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CliExecutor {
  constructor() {
    this.processes = new Map();
    this.nextId = 1;
  }

  async executeCommand(command, options = {}) {
    const {
      args = [],
      cwd = process.cwd(),
      timeout = 30000,
      background = false,
      shell = true,
      env = process.env
    } = options;

    try {
      if (background) {
        return await this._executeBackground(command, args, { cwd, env, shell });
      } else {
        return await this._executeSync(command, args, { cwd, timeout, env, shell });
      }
    } catch (error) {
      throw new Error(`CLI execution failed: ${error.message}`);
    }
  }

  async _executeSync(command, args, { cwd, timeout, env, shell }) {
    const fullCommand = shell ? `${command} ${args.join(' ')}` : command;
    
    try {
      const { stdout, stderr } = await Promise.race([
        execAsync(fullCommand, { cwd, env, maxBuffer: 1024 * 1024 }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Command timeout')), timeout)
        )
      ]);

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };
    } catch (error) {
      return {
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1
      };
    }
  }

  async _executeBackground(command, args, { cwd, env, shell }) {
    const processId = this.nextId++;
    
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        this.processes.delete(processId);
        reject(new Error(`Failed to start command: ${error.message}`));
      });

      child.on('close', (code) => {
        this.processes.delete(processId);
        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
          processId
        });
      });

      this.processes.set(processId, {
        process: child,
        command: `${command} ${args.join(' ')}`,
        startTime: Date.now()
      });

      // Return immediately for background processes
      resolve({
        success: true,
        processId,
        message: `Background process started: ${command} ${args.join(' ')}`
      });
    });
  }

  killProcess(processId) {
    const processInfo = this.processes.get(processId);
    if (processInfo) {
      try {
        processInfo.process.kill('SIGTERM');
        this.processes.delete(processId);
        return { success: true, message: `Process ${processId} terminated` };
      } catch (error) {
        return { success: false, message: `Failed to kill process: ${error.message}` };
      }
    }
    return { success: false, message: `Process ${processId} not found` };
  }

  listProcesses() {
    const processes = [];
    for (const [id, info] of this.processes.entries()) {
      processes.push({
        id,
        command: info.command,
        startTime: info.startTime,
        running: !info.process.killed
      });
    }
    return processes;
  }

  async checkCommandExists(command) {
    try {
      const result = await this.executeCommand('which', [command], { timeout: 5000 });
      return result.success && result.stdout.length > 0;
    } catch {
      return false;
    }
  }

  async getCommandHelp(command) {
    try {
      // Try common help flags
      for (const helpFlag of ['--help', '-h', 'help']) {
        const result = await this.executeCommand(command, [helpFlag], { timeout: 10000 });
        if (result.success || result.stderr.includes('usage') || result.stdout.includes('usage')) {
          return {
            success: true,
            help: result.stdout || result.stderr,
            command: `${command} ${helpFlag}`
          };
        }
      }
      
      // Try man page as fallback
      const manResult = await this.executeCommand('man', [command], { timeout: 10000 });
      if (manResult.success) {
        return {
          success: true,
          help: manResult.stdout.slice(0, 2000), // Truncate man pages
          command: `man ${command}`
        };
      }

      return {
        success: false,
        message: `No help available for command: ${command}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get help for ${command}: ${error.message}`
      };
    }
  }
}

// Singleton instance
export const cliExecutor = new CliExecutor();