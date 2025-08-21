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

export function setModel(model) {
  const cfg = loadConfig();
  cfg.model = model;
  saveConfig(cfg);
}

export function setApiKey(key) {
  const cfg = loadConfig();
  cfg.apiKey = key;
  saveConfig(cfg);
}

export function getModel() {
  const cfg = loadConfig();
  return cfg.model || process.env.QLOOD_DEFAULT_MODEL || 'moonshotai/kimi-k2';
}

export function getApiKey() {
  const cfg = loadConfig();
  return process.env.OPENROUTER_API_KEY || cfg.apiKey;
}
