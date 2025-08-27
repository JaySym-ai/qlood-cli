import { exec, spawn } from 'child_process';
import { startCliSpinner } from './spinner.js';

/**
 * Auto-update qlood-cli to latest published version.
 * - Respects env flags: QLOOD_NO_UPDATE, QLOOD_NO_AUTOUPDATE, QLOOD_SKIP_UPDATE_ON_RESTART
 * - Compares currentVersion against `npm view qlood-cli version`
 * - If newer, runs global install and instructs the user to relaunch manually
 */
export async function checkAndAutoUpdate(currentVersion) {
  // Allow opt-out via env
  if (process.env.QLOOD_NO_UPDATE === '1' || process.env.QLOOD_NO_AUTOUPDATE === '1') return;
  // Avoid loops after restart
  if (process.env.QLOOD_SKIP_UPDATE_ON_RESTART === '1') return;

  // Query latest published version quickly
  const latestVersion = await new Promise((resolve) => {
    exec('npm view qlood-cli version', (err, stdout) => {
      if (err) return resolve(null);
      resolve((stdout || '').trim() || null);
    });
  });

  if (!latestVersion || latestVersion === currentVersion) return;

  const spinner = startCliSpinner(`Auto-updating qlood-cli to v${latestVersion}...`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await new Promise((resolve) => {
    try {
      const updater = spawn(npmCmd, ['i', '-g', 'qlood-cli']);
      updater.on('error', () => {
        try { spinner.stop('Auto-update failed (could not spawn npm)', false); } catch {}
        resolve();
      });
      updater.on('exit', (code) => {
        if (code === 0) {
          try { spinner.stop(`Updated to v${latestVersion}`, true); } catch {}
          console.log(`qlood updated to v${latestVersion} ✓`);
          const origArgs = process.argv.slice(2);
          if (origArgs.length > 0) {
            const relaunch = ['qlood', ...origArgs].join(' ');
            console.log(`Relaunch with: ${relaunch}`);
          } else {
            console.log('Relaunch with: qlood');
          }
          console.log('(Note: auto-restart is disabled to avoid TTY issues. Manual relaunch recommended.)');
          // Exit current process to avoid TTY issues after auto-update
          process.exit(0);
        } else {
          try { spinner.stop('Auto-update failed', false); } catch {}
          resolve();
        }
      });
    } catch (e) {
      try { spinner.stop('Auto-update failed', false); } catch {}
      resolve();
    }
  });
}

