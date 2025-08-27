import fs from 'fs';
import path from 'path';
import os from 'os';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function getConfigPath() {
  const dir = path.join(os.homedir(), '.qlood');
  ensureDir(dir);
  return path.join(dir, 'config.json');
}

export function loadConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function saveConfig(cfg) {
  const p = getConfigPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(p, 0o600); } catch {}
}


export function setMainPrompt(prompt) {
  const cfg = loadConfig();
  cfg.mainPrompt = prompt;
  saveConfig(cfg);
}



export function setSystemInstructions(instructions) {
  const cfg = loadConfig();
  cfg.systemInstructions = instructions;
  saveConfig(cfg);
}

