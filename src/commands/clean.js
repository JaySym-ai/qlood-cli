import path from 'path';
import fs from 'fs/promises';
import { getProjectDir } from '../project.js';

export function registerCleanCommand(program) {
  program
    .command('clean')
    .description('Delete all workflow results from the .qlood/results directory.')
    .action(async () => {
      const cwd = process.cwd();
      const resultsDir = path.join(getProjectDir(cwd), 'results');

      try {
        await fs.rm(resultsDir, { recursive: true, force: true });
        await fs.mkdir(resultsDir, { recursive: true });
        console.log('Successfully cleaned all workflow results.');
      } catch (error) {
        console.error(`Error cleaning workflow results: ${error.message}`);
        process.exit(1);
      }
    });
}
